import { describe, expect, it } from 'vitest';
import type { ScreenStatus } from './screens';
import { RESTARTING_WORDS, restartingSentence, screensSummary, stoppedSentence } from './screens-summary';

const st = (screenId: string, state: ScreenStatus['state'], restarts?: number): ScreenStatus => ({
  screenId,
  state,
  displayId: state === 'showing' || state === 'stopped' ? 2 : null,
  ...(restarts === undefined ? {} : { restarts }),
});

describe('the status line’s screens', () => {
  it('says them as before: showing, displays not connected and stopped', () => {
    expect(screensSummary([])).toEqual({ text: 'No screens set up', tone: 'muted' });
    expect(screensSummary([st('a', 'showing'), st('b', 'showing')])).toEqual({
      text: '2 screens showing',
      tone: 'muted',
    });
    expect(screensSummary([st('a', 'showing'), st('b', 'missing-display')])).toEqual({
      text: '1 screen showing · 1 display not connected',
      tone: 'warning',
    });
    expect(screensSummary([st('a', 'showing'), st('b', 'missing-display'), st('c', 'stopped')])).toEqual({
      text: '1 screen showing · 1 display not connected · 1 stopped',
      tone: 'danger',
    });
  });

  it('says a screen restarted again and again apart from those showing, in red (a23-heartbeat)', () => {
    expect(screensSummary([st('a', 'showing'), st('b', 'showing', 4)])).toEqual({
      text: '1 screen showing · 1 keeps restarting',
      tone: 'danger',
    });
    expect(
      screensSummary([
        st('a', 'showing', 5),
        st('b', 'showing', 4),
        st('c', 'missing-display'),
        st('d', 'stopped'),
      ]),
    ).toEqual({
      text: '0 screens showing · 1 display not connected · 2 keep restarting · 1 stopped',
      tone: 'danger',
    });
  });
});

describe('a screen restarted again and again, in Screens (a23-heartbeat)', () => {
  it('is named so beside it, and why in plain words, with what Try again does', () => {
    expect(RESTARTING_WORDS).toBe('Keeps restarting');
    expect(restartingSentence(4)).toBe(
      'It stopped answering, so Drashti restarted it 4 times in a row. It keeps trying, about once a minute. Try again restarts it now.',
    );
    expect(restartingSentence(7)).toContain('7 times in a row');
  });
});

describe('a stopped screen, in its notice and in Screens', () => {
  it('kept failing: black for now, as before', () => {
    expect(stoppedSentence(st('a', 'stopped'))).toBe(
      'It kept failing, so it is black for now. Drashti tries it again by itself every few minutes.',
    );
  });

  it('held for the owner (QA23-HEARTBEAT-1, A): kept as it is after it stopped answering, it may still catch up', () => {
    expect(stoppedSentence({ ...st('a', 'stopped'), notAnswering: true })).toBe(
      'It stopped answering after 4 restarts in a row, so Drashti stopped restarting it and left it as it is: it may still catch up. Drashti tries it again by itself every few minutes.',
    );
  });
});
