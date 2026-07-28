const tails = new Map();

export function runExclusive(key, task) {
  const previousTail = tails.get(key) ?? Promise.resolve();

  const current = previousTail.then(task, task);

  const tailForChaining = current.then(
    () => undefined,
    () => undefined,
  );

  tails.set(key, tailForChaining);

  tailForChaining.finally(() => {
    if (tails.get(key) === tailForChaining) {
      tails.delete(key);
    }
  });

  return current;
}

export function __resetKeyedQueueForTests() {
  tails.clear();
}
