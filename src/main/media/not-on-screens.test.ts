import { describe, expect, it } from 'vitest';
import type { MediaElement } from '../../shared/model';
import { NOT_ON_SCREENS_MAX, notOnScreenLine, notOnScreensNow, stillUp } from '../../shared/not-on-screens';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport, textSlide } from '../engine/testing';
import { heardOutcome, NotOnScreensList } from './cannot-play';

/*
 * A slide's video up but not playing (paused, or waiting for its click) that the hall could not play (alpha.23,
 * a22-halldrop), through the real engine: Main's take-off finds nothing to take off, but the showing is still up, so
 * the operator is told, and LIVE names the screen until it goes off. Placeholder ids only.
 */

const VIDEO: MediaElement = {
  id: 'onslide-el',
  kind: 'video',
  mediaId: 'onslide',
  frame: { x: 0, y: 0, width: 640, height: 360 },
  fit: 'fit',
  loop: false,
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
  return {
    engine,
    elapse: (ms: number) => {
      clock += ms;
    },
  };
}

describe('a slide’s video up but not playing that the hall could not play (alpha.23, a22-halldrop)', () => {
  it('takes nothing off, but is still up: told and named under LIVE until its slide goes', () => {
    const { engine, elapse } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'onslide', slideIndex: 0 });
    elapse(2000);
    expect(
      engine.dispatch({ type: 'pausePlaying', playing: { layer: 'slide', mediaId: 'onslide' } }).ok,
    ).toBe(true);
    const at = engine.current.layers.slide?.shownAt ?? 0;
    elapse(1000);
    // The hall's word, after the wait: nothing playing to take off.
    const took = engine.cannotPlay('onslide', at);
    expect(took).toBeNull();
    expect(stillUp(engine.current, 'onslide', at)).toBe(true);
    // Another showing of the same file is not this one.
    expect(stillUp(engine.current, 'onslide', at + 1)).toBe(false);
    const said = heardOutcome({
      name: 'Placeholder slide video',
      mediaId: 'onslide',
      wheres: [{ screen: 'Placeholder Hall' }],
      code: 3,
      words: '',
      took,
      stillUp: true,
    });
    expect(said.notice).toContain(
      '“Placeholder slide video” could not play on the screen “Placeholder Hall”.',
    );
    expect(said.notOn).toBe('the screen “Placeholder Hall”');
    // The slide and its paused video are as the operator left them.
    expect(engine.current.layers.slide?.seeks?.['onslide']?.paused).toBe(true);
    const list = new NotOnScreensList();
    const entry = {
      mediaId: 'onslide',
      startedAt: at,
      name: 'Placeholder slide video',
      where: said.notOn ?? '',
    };
    list.add(entry, engine.current);
    expect(list.list).toEqual([entry]);
    expect(notOnScreensNow(list.list, engine.current).map(notOnScreenLine)).toEqual([
      'Not on the screen “Placeholder Hall”: “Placeholder slide video” could not play there.',
    ]);
    // Still up: nothing to forget.
    expect(list.prune(engine.current)).toBe(false);
    // Its slide goes: forgotten, and LIVE says nothing.
    engine.dispatch({ type: 'goLive', presentationId: 'other', slideIndex: 0 });
    expect(notOnScreensNow([entry], engine.current)).toEqual([]);
    expect(list.prune(engine.current)).toBe(true);
    expect(list.list).toEqual([]);
  });

  it('keeps one line per showing, the newest word’s, however often it is said, and never a showing not up', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'onslide', slideIndex: 0 });
    const at = engine.current.layers.slide?.shownAt ?? 0;
    const list = new NotOnScreensList();
    const entry = {
      mediaId: 'onslide',
      startedAt: at,
      name: 'Placeholder slide video',
      where: 'the screen “A”',
    };
    list.add(entry, engine.current);
    list.add({ ...entry, where: 'the screens “A” and “B”' }, engine.current);
    expect(list.list).toEqual([{ ...entry, where: 'the screens “A” and “B”' }]);
    list.add({ ...entry, startedAt: at - 1 }, engine.current);
    expect(list.list).toHaveLength(1);
    for (let i = 0; i < NOT_ON_SCREENS_MAX + 5; i++)
      list.add({ ...entry, where: `the screen “${String(i)}”` }, engine.current);
    expect(list.list).toEqual([{ ...entry, where: `the screen “${String(NOT_ON_SCREENS_MAX + 4)}”` }]);
  });

  it('with no show at all, nothing is up', () => {
    expect(stillUp(null, 'onslide', 1)).toBe(false);
    expect(notOnScreensNow([{ mediaId: 'onslide', startedAt: 1, name: 'x', where: 'y' }], undefined)).toEqual(
      [],
    );
  });
});
