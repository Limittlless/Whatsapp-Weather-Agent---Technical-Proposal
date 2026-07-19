import { createGeminiModel } from '../config/geminiClient.js';
import {
  getConversationHistory,
  saveConversationHistory,
} from '../services/conversationStore.js';

import { prepareConversationHistory } from './conversationContext.js';
import { executeToolCall } from './executeToolCall.js';
import {
  toLangChainMessages,
  toStoredMessage,
} from './messageMapper.js';

const MAX_ITERATIONS = 5;

const FALLBACK_MESSAGE =
  'Sorry, I could not process your request right now. Please try again shortly.';

async function saveHistorySafely(whatsappId, messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }

  try {
    const storedHistory = messages.map(toStoredMessage);

    await saveConversationHistory(
      whatsappId,
      storedHistory,
    );
  } catch (error) {
    console.error(
      '[agent] Failed to save conversation history:',
      error,
    );
  }
}

export async function runAgent({
  whatsappId,
  userMessage,
  model,
}) {
  if (!whatsappId?.trim()) {
    throw new Error('whatsappId is required.');
  }

  let messages = [];

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

      const toolCalls = Array.isArray(aiMessage.tool_calls)
        ? aiMessage.tool_calls
        : [];

      if (toolCalls.length === 0) {
        await saveHistorySafely(whatsappId, messages);

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

    await saveHistorySafely(whatsappId, messages);

    return FALLBACK_MESSAGE;
  }
}