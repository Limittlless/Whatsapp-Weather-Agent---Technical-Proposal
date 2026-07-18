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
});
