import { describe, expect, it } from 'vitest';
import type { MediaElement } from '../../shared/model';
import { stillUp } from '../../shared/not-on-screens';
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
function setup() {
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
  for (const where of [HALL, SIDE])
    hallWords.heard(
      {
        name: 'Placeholder slide video',
        mediaId: 'onslide',
        wheres: [where],
        code: 3,
        words: '',
        took: engine.cannotPlay('onslide', at),
        stillUp: stillUp(engine.current, 'onslide', at),
      },
      at,
    );
  let sent = 0;
  const follow = new LiveLinesFollow(hallWords, () => {
    sent++;
  });
  return {
    engine,
    at,
    follow,
    lines: () => hallWords.list((id) => NAMES[id]).flatMap((e) => e.lines),
    sent: () => sent,
  };
}

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
