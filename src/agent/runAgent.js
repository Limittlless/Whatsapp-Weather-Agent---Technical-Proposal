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

export async function runAgent({
  whatsappId,
  userMessage,
  model,
}) {
  if (!whatsappId?.trim()) {
    throw new Error('whatsappId is required.');
  }

  // Declared here (not inside the try block) so the catch block can still
  // reach whatever was built before the failure and persist it.
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

      messages.push(aiMessage);

      const toolCalls = aiMessage.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const updatedHistory = pruneHistory(
          messages.map(toStoredMessage),
        );

        await saveConversationHistory(
          whatsappId,
          updatedHistory,
        );

        return aiMessage.content;
      }

      for (const toolCall of toolCalls) {
        const toolMessage = await executeToolCall(toolCall);
        messages.push(toolMessage);
      }
    }

    throw new Error(
      `Agent exceeded the maximum of ${MAX_ITERATIONS} iterations.`,
    );
  } catch (error) {
    console.error('[agent] Execution failed:', error);

    // `messages` only ever contains complete tool-call groups: a new
    // message is only pushed once the previous iteration's assistant
    // tool_calls already got all of their matching tool results appended
    // (see the loop above). So whatever iteration we failed on, what's
    // already in `messages` is always safe to persist — this preserves
    // the user's message and any completed tool exchanges from this turn
    // instead of silently losing them from the next session's context.
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