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

  it('stores only visible text from multipart AI content', () => {
    expect(
      toStoredMessage(
        new AIMessage({
          content: [
            {
              type: 'text',
              text: 'Internal reasoning.',
              thought: true,
              thoughtSignature: 'secret-signature',
            },
            {
              type: 'functionCall',
              functionCall: {
                name: 'get_current_weather',
                args: { latitude: 31.63, longitude: -8 },
              },
            },
            {
              type: 'text',
              text: 'The visible answer.',
            },
          ],
          tool_calls: [
            {
              id: 'call-1',
              name: 'get_current_weather',
              args: { latitude: 31.63, longitude: -8 },
            },
          ],
        }),
      ),
    ).toEqual({
      role: 'assistant',
      content: 'The visible answer.',
      tool_calls: [
        {
          id: 'call-1',
          name: 'get_current_weather',
          args: { latitude: 31.63, longitude: -8 },
        },
      ],
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
