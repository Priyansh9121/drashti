import { describe, expect, it } from 'vitest';
import { phaseLine, windowStartLine } from './start-phases';

/* The start's phase lines (Sessions 31–36, PERF-1), and the operator window's own (question 36 of Session 54). */

describe('the start’s phase lines', () => {
  it('says a phase at its time since the main process began', () => {
    expect(phaseLine('library open')).toMatch(/^Start: library open at \d+ ms$/u);
  });

  it('says when the operator window drew its controls, and when it knew each thing it waited for', () => {
    const began = 1_793_000_000_000;
    const line = windowStartLine(
      { access: began + 700, mode: began + 705, keys: began + 706, info: began + 15_710, drawn: began + 712 },
      began,
    );
    expect(line).toBe(
      'Start: operator window drawn at 712 ms (its access known at 700 ms, its mode at 705 ms, its single-letter keys at 706 ms, its version at 15710 ms)',
    );
  });
});
