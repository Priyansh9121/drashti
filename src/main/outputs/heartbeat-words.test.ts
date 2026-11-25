import { describe, expect, it } from 'vitest';
import { RESTARTS_TOLD } from './heartbeat';
import { keepsRestartingLine, keptLine, restartsWords } from './heartbeat-words';

describe('the log of an output restarted again and again (a23-heartbeat)', () => {
  it('says which restart in a row it is, from the second', () => {
    expect(restartsWords(1)).toBe('');
    expect(restartsWords(2)).toBe(' (2 times in a row)');
    expect(`Output "Main Hall" is stuck (no report for 7 s): restarting it${restartsWords(5)}`).toBe(
      'Output "Main Hall" is stuck (no report for 7 s): restarting it (5 times in a row)',
    );
  });

  it('says once, in plain words, why the screen keeps restarting, what Drashti does and what Try again does', () => {
    expect(keepsRestartingLine('Output "Main Hall"', RESTARTS_TOLD)).toBe(
      'Output "Main Hall" was restarted 4 times in a row: its page stopped answering each time (this computer may be too slow for it, or something on it stops the page each time it loads). Drashti keeps restarting it, about once a minute; Screens and the status line say so, and Try again in Screens restarts it now.',
    );
  });
});

describe('the log of a page kept as it is, held for the owner (QA23-HEARTBEAT-1, A)', () => {
  it('says why it is not restarted, that it may still catch up, and what Try again does', () => {
    expect(keptLine('Output "Main Hall"', 'no report for 61 s', 4)).toBe(
      'Output "Main Hall" is stuck again (no report for 61 s) after 4 restarts in a row: Drashti stopped restarting it and left it as it is, so a slow computer can catch up; it is shown as Stopped, tried again by itself in a few minutes, and Try again restarts it now.',
    );
  });
});
