import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { createGeminiModel } from '../config/geminiClient.js';
import {
  getConversationHistory,
  saveConversationHistory,
} from '../services/conversationStore.js';
import { pruneHistory } from '../services/pruneHistory.js';

import { prepareConversationHistory } from './conversationContext.js';
import { executeToolCall } from './executeToolCall.js';
import {
  toLangChainMessages,
  toStoredMessage,
} from './messageMapper.js';

const MAX_ITERATIONS = 5;

function parseRawFunctionCallText(content) {
  if (typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();

  if (!trimmed.startsWith('{') || !trimmed.includes('"functionCall"')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
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

export async function runAgent({
  whatsappId,
  userMessage,
  model,
}) {
  if (!whatsappId?.trim()) {
    throw new Error('whatsappId is required.');
  }

  let messages;

  try {
    const activeModel = model ?? createGeminiModel();

    const storedHistory =
      await getConversationHistory(whatsappId);

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
      const aiMessage = await activeModel.invoke(messages);

      const toolCalls = aiMessage.tool_calls ?? [];

      if (toolCalls.length > 0) {
        messages.push(aiMessage);

        for (const toolCall of toolCalls) {
          const toolMessage = await executeToolCall(toolCall);
          messages.push(toolMessage);
        }

        continue;
      }

      const recoveredCall = parseRawFunctionCallText(aiMessage.content);

      if (recoveredCall) {
        console.warn(
          `[agent] Recovered a raw function call from model text output: ${recoveredCall.name}`,
        );

        messages.push(new AIMessage('One moment, let me check that.'));

        const toolMessage = await executeToolCall(recoveredCall);

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

      messages.push(aiMessage);

      const updatedHistory = pruneHistory(
        messages.map(toStoredMessage),
      );

      await saveConversationHistory(whatsappId, updatedHistory);

      return aiMessage.content;
    }

    throw new Error(
      `Agent exceeded the maximum of ${MAX_ITERATIONS} iterations.`,
    );
  } catch (error) {
    console.error('[agent] Execution failed:', error);

    if (Array.isArray(messages) && messages.length > 0) {
      try {
        const updatedHistory = pruneHistory(
          messages.map(toStoredMessage),
        );

        await saveConversationHistory(whatsappId, updatedHistory);
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