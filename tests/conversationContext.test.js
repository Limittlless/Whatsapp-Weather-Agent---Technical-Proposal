import { describe, expect, it } from 'vitest';

import { prepareConversationHistory } from '../src/agent/conversationContext.js';
import { SYSTEM_PROMPT } from '../src/agent/persona.js';

describe('prepareConversationHistory', () => {
  it('adds the system persona as the first message', () => {
    const result = prepareConversationHistory([], 'Hello');

    expect(result[0]).toEqual({
      role: 'system',
      content: SYSTEM_PROMPT,
    });

    expect(result[1]).toEqual({
      role: 'user',
      content: 'Hello',
    });
  });

  it('does not duplicate an existing system message', () => {
    const history = [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'assistant',
        content: 'Previous response',
      },
    ];

    const result = prepareConversationHistory(
      history,
      'What is the weather?',
    );

    const systemMessages = result.filter(
      (message) => message.role === 'system',
    );

    expect(systemMessages).toHaveLength(1);
    expect(result.at(-1)).toEqual({
      role: 'user',
      content: 'What is the weather?',
    });
  });

  it('trims the user message before adding it', () => {
    const result = prepareConversationHistory(
      [],
      '   Weather in Marrakech?   ',
    );

    expect(result.at(-1)).toEqual({
      role: 'user',
      content: 'Weather in Marrakech?',
    });
  });

  it('rejects an invalid conversation history', () => {
    expect(() =>
      prepareConversationHistory(null, 'Hello'),
    ).toThrow('Conversation history must be an array.');
  });

  it('rejects an empty user message', () => {
    expect(() =>
      prepareConversationHistory([], '   '),
    ).toThrow('User message is required.');
  });
});