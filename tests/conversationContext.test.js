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

  it('drops a trailing assistant tool-call message with no matching tool response', () => {
    const history = [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: 'What is the weather in Nouakchott?',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', name: 'get_weather', args: { city: 'Nouakchott' } },
        ],
      },
    ];

    const result = prepareConversationHistory(history, 'Still there?');

    const roles = result.map((message) => message.role);
    expect(roles).not.toContain('assistant');
    expect(result.at(-1)).toEqual({
      role: 'user',
      content: 'Still there?',
    });
  });

  it('keeps a properly paired assistant tool-call and tool response', () => {
    const history = [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', name: 'get_weather', args: { city: 'Nouakchott' } },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'get_weather',
        content: '{"tempC":32}',
      },
    ];

    const result = prepareConversationHistory(history, 'Thanks!');

    const roles = result.map((message) => message.role);
    expect(roles).toContain('assistant');
    expect(roles).toContain('tool');
  });

  it('does not mutate the caller-provided history array', () => {
    const history = [];

    prepareConversationHistory(history, 'Hello');

    expect(history).toEqual([]);
  });
});