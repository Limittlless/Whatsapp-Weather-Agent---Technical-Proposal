import { SYSTEM_PROMPT } from './persona.js';
import { pruneHistory } from '../services/pruneHistory.js';

export function prepareConversationHistory(history, userMessage) {
  if (!Array.isArray(history)) {
    throw new Error('Conversation history must be an array.');
  }

  if (!userMessage?.trim()) {
    throw new Error('User message is required.');
  }

  const preparedHistory = [...history];

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