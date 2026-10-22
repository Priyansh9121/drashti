import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState } from '../../shared/engine/state';
import { initialEngineState } from '../../shared/engine/state';
import { BUILT_IN_TIMER_LOOK, timerAloneSlide } from '../../shared/timer-slides';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import type { RecoveryFiles } from './live-state';
import { savedFrom, toRestore } from './live-state';

/*
 * A timer shown alone (Session 50) after an unexpected stop: saved as the slide the show was at with the timer
 * over it, and put back so, still (no transition plays again), Next going on from there as before. Its slide
 * is never looked for in the library: it is no presentation's.
 */

let dir: string;
let files: RecoveryFiles;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-timer-recovery-'));
  files = { state: join(dir, 'live-state.json'), cleanMark: join(dir, 'live-state.clean') };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SAVED_AT = new Date('2026-09-01T10:00:00.000Z');
const STARTED = new Date('2026-09-01T10:05:00.000Z');

/** The show at p1's third slide (an arrangement's), and the timer t1 up alone over it. */
function timerUp(): EngineState {
  const s = initialEngineState();
  return {
    ...s,
    live: { presentationId: 'p1', slideIndex: 2, slideCount: 3, arrangementId: 'a1', playlist: null },
    layers: {
      ...s.layers,
      slide: {
        presentationId: 'timer:t1',
        slideIndex: 0,
        slide: timerAloneSlide('t1', BUILT_IN_TIMER_LOOK),
        shownAt: 5,
        notes: '',
        transition: { kind: 'dissolve', durationMs: 500 },
        timer: { timerId: 't1', name: 'Placeholder countdown' },
      },
    },
  };
}

describe('a timer shown alone, after an unexpected stop', () => {
  it('is saved as the slide the show was at, and the timer over it', () => {
    const saved = savedFrom(timerUp(), 'run-1', SAVED_AT);
    expect(saved.slide).toEqual({ presentationId: 'p1', slideIndex: 2, arrangementId: 'a1' });
    expect(saved.timer).toEqual({ timerId: 't1' });
    // Nothing live under it: the timer alone.
    const alone = savedFrom({ ...timerUp(), live: initialEngineState().live }, 'run-1', SAVED_AT);
    expect(alone.slide).toBeNull();
    expect(alone.timer).toEqual({ timerId: 't1' });
    // Any other show: as before, with no timer.
    expect('timer' in savedFrom(initialEngineState(), 'run-1', SAVED_AT)).toBe(false);
  });

  it('is read back as something to put back', () => {
    const alone = savedFrom({ ...timerUp(), live: initialEngineState().live }, 'run-1', SAVED_AT);
    writeFileSync(files.state, JSON.stringify(alone));
    expect(toRestore(files, null, STARTED)).toMatchObject({ slide: null, timer: { timerId: 't1' } });
    writeFileSync(files.state, JSON.stringify({ ...alone, timer: { timerId: '' } }));
    expect(toRestore(files, null, STARTED)).toBeNull();
  });

  it('comes back over that slide, still, and Next goes on from there; its timer gone, only the slide', () => {
    let clock = 50_000;
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => clock);
    engine.setTimers([
      {
        id: 't1',
        name: 'Placeholder countdown',
        kind: 'countdown',
        durationMs: 300_000,
        targetTime: null,
        allowsOverrun: false,
      },
    ]);
    const put = engine.restore({
      slide: { presentationId: 'p1', slideIndex: 1, arrangementId: null },
      background: null,
      blackout: false,
      timer: { timerId: 't1' },
    });
    expect(put).toMatchObject({ slide: true, timer: true });
    expect(engine.current.layers.slide).toMatchObject({
      presentationId: 'timer:t1',
      shownAt: 50_000,
      timer: { timerId: 't1', name: 'Placeholder countdown' },
    });
    expect(engine.current.layers.slide?.transition).toBeUndefined();
    expect(engine.current.live).toMatchObject({ presentationId: 'p1', slideIndex: 1 });
    clock += 1000;
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide?.slide.id).toBe('p1s3');

    const again = new ShowEngine(makeSource(), new RecordingTransport(), () => clock);
    const back = again.restore({
      slide: { presentationId: 'p1', slideIndex: 1, arrangementId: null },
      background: null,
      blackout: false,
      timer: { timerId: 'gone' },
    });
    expect(back.slide).toBe(true);
    expect(back.timer).toBeUndefined();
    expect(again.current.layers.slide?.slide.id).toBe('p1s2');
  });
});
