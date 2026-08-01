import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { createGeminiModel } from '../config/geminiClient.js';
import { runExclusive } from '../lib/keyedQueue.js';
import { measureLatency } from '../lib/latency.js';
import { withRetry, defaultIsRetryable } from '../lib/retry.js';
import {
  flushConversationHistory,
  getCachedConversationHistory,
  setCachedConversationHistory,
} from '../services/conversationCache.js';
import { trackError } from '../services/errorTracker.js';
import { pruneHistory } from '../services/pruneHistory.js';
import { recordGeminiCall } from '../services/usageMetrics.js';

import {
  prepareConversationHistory,
  stripToolCallTurns,
} from './conversationContext.js';
import { executeToolCall } from './executeToolCall.js';
import {
  extractVisibleText,
  toLangChainMessages,
  toStoredMessage,
} from './messageMapper.js';

const MAX_ITERATIONS = 5;
const SUSPICIOUSLY_LONG_REPLY_LENGTH = 3500;

const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_BASE_DELAY_MS = 300;
const GEMINI_MAX_DELAY_MS = 5000;

function isGeminiErrorRetryable(error) {
  if (typeof error?.code === 'number') {
    return [408, 429, 500, 502, 503, 504].includes(error.code);
  }

  return defaultIsRetryable(error);
}

function parseRawFunctionCallText(content) {
  if (typeof content !== 'string') {
    return null;
  }

  if (!content.includes('"functionCall"')) {
    return null;
  }

  const jsonStart = content.indexOf('{');

  if (jsonStart === -1) {
    return null;
  }

  const candidate = content.slice(jsonStart).trim();

  try {
    const parsed = JSON.parse(candidate);
    const call = parsed?.functionCall;

    if (parsed?.type === 'functionCall' && call?.name) {
      return {
        name: call.name,
        args: call.args ?? {},
        id: call.id ?? `raw_${Date.now()}`,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isDegenerateReply(content) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return true;
  }

  if (content.length > SUSPICIOUSLY_LONG_REPLY_LENGTH) {
    return true;
  }

  if (
    content.includes('"functionCall"') ||
    content.includes('"thoughtSignature"')
  ) {
    return true;
  }

  return false;
}

export async function runAgent({ whatsappId, userMessage, model, traceId }) {
  if (!whatsappId?.trim()) {
    throw new Error('whatsappId is required.');
  }

  return runExclusive(
    whatsappId,
    (lock) =>
      runAgentInternal({
        whatsappId,
        userMessage,
        model,
        lock,
        traceId,
      }),
    { traceId },
  );
}

async function runAgentInternal({
  whatsappId,
  userMessage,
  model,
  lock,
  traceId,
}) {
  let messages;

  try {
    lock.assertLockHeld();
    const activeModel = model ?? createGeminiModel();

    const storedHistory = await measureLatency(
      traceId,
      'history.load',
      () =>
        getCachedConversationHistory(whatsappId, {
          forceRefresh: true,
        }),
    );
    lock.assertLockHeld();

    const preparedHistory = prepareConversationHistory(
      storedHistory,
      userMessage,
    );

    messages = toLangChainMessages(preparedHistory);

    for (
      let iteration = 0;
      iteration < MAX_ITERATIONS;
      iteration += 1
    ) {
      let attemptsMade = 0;

      const aiMessage = await withRetry(
        async () => {
          attemptsMade += 1;
          try {
            const result = await measureLatency(
              traceId,
              'gemini.invoke',
              () =>
                activeModel.invoke(messages, {
                  signal: lock.signal,
                }),
              { iteration: iteration + 1, attempt: attemptsMade },
            );
            recordGeminiCall({ ok: true });
            return result;
          } catch (error) {
            recordGeminiCall({ ok: false, error });
            throw error;
          }
        },
        {
          maxAttempts: GEMINI_MAX_ATTEMPTS,
          baseDelayMs: GEMINI_BASE_DELAY_MS,
          maxDelayMs: GEMINI_MAX_DELAY_MS,
          isRetryable: (error) =>
            !lock.signal?.aborted && isGeminiErrorRetryable(error),
          onRetry: ({ error, willRetry }) => {
            if (willRetry) {
              console.warn(
                `[agent] Gemini call failed (attempt ${attemptsMade}), retrying:`,
                error instanceof Error ? error.message : error,
              );
            }
          },
        },
      )
        .catch((error) => {
          trackError({
            service: 'gemini',
            severity: 'warning',
            error,
            retryCount: attemptsMade - 1,
            context: { whatsappId },
          });
          throw error;
        });
      lock.assertLockHeld();

      const toolCalls = aiMessage.tool_calls ?? [];

      if (toolCalls.length > 0) {
        messages.push(aiMessage);

        const toolMessages = await measureLatency(
          traceId,
          'tools.execute',
          () =>
            Promise.all(
              toolCalls.map((toolCall) => executeToolCall(toolCall)),
            ),
          {
            iteration: iteration + 1,
            tools: toolCalls.map((toolCall) => toolCall.name),
          },
        );
        lock.assertLockHeld();

        messages.push(...toolMessages);

        continue;
      }

      const replyText = extractVisibleText(aiMessage.content);
      const recoveredCall = parseRawFunctionCallText(replyText);

      if (recoveredCall) {
        console.warn(
          `[agent] Recovered a raw function call from model text output: ${recoveredCall.name}`,
        );

        messages.push(new AIMessage('One moment, let me check that.'));

        const toolMessage = await measureLatency(
          traceId,
          'tools.execute_recovered',
          () => executeToolCall(recoveredCall),
          { iteration: iteration + 1, tools: [recoveredCall.name] },
        );
        lock.assertLockHeld();

        messages.push(
          new HumanMessage(
            `[tool result for ${recoveredCall.name}]: ${toolMessage.content}\n\n` +
              "Use this information to answer the user's last message " +
              'directly, in the same language they used, without ' +
              'mentioning tools, JSON, or any internal system details.',
          ),
        );

        continue;
      }

      if (isDegenerateReply(replyText)) {
        console.error(
          `[agent] Discarding a malformed model reply (length=${replyText.length}). ` +
            'Not sending it to WhatsApp and not saving it to history, ' +
            'so it cannot poison the next turn.',
        );

        const updatedHistory = pruneHistory(
          stripToolCallTurns(messages.map(toStoredMessage)),
        );

        lock.assertLockHeld();
        setCachedConversationHistory(whatsappId, updatedHistory, { lock });
        await measureLatency(
          traceId,
          'history.flush',
          () => flushConversationHistory(whatsappId),
        );
        lock.assertLockHeld();

        return 'عذرًا، حدث خطأ أثناء معالجة طلبك. من فضلك أعد إرسال سؤالك.';
      }

      messages.push(aiMessage);

      const updatedHistory = pruneHistory(
        stripToolCallTurns(messages.map(toStoredMessage)),
      );

      lock.assertLockHeld();
      setCachedConversationHistory(whatsappId, updatedHistory, { lock });
      await measureLatency(
        traceId,
        'history.flush',
        () => flushConversationHistory(whatsappId),
      );
      lock.assertLockHeld();

      return replyText;
    }

    throw new Error(
      `Agent exceeded the maximum of ${MAX_ITERATIONS} iterations.`,
    );
  } catch (caughtError) {
    let error = caughtError;
    try {
      lock.assertLockHeld();
    } catch (lockError) {
      error = lockError;
    }

    console.error('[agent] Execution failed:', error);

    trackError({
      service: 'agent',
      severity: 'critical',
      error,
      context: { whatsappId },
    });

    if (error?.code === 'DISTRIBUTED_LOCK_LOST') {
      throw error;
    }

    if (Array.isArray(messages) && messages.length > 0) {
      try {
        const updatedHistory = pruneHistory(
          stripToolCallTurns(messages.map(toStoredMessage)),
        );

        lock.assertLockHeld();
        setCachedConversationHistory(whatsappId, updatedHistory, { lock });
        await measureLatency(
          traceId,
          'history.flush_after_error',
          () => flushConversationHistory(whatsappId),
        );
        lock.assertLockHeld();
      } catch (saveError) {
        console.error(
          '[agent] Failed to save conversation history after an error:',
          saveError,
        );
      }
    }

    return 'Sorry, I could not process your request right now. Please try again shortly.';
  }
}
