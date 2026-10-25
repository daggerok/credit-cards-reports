/// <reference lib="esnext" />
/** Runs at most `n` of the given tasks at a time, the rest wait in order (used to read a few PDFs at once). */
export function limiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running < n) running += 1;
    else await new Promise<void>(resolve => waiting.push(resolve));
    try {
      return await task();
    } finally {
      release();
    }
  };
}
