import { describe, expect, it } from 'vitest';
import type { MediaElement } from '../../shared/model';
import { cannotPlayNotice, NO_START_IN_TIME } from '../../shared/no-picture';
import { stillUp } from '../../shared/not-on-screens';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport, textSlide } from '../engine/testing';
import { type CannotPlayWhere, HallWords } from './cannot-play';
import { LiveLinesFollow } from './not-on-screens-follow';

/*
 * What Main does with LIVE's "Not on the screen" lines as things happen around them (alpha.23, a22-halldrop; the
 * re-review's MUST-5): through the real engine, a slide's video paused and a screen's word that it could not play.
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

/** A slide's video paused, the hall's and the side screen's words that they could not play it, after the wait. */
function setup(words0: CannotPlayWhere[] = [HALL, SIDE]) {
  const source = makeSource();
  const words = textSlide('o1', 'Placeholder words');
  source.set('onslide', [{ ...words, elements: [VIDEO, ...words.elements] }]);
  source.set('other', [textSlide('w1', 'Placeholder other words')]);
  const engine = new ShowEngine(source, new RecordingTransport(), () => 1_000_000, undefined, {
    mediaLength: () => 40_000,
    mediaKind: () => 'video',
  });
  engine.dispatch({ type: 'goLive', presentationId: 'onslide', slideIndex: 0 });
  engine.dispatch({ type: 'pausePlaying', playing: { layer: 'slide', mediaId: 'onslide' } });
  const at = engine.current.layers.slide?.shownAt ?? 0;
  const hallWords = new HallWords();
  /** A word from `wheres` after the wait, the take-off run first, as Main's handler has it. */
  const heard = (wheres: CannotPlayWhere[], code = 3) =>
    hallWords.heard(
      {
        name: 'Placeholder slide video',
        mediaId: 'onslide',
        wheres,
        code,
        words: '',
        took: engine.cannotPlay('onslide', at),
        stillUp: stillUp(engine.current, 'onslide', at),
      },
      at,
    );
  for (const where of words0) heard([where]);
  let sent = 0;
  const follow = new LiveLinesFollow(hallWords, () => {
    sent++;
  });
  return {
    engine,
    at,
    follow,
    heard,
    lines: () => hallWords.list((id) => NAMES[id]).flatMap((e) => e.lines),
    starting: () => hallWords.list((id) => NAMES[id]).flatMap((e) => (e.starting ? [e.starting] : [])),
    sent: () => sent,
  };
}

/** The same with no screen's word yet. */
const fresh = () => setup([]);

const BOTH =
  'Not on the screens “Placeholder Hall” and “Placeholder Side”: “Placeholder slide video” could not play there.';

describe('what Main does with LIVE’s lines as things happen around them (alpha.23, a22-halldrop)', () => {
  it('MUST-5: a GPU process stopping changes no line and tells the window nothing (a damaged video failing again within the GPU’s grace is never heard, so its line must stay)', () => {
    const { follow, lines, sent } = setup();
    expect(lines()).toEqual([BOTH]);
    follow.gpuStopped();
    expect(lines()).toEqual([BOTH]);
    expect(sent()).toBe(0);
  });

  it('a screen’s page loading again, or its window closing, is no longer named, and the window is told; another screen’s is', () => {
    const { follow, lines, sent } = setup();
    follow.pageLoading('screen-hall');
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Side”: “Placeholder slide video” could not play there.',
    ]);
    expect(sent()).toBe(1);
    follow.pageLoading('screen-hall');
    follow.pageLoading('screen-other');
    expect(sent()).toBe(1);
    follow.windowClosed('screen-side');
    expect(lines()).toEqual([]);
    expect(sent()).toBe(2);
    follow.windowClosed('screen-side');
    expect(sent()).toBe(2);
  });

  it('the screens changing tells the window again while any is named, and not once none is', () => {
    const { follow, sent } = setup();
    follow.screensChanged();
    expect(sent()).toBe(1);
    follow.pageLoading('screen-hall');
    follow.pageLoading('screen-side');
    expect(sent()).toBe(3);
    follow.screensChanged();
    expect(sent()).toBe(3);
  });

  it('a screen drawing it after all is no longer named (once); the show moving on forgets the showing', () => {
    const { engine, at, follow, lines, sent } = setup();
    expect(follow.drew('onslide', at, 'screen-side')).toBe(true);
    expect(follow.drew('onslide', at, 'screen-side')).toBe(false);
    expect(lines()).toEqual([
      'Not on the screen “Placeholder Hall”: “Placeholder slide video” could not play there.',
    ]);
    expect(sent()).toBe(1);
    follow.showChanged(engine.current);
    expect(sent()).toBe(1);
    engine.dispatch({ type: 'goLive', presentationId: 'other', slideIndex: 0 });
    follow.showChanged(engine.current);
    expect(lines()).toEqual([]);
    expect(sent()).toBe(2);
  });
});

/** The follow with the take-off at Play connected, as Main has it, its later runs by hand. */
function withPlay(s: ReturnType<typeof setup>) {
  const later: (() => void)[] = [];
  const told: string[] = [];
  const logged: string[] = [];
  s.follow.connectPlay({
    later: (run) => {
      later.push(run);
    },
    state: () => s.engine.current,
    takeOff: (mediaId, startedAt) => s.engine.cannotPlay(mediaId, startedAt),
    tell: (text) => {
      told.push(text);
    },
    log: (line) => {
      logged.push(line);
    },
    nameOf: (id) => NAMES[id],
  });
  /** A change of the show as Main hears it, and the take-off a moment later. */
  const changed = () => {
    s.follow.showChanged(s.engine.current);
    for (const run of later.splice(0)) run();
  };
  return { told, logged, changed };
}

describe('Play on a video the hall said it cannot play (the owner’s QA23-HALLDROP-1 (b): “Take it off at Play (Rec.)”)', () => {
  it('a slide’s video: Play is followed by the take-off, paused there again with its sound, with the notice and the log; LIVE keeps naming the screens', () => {
    const s = setup();
    const p = withPlay(s);
    expect(
      s.engine.dispatch({ type: 'resumePlaying', playing: { layer: 'slide', mediaId: 'onslide' } }).ok,
    ).toBe(true);
    expect(s.engine.current.layers.slide?.seeks?.['onslide']?.paused).not.toBe(true);
    p.changed();
    expect(s.engine.current.layers.slide?.seeks?.['onslide']?.paused).toBe(true);
    expect(s.engine.current.layers.slide?.slide.id).toBe('o1');
    expect(p.told).toEqual([
      cannotPlayNotice('Placeholder slide video', 'the screens “Placeholder Hall” and “Placeholder Side”', {
        background: false,
        slide: true,
        box: false,
      }),
    ]);
    expect(p.logged).toEqual([
      'A video was played that the screens “Placeholder Hall” and “Placeholder Side” could not play: onslide; taken off at Play (paused on the slide)',
    ]);
    expect(s.lines()).toEqual([BOTH]);
    // Paused again: nothing more to take off, nothing more said.
    p.changed();
    expect(p.told).toHaveLength(1);
  });

  it('the box’s video: Play is followed by the take-off, the box off, with the notice', () => {
    const source = makeSource();
    source.set('w', [textSlide('w1', 'Placeholder words')]);
    const engine = new ShowEngine(source, new RecordingTransport(), () => 1_000_000, undefined, {
      mediaLength: () => 40_000,
      mediaKind: () => 'video',
    });
    engine.dispatch({
      type: 'showPip',
      source: { kind: 'media', mediaId: 'boxed' },
      place: DEFAULT_PIP_PLACE,
    });
    expect(engine.dispatch({ type: 'pausePlaying', playing: { layer: 'pip' } }).ok).toBe(true);
    const at = engine.current.layers.pip?.shownAt ?? 0;
    const hallWords = new HallWords();
    hallWords.heard(
      {
        name: 'Placeholder box video',
        mediaId: 'boxed',
        wheres: [HALL],
        code: 3,
        words: '',
        took: engine.cannotPlay('boxed', at),
        stillUp: stillUp(engine.current, 'boxed', at),
      },
      at,
    );
    const follow = new LiveLinesFollow(hallWords, () => undefined);
    const told: string[] = [];
    const later: (() => void)[] = [];
    follow.connectPlay({
      later: (run) => {
        later.push(run);
      },
      state: () => engine.current,
      takeOff: (mediaId, startedAt) => engine.cannotPlay(mediaId, startedAt),
      tell: (text) => {
        told.push(text);
      },
      log: () => undefined,
      nameOf: (id) => NAMES[id],
    });
    expect(engine.dispatch({ type: 'resumePlaying', playing: { layer: 'pip' } }).ok).toBe(true);
    follow.showChanged(engine.current);
    for (const run of later.splice(0)) run();
    expect(engine.current.layers.pip).toBeNull();
    expect(told).toEqual([
      cannotPlayNotice('Placeholder box video', 'the screen “Placeholder Hall”', {
        background: false,
        slide: false,
        box: true,
      }),
    ]);
  });

  it('a screen only slow to start (“yet”), or every screen that said so drew after all: Play plays as asked', () => {
    const slow = fresh();
    const ps = withPlay(slow);
    slow.heard([HALL], NO_START_IN_TIME);
    expect(slow.lines()).toHaveLength(1);
    slow.engine.dispatch({ type: 'resumePlaying', playing: { layer: 'slide', mediaId: 'onslide' } });
    ps.changed();
    expect(slow.engine.current.layers.slide?.seeks?.['onslide']?.paused).not.toBe(true);
    expect(ps.told).toEqual([]);
    const drew = setup();
    const pd = withPlay(drew);
    drew.follow.drew('onslide', drew.at, 'screen-hall');
    drew.follow.drew('onslide', drew.at, 'screen-side');
    drew.engine.dispatch({ type: 'resumePlaying', playing: { layer: 'slide', mediaId: 'onslide' } });
    pd.changed();
    expect(drew.engine.current.layers.slide?.seeks?.['onslide']?.paused).not.toBe(true);
    expect(pd.told).toEqual([]);
  });
});

describe('words on LIVE while a screen waits for a video’s first frame (the owner’s QA23-HALLDROP-1 (a): “Words during the wait (Rec.)”)', () => {
  it('a screen with no first frame 2 s after it went up: LIVE says “Starting on the screen …” until it draws, and the window is told each time', () => {
    const s = fresh();
    expect(
      s.follow.starting('onslide', s.at, 'screen-hall', 'Placeholder Hall', 'Placeholder slide video'),
    ).toBe(true);
    expect(
      s.follow.starting('onslide', s.at, 'screen-hall', 'Placeholder Hall', 'Placeholder slide video'),
    ).toBe(false);
    expect(s.starting()).toEqual(['Starting on the screen “Placeholder Hall”…']);
    expect(s.lines()).toEqual([]);
    expect(s.sent()).toBe(1);
    expect(s.follow.drew('onslide', s.at, 'screen-hall')).toBe(true);
    expect(s.starting()).toEqual([]);
    expect(s.sent()).toBe(2);
  });

  it('the verdict takes its place: still loading (“yet”), or could not play; a screen named so already never says it is starting', () => {
    const s = fresh();
    s.follow.starting('onslide', s.at, 'screen-hall', 'Placeholder Hall', 'Placeholder slide video');
    s.follow.starting('onslide', s.at, 'screen-side', 'Placeholder Side', 'Placeholder slide video');
    expect(s.starting()).toEqual(['Starting on the screens “Placeholder Hall” and “Placeholder Side”…']);
    s.heard([HALL], NO_START_IN_TIME);
    expect(s.starting()).toEqual(['Starting on the screen “Placeholder Side”…']);
    expect(s.lines()).toEqual([
      'Not on the screen “Placeholder Hall” yet: “Placeholder slide video” is still loading there.',
    ]);
    s.heard([SIDE], 3);
    expect(s.starting()).toEqual([]);
    expect(
      s.follow.starting('onslide', s.at, 'screen-side', 'Placeholder Side', 'Placeholder slide video'),
    ).toBe(false);
  });

  it('the showing gone: forgotten', () => {
    const s = fresh();
    s.follow.starting('onslide', s.at, 'screen-hall', 'Placeholder Hall', 'Placeholder slide video');
    s.engine.dispatch({ type: 'goLive', presentationId: 'other', slideIndex: 0 });
    s.follow.showChanged(s.engine.current);
    expect(s.starting()).toEqual([]);
  });
});
