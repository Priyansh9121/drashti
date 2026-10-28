import { describe, expect, it } from 'vitest';
import { oneAtATime } from './one-at-a-time';

/* A burst of asks for the same read (Session 54): never two at once, and the last one always read. */

describe('a read asked for again while one is on its way', () => {
  it('runs once more after it, never alongside it, however often it is asked meanwhile', async () => {
    let reads = 0;
    let at = 0;
    let most = 0;
    const gate: (() => void)[] = [];
    const load = oneAtATime(async () => {
      at += 1;
      most = Math.max(most, at);
      reads += 1;
      await new Promise<void>((resolve) => gate.push(resolve));
      at -= 1;
    });
    const asked = [load(), load(), load(), load()];
    expect(reads).toBe(1);
    gate.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The asks meanwhile: one read more, not three.
    expect(reads).toBe(2);
    gate.shift()?.();
    await Promise.all(asked);
    expect(reads).toBe(2);
    expect(most).toBe(1);
    // Asked again once it is done: read again.
    const later = load();
    expect(reads).toBe(3);
    gate.shift()?.();
    await later;
  });

  it('reads again after a read that failed', async () => {
    let reads = 0;
    const load = oneAtATime(() => {
      reads += 1;
      return reads === 1 ? Promise.reject(new Error('placeholder')) : Promise.resolve();
    });
    await expect(load()).rejects.toThrow('placeholder');
    await load();
    expect(reads).toBe(2);
  });
});
