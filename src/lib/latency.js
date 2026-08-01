import { performance } from 'node:perf_hooks';

function writeLatencyEvent(traceId, stage, startedAt, status, details) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  console.info(
    '[latency]',
    JSON.stringify({
      traceId,
      stage,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      status,
      ...details,
    }),
  );
}

export async function measureLatency(
  traceId,
  stage,
  operation,
  details = {},
) {
  const startedAt = performance.now();

  try {
    const result = await operation();
    writeLatencyEvent(traceId, stage, startedAt, 'ok', details);
    return result;
  } catch (error) {
    writeLatencyEvent(traceId, stage, startedAt, 'error', details);
    throw error;
  }
}

export function startLatencyTimer() {
  return performance.now();
}

export function finishLatencyTimer(
  traceId,
  stage,
  startedAt,
  status = 'ok',
  details = {},
) {
  writeLatencyEvent(traceId, stage, startedAt, status, details);
}
