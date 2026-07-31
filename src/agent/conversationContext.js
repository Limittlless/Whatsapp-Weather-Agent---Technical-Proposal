import { SYSTEM_PROMPT } from './persona.js';
import { pruneHistory } from '../services/pruneHistory.js';

export function dropDanglingToolCallTurn(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return history ?? [];
  }

  const last = history[history.length - 1];

  if (
    last?.role === 'assistant' &&
    Array.isArray(last.tool_calls) &&
    last.tool_calls.length > 0
  ) {
    console.warn(
      '[conversationContext] Dropping a stored assistant message that ' +
        'requested a tool call but has no matching tool response ' +
        "(likely left behind by an error mid-tool-execution). Gemini " +
        'requires a function response to immediately follow a function ' +
        'call, so keeping it would break every future turn for this user.',
    );

    return history.slice(0, -1);
  }

  return history;
}

export function prepareConversationHistory(history, userMessage) {
  if (!Array.isArray(history)) {
    throw new Error('Conversation history must be an array.');
  }

  if (!userMessage?.trim()) {
    throw new Error('User message is required.');
  }

  const preparedHistory = [...dropDanglingToolCallTurn(history)];

  const hasSystemMessage = preparedHistory[0]?.role === 'system';

  if (!hasSystemMessage) {
    preparedHistory.unshift({
      role: 'system',
      content: SYSTEM_PROMPT,
    });
  }

  preparedHistory.push({
    role: 'user',
    content: userMessage.trim(),
  });

  return pruneHistory(preparedHistory);
}