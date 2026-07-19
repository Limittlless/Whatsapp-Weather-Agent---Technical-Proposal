import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIMessage } from '@langchain/core/messages';

const inMemoryStore = new Map();

vi.mock('../src/services/conversationStore.js', () => ({
  getConversationHistory: vi.fn(async (whatsappId) => {
    return inMemoryStore.get(whatsappId) ?? [];
  }),
  saveConversationHistory: vi.fn(async (whatsappId, history) => {
    inMemoryStore.set(whatsappId, history);
  }),
}));

vi.mock('../src/agent/executeToolCall.js', () => ({
  executeToolCall: vi.fn(),
}));

import { runAgent } from '../src/agent/runAgent.js';
import { executeToolCall } from '../src/agent/executeToolCall.js';
import {
  getConversationHistory,
  saveConversationHistory,
} from '../src/services/conversationStore.js';

describe('multi-turn session behavior', () => {
  beforeEach(() => {
    inMemoryStore.clear();
    vi.clearAllMocks();
  });

  it('carries prior turns forward into the next model call', async () => {
    const whatsappId = '212600000001';

    const firstModel = {
      invoke: vi
        .fn()
        .mockResolvedValue(new AIMessage({ content: 'Hi! How can I help?' })),
    };

    await runAgent({
      whatsappId,
      userMessage: 'Hello',
      model: firstModel,
    });

    const secondModel = {
      invoke: vi
        .fn()
        .mockResolvedValue(new AIMessage({ content: 'Sure, one moment.' })),
    };

    await runAgent({
      whatsappId,
      userMessage: 'Can you help me with the weather?',
      model: secondModel,
    });

    const messagesSentToSecondModel = secondModel.invoke.mock.calls[0][0];
    const contents = messagesSentToSecondModel.map((m) => m.content);

    expect(contents).toContain('Hello');
    expect(contents).toContain('Hi! How can I help?');
    expect(contents).toContain('Can you help me with the weather?');
  });

  it('keeps each WhatsApp user session independent from the others', async () => {
    const userA = '212600000001';
    const userB = '212600000002';

    await runAgent({
      whatsappId: userA,
      userMessage: 'My name is A',
      model: {
        invoke: vi
          .fn()
          .mockResolvedValue(new AIMessage({ content: 'Nice to meet you, A.' })),
      },
    });

    const modelForB = {
      invoke: vi
        .fn()
        .mockResolvedValue(new AIMessage({ content: 'Hi there.' })),
    };

    await runAgent({
      whatsappId: userB,
      userMessage: 'Hello',
      model: modelForB,
    });

    const messagesSentForB = modelForB.invoke.mock.calls[0][0];
    const contents = messagesSentForB.map((m) => m.content);

    expect(contents).not.toContain('My name is A');
    expect(contents).not.toContain('Nice to meet you, A.');
  });

  it('preserves tool-call results in context for a follow-up question', async () => {
    const whatsappId = '212600000003';

    executeToolCall.mockResolvedValue({
      getType: () => 'tool',
      content: JSON.stringify({
        cityName: 'Agadir',
        latitude: 30.4278,
        longitude: -9.5981,
      }),
      tool_call_id: 'call-1',
      name: 'geocode_location',
    });

    const firstModel = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce(
          new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'call-1',
                name: 'geocode_location',
                args: { location: 'Agadir' },
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          new AIMessage({ content: 'Agadir is on the Moroccan coast.' })
        ),
    };

    await runAgent({
      whatsappId,
      userMessage: 'Where is Agadir?',
      model: firstModel,
    });

    const secondModel = {
      invoke: vi
        .fn()
        .mockResolvedValue(
          new AIMessage({ content: 'Its coordinates are 30.43, -9.6.' })
        ),
    };

    await runAgent({
      whatsappId,
      userMessage: 'What were its exact coordinates again?',
      model: secondModel,
    });

    const messagesSentToSecondModel = secondModel.invoke.mock.calls[0][0];
    const toolMessage = messagesSentToSecondModel.find(
      (m) => m.getType?.() === 'tool'
    );

    expect(toolMessage).toBeDefined();
    expect(toolMessage.content).toContain('Agadir');
  });

  it('keeps the system persona message present across many turns', async () => {
    const whatsappId = '212600000004';

    for (let i = 0; i < 8; i += 1) {
      const model = {
        invoke: vi
          .fn()
          .mockResolvedValue(new AIMessage({ content: `Reply ${i}` })),
      };

      await runAgent({
        whatsappId,
        userMessage: `Message ${i}`,
        model,
      });
    }

    const finalStoredHistory = await getConversationHistory(whatsappId);

    expect(finalStoredHistory[0].role).toBe('system');
    expect(
      finalStoredHistory.filter((m) => m.role === 'system')
    ).toHaveLength(1);
  });

  it('actually persists to the store between turns (not just in-memory within one call)', async () => {
    const whatsappId = '212600000005';

    await runAgent({
      whatsappId,
      userMessage: 'First message',
      model: {
        invoke: vi
          .fn()
          .mockResolvedValue(new AIMessage({ content: 'First reply' })),
      },
    });

    expect(saveConversationHistory).toHaveBeenCalledTimes(1);

    await runAgent({
      whatsappId,
      userMessage: 'Second message',
      model: {
        invoke: vi
          .fn()
          .mockResolvedValue(new AIMessage({ content: 'Second reply' })),
      },
    });

    expect(getConversationHistory).toHaveBeenCalledWith(whatsappId);
    const historyAfterBothTurns = await getConversationHistory(whatsappId);
    const userMessages = historyAfterBothTurns
      .filter((m) => m.role === 'user')
      .map((m) => m.content);

    expect(userMessages).toEqual(['First message', 'Second message']);
  });
});
