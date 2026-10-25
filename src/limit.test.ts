/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { limiter } from './limit';

describe('limiter', () => {
  test('at most n tasks run at once, all of them finish in order of start, a failure frees its slot', async () => {
    for (const n of [1, 3]) {
      const limit = limiter(n);
      let now = 0;
      let peak = 0;
      const started: number[] = [];
      const run = (i: number) => limit(async () => {
        started.push(i);
        now += 1;
        peak = Math.max(peak, now);
        await Bun.sleep(5);
        now -= 1;
        if (i === 2) throw new Error('bad pdf');
        return i;
      });
      const results = await Promise.allSettled([0, 1, 2, 3, 4, 5, 6].map(run));
      expect(peak).toBe(n);
      expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(results.map(r => (r.status === 'fulfilled' ? r.value : 'failed'))).toEqual([0, 1, 'failed', 3, 4, 5, 6]);
    }
  });
});
