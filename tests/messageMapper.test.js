import { describe, expect, it } from 'vitest';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';

import {
  toLangChainMessages,
  toStoredMessage,
} from '../src/agent/messageMapper.js';

describe('messageMapper', () => {
  it('converts stored messages to LangChain messages', () => {
    const messages = toLangChainMessages([
      {
        role: 'system',
        content: 'System prompt',
      },
      {
        role: 'user',
        content: 'Weather in Marrakech?',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            name: 'geocode_location',
            args: {
              location: 'Marrakech',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"latitude":31.63,"longitude":-8}',
        tool_call_id: 'call-1',
        name: 'geocode_location',
      },
    ]);

    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect(messages[2]).toBeInstanceOf(AIMessage);
    expect(messages[3]).toBeInstanceOf(ToolMessage);

    expect(messages[2].tool_calls).toHaveLength(1);
    expect(messages[3].tool_call_id).toBe('call-1');
  });

  it('converts LangChain messages to stored messages', () => {
    expect(
      toStoredMessage(new SystemMessage('System prompt')),
    ).toEqual({
      role: 'system',
      content: 'System prompt',
    });

    expect(
      toStoredMessage(new HumanMessage('Hello')),
    ).toEqual({
      role: 'user',
      content: 'Hello',
    });

    expect(
      toStoredMessage(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              name: 'geocode_location',
              args: {
                location: 'Marrakech',
              },
            },
          ],
        }),
      ),
    ).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call-1',
          name: 'geocode_location',
          args: {
            location: 'Marrakech',
          },
        },
      ],
    });

    expect(
      toStoredMessage(
        new ToolMessage({
          content: '{"latitude":31.63}',
          tool_call_id: 'call-1',
          name: 'geocode_location',
        }),
      ),
    ).toEqual({
      role: 'tool',
      content: '{"latitude":31.63}',
      tool_call_id: 'call-1',
      name: 'geocode_location',
    });
  });

  it('throws for unsupported stored roles', () => {
    expect(() =>
      toLangChainMessages([
        {
          role: 'unknown',
          content: 'test',
        },
      ]),
    ).toThrow('Unsupported message role');
  });
});