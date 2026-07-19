import { AIMessage } from '@langchain/core/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/conversationStore.js', () => ({
  getConversationHistory: vi.fn(),
  saveConversationHistory: vi.fn(),
}));

vi.mock('../src/agent/executeToolCall.js', () => ({
  executeToolCall: vi.fn(),
}));

import {
  getConversationHistory,
  saveConversationHistory,
} from '../src/services/conversationStore.js';
import { executeToolCall } from '../src/agent/executeToolCall.js';
import { runAgent } from '../src/agent/runAgent.js';

describe('runAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConversationHistory.mockResolvedValue([]);
    saveConversationHistory.mockResolvedValue(undefined);
  });

  it('returns and saves a direct Gemini response', async () => {
    const model = {
      invoke: vi.fn().mockResolvedValue(
        new AIMessage({
          content: 'Hello! How can I help?',
        }),
      ),
    };

    const result = await runAgent({
      whatsappId: '212600000000',
      userMessage: 'Hello',
      model,
    });

    expect(result).toBe('Hello! How can I help?');
    expect(model.invoke).toHaveBeenCalledTimes(1);
    expect(saveConversationHistory).toHaveBeenCalledTimes(1);
  });

  it('executes tool calls and invokes Gemini again', async () => {
    const firstResponse = new AIMessage({
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

    const finalResponse = new AIMessage({
      content: 'It is warm in Marrakech.',
    });

    const model = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(finalResponse),
    };

    executeToolCall.mockResolvedValue({
      getType: () => 'tool',
      content: '{"latitude":31.63,"longitude":-8}',
      tool_call_id: 'call-1',
      name: 'geocode_location',
    });

    const result = await runAgent({
      whatsappId: '212600000000',
      userMessage: 'What is the weather in Marrakech?',
      model,
    });

    expect(result).toBe('It is warm in Marrakech.');
    expect(model.invoke).toHaveBeenCalledTimes(2);
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(executeToolCall).toHaveBeenCalledWith(
      firstResponse.tool_calls[0],
    );
    expect(saveConversationHistory).toHaveBeenCalledTimes(1);
  });

  it('executes every tool call returned by Gemini', async () => {
    const firstResponse = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call-1',
          name: 'geocode_location',
          args: {
            location: 'Marrakech',
          },
        },
        {
          id: 'call-2',
          name: 'geocode_location',
          args: {
            location: 'Tokyo',
          },
        },
      ],
    });

    const model = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(
          new AIMessage({
            content: 'Here are both results.',
          }),
        ),
    };

    executeToolCall.mockImplementation(async (toolCall) => ({
      getType: () => 'tool',
      content: JSON.stringify({
        city: toolCall.args.location,
      }),
      tool_call_id: toolCall.id,
      name: toolCall.name,
    }));

    await runAgent({
      whatsappId: '212600000000',
      userMessage: 'Weather in Marrakech and Tokyo?',
      model,
    });

    expect(executeToolCall).toHaveBeenCalledTimes(2);
  });

  it('throws when whatsappId is missing', async () => {
    await expect(
      runAgent({
        whatsappId: '',
        userMessage: 'Hello',
        model: {
          invoke: vi.fn(),
        },
      }),
    ).rejects.toThrow('whatsappId is required.');
  });

  it('returns a fallback message when Gemini fails', async () => {
    const model = {
      invoke: vi.fn().mockRejectedValue(
        new Error('Gemini service unavailable'),
      ),
    };

    const result = await runAgent({
      whatsappId: '212600000000',
      userMessage: 'What is the weather?',
      model,
    });

    expect(result).toBe(
      'Sorry, I could not process your request right now. Please try again shortly.',
    );

    expect(saveConversationHistory).toHaveBeenCalledTimes(1);

    const [savedWhatsappId, savedHistory] =
      saveConversationHistory.mock.calls[0];

    expect(savedWhatsappId).toBe('212600000000');
    expect(savedHistory.some((message) => message.role === 'user')).toBe(
      true,
    );
    expect(
      savedHistory.some((message) => message.role === 'assistant'),
    ).toBe(false);
  });

  it('still saves history when the agent exceeds the max iteration limit', async () => {
    const toolCallResponse = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call-loop',
          name: 'geocode_location',
          args: { location: 'Nowhere' },
        },
      ],
    });

    const model = {
      invoke: vi.fn().mockResolvedValue(toolCallResponse),
    };

    executeToolCall.mockResolvedValue({
      getType: () => 'tool',
      content: '{"error":"not found"}',
      tool_call_id: 'call-loop',
      name: 'geocode_location',
    });

    const result = await runAgent({
      whatsappId: '212600000000',
      userMessage: 'Loop forever',
      model,
    });

    expect(result).toBe(
      'Sorry, I could not process your request right now. Please try again shortly.',
    );
    expect(saveConversationHistory).toHaveBeenCalledTimes(1);

    const [, savedHistory] = saveConversationHistory.mock.calls[0];
    const assistantToolCallCount = savedHistory.filter(
      (m) => m.role === 'assistant' && m.tool_calls?.length,
    ).length;
    const toolResultCount = savedHistory.filter(
      (m) => m.role === 'tool',
    ).length;

    expect(toolResultCount).toBe(assistantToolCallCount);
  });
});