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

/**
 * Core pruning logic, operating on a history that is assumed NOT to start
 * with a system message (the caller carves that out first). Same
 * boundary-extension strategy as before: never split a tool-call unit,
 * extend the cut point backward instead of dropping partial units.
 */
function pruneWithoutLeadingSystemMessage(history, maxMessages) {
  if (history.length <= maxMessages) {
    return history;
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

/**
 * Trims conversation history down to (at most) `maxMessages`, keeping the
 * most recent messages, without ever leaving an orphaned tool-result
 * message (one whose triggering assistant tool_calls message got cut) or
 * an orphaned assistant tool_calls message (one whose results got cut).
 *
 * A leading system message (the persona/instructions prompt) is always
 * preserved, regardless of how long the conversation grows. It is pulled
 * out before pruning and re-attached after, using one slot of the budget
 * so the effective limit for the rest of the conversation is
 * `maxMessages - 1`. Without this, a long-running conversation would
 * eventually prune the system message away entirely, silently losing the
 * agent's instructions with no error or warning.
 *
 * Strategy for the remaining messages: find the naive cut point
 * (length - budget), then check whether it lands inside a tool-call unit.
 * If it does, push the cut point backward to the start of that unit — we
 * extend the window to stay orphan-safe rather than dropping the group,
 * since the whole point of pruning is to preserve as much *usable* recent
 * context as possible, not to hit an exact message count. This means the
 * result can be a few messages over `maxMessages` when a tool-call group
 * straddles the boundary, which is expected and fine.
 */
export function pruneHistory(history, maxMessages = 20) {
  if (!Array.isArray(history) || history.length === 0) {
    return history ?? [];
  }

  const hasLeadingSystemMessage = history[0]?.role === 'system';

  if (!hasLeadingSystemMessage) {
    return pruneWithoutLeadingSystemMessage(history, maxMessages);
  }

  const systemMessage = history[0];
  const rest = history.slice(1);
  // Reserve one slot for the system message so the rest of the
  // conversation still gets close to `maxMessages` worth of budget.
  const budgetForRest = Math.max(maxMessages - 1, 1);

  return [systemMessage, ...pruneWithoutLeadingSystemMessage(rest, budgetForRest)];
}
