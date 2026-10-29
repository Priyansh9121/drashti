import { describe, expect, it } from 'vitest';
import type { MessageItem } from '../../shared/engine/state';
import { DEFAULT_MESSAGE_LOOK, type MessageLook } from '../../shared/message-look';
import { DEFAULT_TIMER_LOOK, START_COUNTDOWN_LOOK } from '../../shared/timer-look';
import type { TimerDefinition } from '../../shared/timers';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * Session 55, Part 15, in the engine: a hall message's own look and its time up (it goes by itself, playing its out,
 * the same frame on every screen from the engine's clock); the stage message's size, flash and last few; and a timer
 * for the audience, one at a time, shown and hidden, going by itself at zero when its look says so, taken off by
 * Clear all and brought back by Put it back.
 */

const BOX: MessageLook = {
  ...DEFAULT_MESSAGE_LOOK,
  place: { row: 'top', column: 'left' },
  behind: 'box',
  animation: 'across-left-steady',
};

const countdown: TimerDefinition = {
  id: 't1',
  name: 'Placeholder activity',
  kind: 'countdown',
  durationMs: 60_000,
  targetTime: null,
  allowsOverrun: false,
};

function setup() {
  let clock = 1_000_000;
  const waiting: { at: number; run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(
    makeSource(),
    new RecordingTransport(),
    () => clock,
    new MemoryPlaylistSource(),
    {
      schedule: (delay, run) => {
        const job = { at: clock + delay, run, cancelled: false };
        waiting.push(job);
        return () => {
          job.cancelled = true;
        };
      },
    },
  );
  engine.setTimers([countdown, { ...countdown, id: 't2', name: 'Placeholder clock', kind: 'clock' }]);
  /** Time passes to `to`, each wait that comes due running then. */
  const until = (to: number) => {
    for (;;) {
      const due = waiting.filter((j) => !j.cancelled && j.at <= to).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      waiting.splice(waiting.indexOf(due), 1);
      clock = Math.max(clock, due.at);
      due.run();
    }
    clock = Math.max(clock, to);
  };
  return { engine, until, now: () => clock };
}

const message = (id: string, extra: Partial<MessageItem> = {}): MessageItem => ({
  id,
  text: `Placeholder message ${id}`,
  ...extra,
});

describe('a hall message’s look and its time up', () => {
  it('goes by itself after its time, playing its out from then; an update keeps its time', () => {
    const { engine, until, now } = setup();
    const start = now();
    engine.dispatch({ type: 'showMessage', message: message('m1', { look: BOX, seconds: 10 }) });
    expect(engine.current.layers.messages).toEqual([
      { ...message('m1', { look: BOX, seconds: 10 }), shownAt: start, until: start + 10_000 },
    ]);
    until(start + 4000);
    engine.dispatch({
      type: 'showMessage',
      message: { ...message('m1', { look: BOX, seconds: 10 }), text: 'Changed' },
    });
    expect(engine.current.layers.messages[0]).toMatchObject({
      text: 'Changed',
      shownAt: start,
      until: start + 10_000,
    });
    until(start + 9999);
    expect(engine.current.layers.messages).toHaveLength(1);
    until(start + 10_000);
    expect(engine.current.layers.messages).toEqual([]);
    expect(engine.current.messagesOff).toEqual([
      { message: expect.objectContaining({ id: 'm1', look: BOX }) as unknown, at: start + 10_000 },
    ]);
  });

  it('Take off: one with its own look plays its out, one with the standard band goes at once', () => {
    const { engine, now } = setup();
    engine.dispatch({ type: 'showMessage', message: message('own', { look: BOX }) });
    engine.dispatch({ type: 'showMessage', message: message('band') });
    engine.dispatch({ type: 'hideMessage', messageId: 'band' });
    expect(engine.current.messagesOff ?? []).toEqual([]);
    engine.dispatch({ type: 'hideMessage', messageId: 'own' });
    expect(engine.current.layers.messages).toEqual([]);
    expect(engine.current.messagesOff).toEqual([
      { message: expect.objectContaining({ id: 'own' }) as unknown, at: now() },
    ]);
    // Shown again: no longer leaving.
    engine.dispatch({ type: 'showMessage', message: message('own', { look: BOX }) });
    expect(engine.current.messagesOff ?? []).toEqual([]);
  });

  it('Clear messages plays their outs; Clear all takes them off at once', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'showMessage', message: message('own', { look: BOX }) });
    engine.dispatch({ type: 'clearLayer', layer: 'messages' });
    expect(engine.current.messagesOff).toHaveLength(1);
    engine.dispatch({ type: 'showMessage', message: message('own', { look: BOX }) });
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.layers.messages).toEqual([]);
    expect(engine.current.messagesOff ?? []).toEqual([]);
  });
});

describe('the stage message', () => {
  it('keeps its size and flash, and the last few, each once, the newest first', () => {
    const { engine, now } = setup();
    engine.dispatch({
      type: 'setStageMessage',
      text: 'Placeholder: five minutes',
      size: 'large',
      flash: true,
    });
    expect(engine.current.stageMessage).toBe('Placeholder: five minutes');
    expect(engine.current.stageCall).toEqual({ size: 'large', flash: true, shownAt: now() });
    // Without a size or flash (an older phone, the API): the standard size, no flash.
    engine.dispatch({ type: 'setStageMessage', text: 'Placeholder: two minutes' });
    expect(engine.current.stageCall).toEqual({ size: 'standard', flash: false, shownAt: now() });
    engine.dispatch({ type: 'setStageMessage', text: 'Placeholder: five minutes' });
    expect(engine.current.stageRecent).toEqual(['Placeholder: five minutes', 'Placeholder: two minutes']);
    // Hide takes it off; the last few stay a tap away.
    engine.dispatch({ type: 'clearStageMessage' });
    expect(engine.current.stageMessage).toBeNull();
    expect(engine.current.stageCall ?? null).toBeNull();
    expect(engine.current.stageRecent).toEqual(['Placeholder: five minutes', 'Placeholder: two minutes']);
  });

  it('remembers five', () => {
    const { engine } = setup();
    for (const n of [1, 2, 3, 4, 5, 6])
      engine.dispatch({ type: 'setStageMessage', text: `Placeholder ${String(n)}` });
    expect(engine.current.stageRecent).toEqual([
      'Placeholder 6',
      'Placeholder 5',
      'Placeholder 4',
      'Placeholder 3',
      'Placeholder 2',
    ]);
  });
});

describe('a timer for the audience', () => {
  it('is shown and hidden, one at a time, fading out from when it was hidden', () => {
    const { engine, now } = setup();
    expect(engine.dispatch({ type: 'showAudienceTimer', timerId: 'gone' })).toMatchObject({
      ok: false,
      error: 'unknown-timer',
    });
    engine.dispatch({ type: 'showAudienceTimer', timerId: 't1' });
    expect(engine.current.layers.timer).toEqual({ timerId: 't1', shownAt: now() });
    engine.dispatch({ type: 'showAudienceTimer', timerId: 't2' });
    expect(engine.current.layers.timer).toEqual({ timerId: 't2', shownAt: now() });
    engine.dispatch({ type: 'hideAudienceTimer' });
    expect(engine.current.layers.timer ?? null).toBeNull();
    expect(engine.current.timerOff).toEqual({ layer: { timerId: 't2', shownAt: now() }, at: now() });
    engine.dispatch({ type: 'showAudienceTimer', timerId: 't1' });
    expect(engine.current.timerOff ?? null).toBeNull();
  });

  it('Clear all takes it off at once, and Put it back brings it back', () => {
    const { engine, now } = setup();
    engine.dispatch({ type: 'showAudienceTimer', timerId: 't1' });
    const up = { timerId: 't1', shownAt: now() };
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.layers.timer ?? null).toBeNull();
    expect(engine.current.timerOff ?? null).toBeNull();
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.timer).toEqual(up);
  });

  it('goes by itself at zero when its look says so, and only then', () => {
    const { engine, until, now } = setup();
    engine.setTimers([{ ...countdown, look: { ...DEFAULT_TIMER_LOOK, atZero: 'gone' } }]);
    engine.dispatch({ type: 'startTimer', timerId: 't1' });
    const start = now();
    engine.dispatch({ type: 'showAudienceTimer', timerId: 't1' });
    until(start + 59_999);
    expect(engine.current.layers.timer).toMatchObject({ timerId: 't1' });
    until(start + 60_000);
    expect(engine.current.layers.timer ?? null).toBeNull();
    expect(engine.current.timerOff).toMatchObject({ at: start + 60_000 });
  });

  it('stays at zero when its look says so', () => {
    const { engine, until, now } = setup();
    engine.setTimers([{ ...countdown, look: { ...DEFAULT_TIMER_LOOK, atZero: 'stay' } }]);
    engine.dispatch({ type: 'startTimer', timerId: 't1' });
    engine.dispatch({ type: 'showAudienceTimer', timerId: 't1' });
    until(now() + 120_000);
    expect(engine.current.layers.timer).toMatchObject({ timerId: 't1' });
  });

  it('Countdown to the start goes at the sabha’s time, started or not', () => {
    const { engine, until, now } = setup();
    const at = new Date(now() + 30 * 60_000);
    const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const zero = new Date(at);
    zero.setSeconds(0, 0);
    engine.setTimers([
      {
        id: 'q',
        name: 'Countdown to the start',
        kind: 'countdown_to_time',
        durationMs: 0,
        targetTime: time,
        allowsOverrun: false,
        look: START_COUNTDOWN_LOOK,
      },
    ]);
    engine.dispatch({ type: 'showAudienceTimer', timerId: 'q' });
    until(zero.getTime() - 1);
    expect(engine.current.layers.timer).toMatchObject({ timerId: 'q' });
    until(zero.getTime());
    expect(engine.current.layers.timer ?? null).toBeNull();
  });

  it('goes when its timer is removed from the library', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'showAudienceTimer', timerId: 't1' });
    engine.setTimers([{ ...countdown, id: 't2' }]);
    expect(engine.current.layers.timer ?? null).toBeNull();
  });
});
