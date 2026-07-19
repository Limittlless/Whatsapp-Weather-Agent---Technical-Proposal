import { describe, it, expect } from 'vitest';
import { pruneHistory } from '../src/services/pruneHistory.js';

function userMsg(content) {
  return { role: 'user', content };
}

function assistantMsg(content) {
  return { role: 'assistant', content };
}

function assistantToolCallMsg(content, toolCallIds) {
  return {
    role: 'assistant',
    content,
    tool_calls: toolCallIds.map((id) => ({ id, name: 'geocode_location' })),
  };
}

function toolResultMsg(toolCallId, content) {
  return { role: 'tool', tool_call_id: toolCallId, content };
}

describe('pruneHistory', () => {
  it('returns the history unchanged when under the limit', () => {
    const history = [userMsg('hi'), assistantMsg('hello')];
    expect(pruneHistory(history, 10)).toEqual(history);
  });
  it('returns an empty array when given null/undefined', () => {
    expect(pruneHistory(null, 10)).toEqual([]);
    expect(pruneHistory(undefined, 10)).toEqual([]);
  });
  it('trims oldest standalone messages down to the limit', () => {
    const history = [
      userMsg('1'),
      assistantMsg('2'),
      userMsg('3'),
      assistantMsg('4'),
      userMsg('5'),
      assistantMsg('6'),
    ];
    const result = pruneHistory(history, 4);
    expect(result).toEqual(history.slice(-4));
  });
  it('never splits a tool-call group even if it means going over the limit', () => {
    const history = [
      userMsg('old message 1'),
      userMsg('old message 2'),
      userMsg('What is the weather in Cairo?'),
      assistantToolCallMsg(null, ['call_1']),
      toolResultMsg('call_1', '{"temp": 32}'),
      assistantMsg('It is 32°C in Cairo.'),
    ];
    const result = pruneHistory(history, 2);
    expect(result).toEqual([
      assistantToolCallMsg(null, ['call_1']),
      toolResultMsg('call_1', '{"temp": 32}'),
      assistantMsg('It is 32°C in Cairo.'),
    ]);
  });
  it('keeps multiple parallel tool calls and their results together as one unit', () => {
    const history = [
      userMsg('old'),
      userMsg('Compare weather in Cairo and Marrakesh'),
      assistantToolCallMsg(null, ['call_1', 'call_2']),
      toolResultMsg('call_1', '{"temp": 32}'),
      toolResultMsg('call_2', '{"temp": 28}'),
      assistantMsg('Cairo is 32°C, Marrakesh is 28°C.'),
    ];
    const result = pruneHistory(history, 3);
    expect(result).toEqual(history.slice(2));
    expect(result.length).toBeGreaterThan(3);
  });
  it('does not include any tool message whose id has no matching tool_calls', () => {
    const history = [
      toolResultMsg('orphan_call', 'stray result'),
      userMsg('1'),
      userMsg('2'),
      userMsg('3'),
    ];
    const result = pruneHistory(history, 2);
    expect(result).toEqual([userMsg('2'), userMsg('3')]);
  });
  it('keeps the newest unit whole even if it alone exceeds maxMessages', () => {
    const history = [
      userMsg('older'),
      userMsg('Check weather in 5 cities'),
      assistantToolCallMsg(null, ['c1', 'c2', 'c3', 'c4', 'c5']),
      toolResultMsg('c1', '1'),
      toolResultMsg('c2', '2'),
      toolResultMsg('c3', '3'),
      toolResultMsg('c4', '4'),
      toolResultMsg('c5', '5'),
    ];
    const result = pruneHistory(history, 2);
    expect(result).toEqual(history.slice(2));
    expect(result.length).toBe(6);
  });

  it('always preserves a leading system message, even in a long conversation', () => {
    const systemMsg = { role: 'system', content: 'SYSTEM PROMPT' };
    const turns = [];
    for (let i = 0; i < 25; i += 1) {
      turns.push(i % 2 === 0 ? userMsg(`msg ${i}`) : assistantMsg(`msg ${i}`));
    }

    const history = [systemMsg, ...turns];
    const result = pruneHistory(history, 20);

    expect(result[0]).toEqual(systemMsg);
    expect(result.filter((m) => m.role === 'system')).toHaveLength(1);
    // Budget for the rest is maxMessages - 1 (one slot reserved for system).
    expect(result.length).toBe(20);
  });

  it('does not add a system message that was never there', () => {
    const history = [userMsg('1'), assistantMsg('2'), userMsg('3')];

    const result = pruneHistory(history, 2);

    expect(result.some((m) => m.role === 'system')).toBe(false);
  });

  it('keeps the system message safe even when a tool-call group straddles the boundary', () => {
    const systemMsg = { role: 'system', content: 'SYSTEM PROMPT' };
    const history = [
      systemMsg,
      userMsg('old message 1'),
      userMsg('old message 2'),
      userMsg('What is the weather in Cairo?'),
      assistantToolCallMsg(null, ['call_1']),
      toolResultMsg('call_1', '{"temp": 32}'),
      assistantMsg('It is 32°C in Cairo.'),
    ];

    const result = pruneHistory(history, 3);

    expect(result[0]).toEqual(systemMsg);
    expect(result).toEqual([
      systemMsg,
      assistantToolCallMsg(null, ['call_1']),
      toolResultMsg('call_1', '{"temp": 32}'),
      assistantMsg('It is 32°C in Cairo.'),
    ]);
  });
});
