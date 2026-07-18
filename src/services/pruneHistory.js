function groupIntoUnits(history) {
  const units = [];
  let i = 0;
  while (i < history.length) {
    const message = history[i];
    const toolCallIds = Array.isArray(message?.tool_calls)
      ? new Set(
          message.tool_calls.map((call) => call?.id).filter(Boolean)
        )
      : null;
    if (message?.role === 'assistant' && toolCallIds && toolCallIds.size > 0) {
      const unit = [message];
      let j = i + 1;
      while (
        j < history.length &&
        history[j]?.role === 'tool' &&
        toolCallIds.has(history[j]?.tool_call_id)
      ) {
        unit.push(history[j]);
        j += 1;
      }
      units.push(unit);
      i = j;
    } else {
      units.push([message]);
      i += 1;
    }
  }
  return units;
}

export function pruneHistory(history, maxMessages = 20) {
  if (!Array.isArray(history) || history.length <= maxMessages) {
    return history ?? [];
  }
  const naiveStart = history.length - maxMessages;
  const units = groupIntoUnits(history);
  let safeStart = naiveStart;
  let index = 0;
  for (const unit of units) {
    const unitStart = index;
    const unitEnd = index + unit.length;
    if (naiveStart > unitStart && naiveStart < unitEnd) {
      safeStart = unitStart;
      break;
    }
    index = unitEnd;
  }
  return history.slice(safeStart);
}
