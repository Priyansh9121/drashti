import { describe, expect, it } from 'vitest';
import { renderErrorReport } from '../shared/render-errors';
import { RenderErrorLog } from './render-errors';

describe('render errors in the log (Session 23)', () => {
  it('one line per window every 10 s at most, saying how many were held back', () => {
    let now = 1_000_000;
    const lines: string[] = [];
    const log = new RenderErrorLog(
      (line) => lines.push(line),
      () => now,
    );
    const report = renderErrorReport(
      'output',
      'caught',
      new Error('boom'),
      '\n    at ThrowForTests (output.js:1:1)\n    at Output',
    );
    expect(log.report('output "Main Hall"', report)).toBe(true);
    now += 2000;
    expect(log.report('output "Main Hall"', report)).toBe(false);
    expect(log.report('output "Main Hall"', report)).toBe(false);
    // Another window has its own line.
    expect(log.report('operator', report)).toBe(true);
    now += 8000;
    expect(log.report('output "Main Hall"', report)).toBe(true);
    expect(lines).toEqual([
      'Render error in output "Main Hall" (caught): Error: boom (in ThrowForTests)',
      'Render error in operator (caught): Error: boom (in ThrowForTests)',
      'Render error in output "Main Hall" (caught): Error: boom (in ThrowForTests); 2 more in this window since the last line',
    ]);
  });

  it('a report is plain text, cut short', () => {
    const r = renderErrorReport('x'.repeat(100), 'uncaught', 'not an Error', 'y'.repeat(5000));
    expect(r.where).toHaveLength(40);
    expect(r.message).toBe('not an Error');
    expect(r.stack).toBeNull();
    expect(r.componentStack).toHaveLength(2000);
  });
});
