import { describe, expect, it } from 'vitest';
import type { MediaElement } from '../../shared/model';
import { NO_FIRST_FRAME, NO_START_IN_TIME } from '../../shared/no-picture';
import { NOT_ON_SCREENS_MAX, notOnScreensNow, stillUp } from '../../shared/not-on-screens';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport, textSlide } from '../engine/testing';
import { CannotPlay, type CannotPlayWhere, type Heard, HallWords } from './cannot-play';

/*
 * A slide's video up but not playing (paused, or waiting for its click) that a screen could not play (alpha.23,
 * a22-halldrop), through the real engine: Main's take-off finds nothing to take off, but the showing is still up, so
 * the operator is told once for each screen, and LIVE names the screens that do not show it, until each shows it after
 * all, a GPU process stops (every failed video loads again), its page loads again or it goes, or the showing goes.
 * Placeholder ids and names only.
 */

const VIDEO: MediaElement = {
  id: 'onslide-el',
  kind: 'video',
  mediaId: 'onslide',
  frame: { x: 0, y: 0, width: 640, height: 360 },
  fit: 'fit',
  loop: false,
};

const HALL: CannotPlayWhere = { screen: 'Placeholder Hall', id: 'screen-hall' };
const SIDE: CannotPlayWhere = { screen: 'Placeholder Side', id: 'screen-side' };
const NAMES: Record<string, string> = {
  'screen-hall': 'Placeholder Hall',
  'screen-side': 'Placeholder Side',
};

function setup() {
  const source = makeSource();
  const words = textSlide('o1', 'Placeholder words');
  source.set('onslide', [{ ...words, elements: [VIDEO, ...words.elements] }]);
  source.set('other', [textSlide('w1', 'Placeholder other words')]);
  let clock = 1_000_000;
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, undefined, {
    mediaLength: () => 40_000,
    mediaKind: () => 'video',
  });
  engine.dispatch({ type: 'goLive', presentationId: 'onslide', slideIndex: 0 });
  const at = engine.current.layers.slide?.shownAt ?? 0;
  const words2 = new HallWords();
  /** A word from `wheres` after the wait, the take-off run first, as Main's handler has it. */
  const heard = (wheres: CannotPlayWhere[], code = 3) => {
    const took = engine.cannotPlay('onslide', at);
    const h: Heard = {
      name: 'Placeholder slide video',
      mediaId: 'onslide',
      wheres,
      code,
      words: '',
      took,
      stillUp: stillUp(engine.current, 'onslide', at),
    };
    return words2.heard(h, at);
  };
  const lines = () => words2.list((id) => NAMES[id]).flatMap((e) => e.lines);
  return {
    engine,
    at,
    hallWords: words2,
    heard,
    lines,
    elapse: (ms: number) => {
      clock += ms;
    },
    pause: () =>
      engine.dispatch({ type: 'pausePlaying', playing: { layer: 'slide', mediaId: 'onslide' } }).ok,
  };
}

describe('a slide’s video up but not playing that a screen could not play (alpha.23, a22-halldrop)', () => {
  it('takes nothing off, but is still up: told, and named under LIVE until its slide goes', () => {
    const { engine, at, hallWords, heard, lines, elapse, pause } = setup();
    elapse(2000);
    expect(pause()).toBe(true);
    elapse(1000);
    const { outcome, changed } = heard([HALL]);
    expect(outcome.notice).toContain(
      '“Placeholder slide video” could not play on the screen “Placeholder Hall”.',
    );
    expect(outcome.live).toBe('cannot');
    expect(changed).toBe(true);
    // The slide and its paused video are as the operator left them.
    expect(engine.current.layers.slide?.seeks?.['onslide']?.paused).toBe(true);
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Hall”: “Placeholder slide video” could not play there.',
    ]);
    expect(
      notOnScreensNow(
        hallWords.list((id) => NAMES[id]),
        engine.current,
      ),
    ).toHaveLength(1);
    // Another showing of the same file is not this one.
    expect(stillUp(engine.current, 'onslide', at + 1)).toBe(false);
    // Still up: nothing to forget.
    expect(hallWords.prune(engine.current)).toBe(false);
    // Its slide goes: forgotten, and LIVE says nothing.
    engine.dispatch({ type: 'goLive', presentationId: 'other', slideIndex: 0 });
    expect(hallWords.prune(engine.current)).toBe(true);
    expect(lines()).toEqual([]);
  });

  it('MUST-3: the same screen’s later word on that showing (more than the 1 s wait after) is logged only: one notice, one line', () => {
    const { heard, lines, pause } = setup();
    expect(pause()).toBe(true);
    expect(heard([HALL], NO_FIRST_FRAME).outcome.notice).not.toBeNull();
    const again = heard([HALL], 3);
    expect(again.outcome.notice).toBeNull();
    expect(again.outcome.log?.line).toMatch(/; told already$/u);
    expect(again.changed).toBe(false);
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Hall”: “Placeholder slide video” could not play there.',
    ]);
  });

  it('MUST-3: a playing slide video paused by the take-off, then a second screen’s word later: told only of the new screen, and LIVE names both', () => {
    const { heard, lines, elapse } = setup();
    elapse(10_000);
    const first = heard([HALL], NO_FIRST_FRAME);
    expect(first.outcome.notice).toContain('so it stopped where it was on the slide');
    elapse(3000);
    const later = heard([SIDE], 3);
    expect(later.outcome.notice).toContain('could not play on the screen “Placeholder Side”.');
    expect(later.outcome.notice).not.toContain('Placeholder Hall');
    expect(later.changed).toBe(true);
    expect(lines()).toEqual([
      'Not on the screens “Placeholder Hall” and “Placeholder Side”: “Placeholder slide video” could not play there.',
    ]);
    // Both again: nothing new to tell.
    expect(heard([HALL, SIDE], 3).outcome.notice).toBeNull();
  });

  it('MUST-1 + MUST-2: a waiting video slow to start on a screen is said to be still loading there, and the line goes once that screen draws it after all', () => {
    const { heard, lines, hallWords, at, pause } = setup();
    expect(pause()).toBe(true);
    const slow = heard([HALL], NO_START_IN_TIME);
    expect(slow.outcome.notice).toContain('could not start in time on the screen “Placeholder Hall”');
    expect(slow.outcome.notice).not.toContain('could not play');
    expect(slow.outcome.live).toBe('slow');
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Hall” yet: “Placeholder slide video” is still loading there.',
    ]);
    // Another screen's word is not the hall's drawing.
    expect(hallWords.playsHere('onslide', at, 'screen-side')).toBe(false);
    expect(hallWords.playsHere('onslide', at + 1, 'screen-hall')).toBe(false);
    expect(hallWords.playsHere('onslide', at, 'screen-hall')).toBe(true);
    expect(lines()).toEqual([]);
    expect(hallWords.playsHere('onslide', at, 'screen-hall')).toBe(false);
  });

  it('MUST-2: a screen that could not play it, then one still loading it: each named as it is; a later failure on the slow one makes it "could not play"', () => {
    const { heard, lines, pause } = setup();
    expect(pause()).toBe(true);
    heard([HALL], 3);
    heard([SIDE], NO_START_IN_TIME);
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Hall”: “Placeholder slide video” could not play there.',
      'Not on the screen “Placeholder Side” yet: “Placeholder slide video” is still loading there.',
    ]);
    heard([SIDE], 3);
    expect(lines()).toEqual([
      'Not on the screens “Placeholder Hall” and “Placeholder Side”: “Placeholder slide video” could not play there.',
    ]);
  });

  it('MUST-5: a GPU process stopping changes no line: a damaged video failing again within the GPU’s grace is never heard, so its line stays until the element loaded again draws (plays-here)', () => {
    const { heard, lines, hallWords, at, pause } = setup();
    expect(pause()).toBe(true);
    heard([HALL], 3);
    expect(lines()).toHaveLength(1);
    // Main's GPU stop: CannotPlay leaves a word within its grace to the GPU (log only); nothing reaches HallWords.
    let now = 0;
    const waiting: (() => void)[] = [];
    const c = new CannotPlay({
      now: () => now,
      later: (_ms, run) => {
        waiting.push(run);
      },
    });
    c.gpuGone();
    const went: string[] = [];
    c.heard(
      `onslide@${String(at)}`,
      HALL,
      () => went.push('heard'),
      () => went.push('gpu'),
    );
    now = 1000;
    for (const run of waiting.splice(0)) run();
    expect(went).toEqual(['gpu']);
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Hall”: “Placeholder slide video” could not play there.',
    ]);
    // The element loaded again draws after all: the line goes.
    expect(hallWords.playsHere('onslide', at, 'screen-hall')).toBe(true);
    expect(lines()).toEqual([]);
  });

  it('MUST-4: a first frame said during the wait, before Main keeps the showing: no notice, no line, and the log says it drew there after all', () => {
    const { heard, lines, hallWords, at, pause } = setup();
    expect(pause()).toBe(true);
    // The slow verdict at 30.0 s, its first frame at 30.4 s, the end of Main's wait at 31.0 s.
    expect(hallWords.playsHere('onslide', at, 'screen-hall')).toBe(false);
    const { outcome, changed } = heard([HALL], NO_START_IN_TIME);
    expect(outcome.notice).toBeNull();
    expect(outcome.live).toBeNull();
    expect(outcome.log).toEqual({
      level: 'info',
      line: 'A video could not play on the screen “Placeholder Hall” (no picture within 30 s while it still loaded): onslide; drew there after all, so nothing to tell',
    });
    expect(changed).toBe(false);
    expect(lines()).toEqual([]);
  });

  it('MUST-4: drawn, then a new word from that screen: its mark goes, and it is told and named', () => {
    const { heard, lines, hallWords, at, pause } = setup();
    expect(pause()).toBe(true);
    hallWords.playsHere('onslide', at, 'screen-hall');
    hallWords.saidAgain('onslide', at, 'screen-hall');
    expect(heard([HALL], 3).outcome.notice).toContain('could not play on the screen “Placeholder Hall”.');
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Hall”: “Placeholder slide video” could not play there.',
    ]);
  });

  it('MUST-4: one screen drew during the wait, the other did not: only the other is told and named', () => {
    const { heard, lines, hallWords, at, pause } = setup();
    expect(pause()).toBe(true);
    hallWords.playsHere('onslide', at, 'screen-hall');
    const { outcome } = heard([HALL, SIDE], 3);
    expect(outcome.notice).toContain('could not play on the screen “Placeholder Side”.');
    expect(outcome.notice).not.toContain('Placeholder Hall');
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Side”: “Placeholder slide video” could not play there.',
    ]);
    // A mark is the showing's: another showing of the file is told as ever.
    expect(hallWords.playsHere('onslide', at + 1, 'screen-side')).toBe(false);
  });

  it('MUST-2: a screen whose page loads again, or that goes, is no longer named; a renamed one is named as it is now', () => {
    const { heard, lines, hallWords, pause } = setup();
    expect(pause()).toBe(true);
    heard([HALL, SIDE], 3);
    expect(
      hallWords
        .list((id) => (id === 'screen-side' ? 'Placeholder Lobby' : NAMES[id]))
        .flatMap((e) => e.lines),
    ).toEqual([
      'Not on the screens “Placeholder Hall” and “Placeholder Lobby”: “Placeholder slide video” could not play there.',
    ]);
    // A screen gone from the screens' list is not named.
    expect(
      hallWords.list((id) => (id === 'screen-side' ? undefined : NAMES[id])).flatMap((e) => e.lines),
    ).toEqual(['Not on the screen “Placeholder Hall”: “Placeholder slide video” could not play there.']);
    expect(hallWords.screenGone('screen-hall')).toBe(true);
    expect(hallWords.screenGone('screen-hall')).toBe(false);
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Side”: “Placeholder slide video” could not play there.',
    ]);
  });

  it('keeps one entry per showing, at most NOT_ON_SCREENS_MAX, and never a showing not up', () => {
    const hallWords = new HallWords();
    const h = (mediaId: string): Heard => ({
      name: mediaId,
      mediaId,
      wheres: [HALL],
      code: 3,
      words: '',
      took: null,
      stillUp: true,
    });
    for (let i = 0; i < NOT_ON_SCREENS_MAX + 5; i++) hallWords.heard(h(`m${String(i)}`), 1);
    const kept = hallWords.list((id) => NAMES[id]);
    expect(kept).toHaveLength(NOT_ON_SCREENS_MAX);
    expect(kept.at(-1)?.mediaId).toBe(`m${String(NOT_ON_SCREENS_MAX + 4)}`);
    const gone = hallWords.heard({ ...h('gone'), stillUp: false }, 1);
    expect(gone.changed).toBe(false);
    expect(hallWords.list((id) => NAMES[id]).some((e) => e.mediaId === 'gone')).toBe(false);
  });

  it('with no show at all, nothing is up', () => {
    expect(stillUp(null, 'onslide', 1)).toBe(false);
    expect(notOnScreensNow([{ mediaId: 'onslide', startedAt: 1, lines: ['x'] }], undefined)).toEqual([]);
  });
});
