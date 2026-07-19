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