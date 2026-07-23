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
import {
  getUsageSnapshot,
  __resetUsageForTests,
} from '../src/services/usageMetrics.js';

describe('runAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetUsageForTests();
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

  it('discards an oversized/degenerate reply instead of sending or saving it', async () => {
    const degenerateContent = 'a'.repeat(4000);

    const model = {
      invoke: vi.fn().mockResolvedValue(
        new AIMessage({ content: degenerateContent }),
      ),
    };

    const result = await runAgent({
      whatsappId: '212600000000',
      userMessage: 'What is the weather?',
      model,
    });

    expect(result).not.toBe(degenerateContent);
    expect(result.length).toBeLessThan(200);

    expect(saveConversationHistory).toHaveBeenCalledTimes(1);
    const [, savedHistory] = saveConversationHistory.mock.calls[0];
    expect(
      savedHistory.some((m) => m.content === degenerateContent),
    ).toBe(false);
  });

  it('discards a reply that leaks a raw functionCall/thoughtSignature blob', async () => {
    const leakedContent =
      'دعني أتحقق{"thoughtSignature":"xyz","type":"functionCall","functionCall":{"name":"get_current_weather","args":{}}}';

    const model = {
      invoke: vi.fn().mockResolvedValue(
        new AIMessage({ content: leakedContent }),
      ),
    };

    const result = await runAgent({
      whatsappId: '212600000000',
      userMessage: 'What is the weather?',
      model,
    });

    expect(result).not.toBe(leakedContent);
    expect(result).not.toContain('functionCall');
  });

  it('recovers a raw function call even when prefixed with model chatter', async () => {
    const firstResponse = new AIMessage({
      content:
        'One moment{"type":"functionCall","functionCall":{"name":"geocode_location","args":{"location":"Cairo"},"id":"call-9"}}',
    });

    const finalResponse = new AIMessage({ content: 'It is warm in Cairo.' });

    const model = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(finalResponse),
    };

    executeToolCall.mockResolvedValue({
      getType: () => 'tool',
      content: '{"latitude":30.04,"longitude":31.24}',
      tool_call_id: 'call-9',
      name: 'geocode_location',
    });

    const result = await runAgent({
      whatsappId: '212600000000',
      userMessage: 'Weather in Cairo?',
      model,
    });

    expect(result).toBe('It is warm in Cairo.');
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'geocode_location' }),
    );
  });

  it('records a successful Gemini call in usage metrics', async () => {
    const model = {
      invoke: vi.fn().mockResolvedValue(
        new AIMessage({ content: 'Hello!' }),
      ),
    };

    await runAgent({
      whatsappId: '212600000000',
      userMessage: 'Hello',
      model,
    });

    const snapshot = getUsageSnapshot();
    expect(snapshot.geminiCallsTotal).toBe(1);
    expect(snapshot.geminiCallsOk).toBe(1);
    expect(snapshot.geminiCallsFailed).toBe(0);
  });

  it('records each Gemini call across multiple tool-use iterations', async () => {
    const firstResponse = new AIMessage({
      content: '',
      tool_calls: [
        { id: 'call-1', name: 'geocode_location', args: { location: 'X' } },
      ],
    });
    const finalResponse = new AIMessage({ content: 'Done.' });

    const model = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(finalResponse),
    };

    executeToolCall.mockResolvedValue({
      getType: () => 'tool',
      content: '{}',
      tool_call_id: 'call-1',
      name: 'geocode_location',
    });

    await runAgent({
      whatsappId: '212600000000',
      userMessage: 'Weather?',
      model,
    });

    expect(getUsageSnapshot().geminiCallsTotal).toBe(2);
  });

  it('records a failed Gemini call in usage metrics', async () => {
    const model = {
      invoke: vi.fn().mockRejectedValue(new Error('Gemini service unavailable')),
    };

    await runAgent({
      whatsappId: '212600000000',
      userMessage: 'What is the weather?',
      model,
    });

    const snapshot = getUsageSnapshot();
    expect(snapshot.geminiCallsTotal).toBe(1);
    expect(snapshot.geminiCallsFailed).toBe(1);
    expect(snapshot.lastGeminiError.message).toBe('Gemini service unavailable');
  });
});