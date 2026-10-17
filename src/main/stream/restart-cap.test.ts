import { describe, expect, it } from 'vitest';
import { RestartCap } from './restart-cap';

/* The stream's page started again at most 5 times a minute (Session 31, ROB-7). */

describe('the stream page’s restarts', () => {
  it('allows 5 in a minute; the sixth crash waits for Try again', () => {
    const cap = new RestartCap();
    const at = 1_000_000;
    for (let i = 0; i < 5; i++) expect(cap.allow(at + i * 1000)).toBe(true);
    expect(cap.allow(at + 6000)).toBe(false);
    expect(cap.allow(at + 7000)).toBe(false);
  });

  it('counts only the last minute’s, and starts afresh after Try again', () => {
    const cap = new RestartCap();
    for (let i = 0; i < 5; i++) expect(cap.allow(i * 10_000)).toBe(true);
    // The first was more than a minute ago: room for one more.
    expect(cap.allow(61_000)).toBe(true);
    expect(cap.allow(62_000)).toBe(false);
    cap.reset();
    expect(cap.allow(63_000)).toBe(true);
  });
});
