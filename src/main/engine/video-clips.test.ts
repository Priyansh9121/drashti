import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { EngineMirror } from '../../shared/engine/mirror';
import type { EnginePatchMessage } from '../../shared/engine/protocol';
import type { PropItem } from '../../shared/engine/state';
import type { SlideCue } from '../../shared/library';
import type { MediaMarkers } from '../../shared/markers';
import type { MediaElement, RenderSlide } from '../../shared/model';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * A video on a slide, and a prop's and the logo's videos, play between their files' start and end points
 * (Session 52), as a background video does: the engine stamps the points on the slide layer and on the prop
 * (`clips`, by media id) from the library as they go up, so every screen, node, key and fill and the stream play
 * the same part of each file; and they follow the library when its points change. Before, they played the whole
 * file. Placeholder media ids only.
 */

/** The library's points (Session 14), by placeholder file. */
const MARKERS: Record<string, MediaMarkers> = {
  clipped: { startMs: 2000, endMs: 6000, markers: [{ id: 'm1', name: 'Placeholder chorus', atMs: 4000 }] },
  // An end point only: from the top to 0:05.
  ending: { startMs: null, endMs: 5000, markers: [] },
  // Markers only, no points: the whole file.
  marked: { startMs: null, endMs: null, markers: [{ id: 'm2', name: 'Placeholder verse', atMs: 1000 }] },
  // A picture never has points; were the library to say so, a picture still plays nothing.
  still: { startMs: 1000, endMs: 2000, markers: [] },
};

const video = (id: string, mediaId: string, loop = true): MediaElement => ({
  id,
  kind: 'video',
  mediaId,
  frame: { x: 0, y: 0, width: 640, height: 360 },
  fit: 'fit',
  loop,
});

/** A slide with these pictures and videos under its words. */
function slideWith(id: string, ...media: MediaElement[]): RenderSlide {
  const words = textSlide(id, 'Placeholder words');
  return { ...words, elements: [...media, ...words.elements] };
}

const prop = (id: string, mediaId: string, loop = true): PropItem => ({
  id,
  name: `Placeholder ${id}`,
  elements: [video(`${id}-video`, mediaId, loop)],
});

/** The third slide's background cue: a picture, so Back's exact undo (it goes) differs from Previous (it stays). */
const BACKDROP: SlideCue = {
  kind: 'background',
  label: '',
  name: 'Placeholder backdrop.png',
  missing: false,
  unplayable: null,
  background: { kind: 'media', mediaId: 'backdrop', media: 'image', fit: 'fill', loop: false },
};

const goLive = (slideIndex: number): EngineCommand => ({
  type: 'goLive',
  presentationId: 'videos',
  slideIndex,
});

function setup() {
  const markers: Record<string, MediaMarkers> = { ...MARKERS };
  const source = makeSource();
  source.set(
    'videos',
    [
      slideWith(
        'v1',
        video('v1-a', 'clipped'),
        { ...video('v1-b', 'still'), kind: 'image' },
        video('v1-c', 'plain'),
        video('v1-d', 'marked'),
        video('v1-e', 'ending', false),
      ),
      textSlide('v2', 'Placeholder words alone'),
      slideWith('v3', video('v3-a', 'clipped')),
    ],
    [[], [], [BACKDROP]],
  );
  let clock = 1_000_000;
  const transport = new RecordingTransport();
  const engine = new ShowEngine(source, transport, () => ++clock, undefined, {
    mediaMarkers: (id) => markers[id] ?? null,
  });
  return { engine, markers, transport };
}

describe('a slide’s, a prop’s and the logo’s videos between their start and end points (Session 52)', () => {
  it('a slide going up carries its videos’ points, by file: none for a file without, a picture, or a slide of words', () => {
    const { engine } = setup();
    engine.dispatch(goLive(0));
    expect(engine.current.layers.slide?.clips).toEqual({
      clipped: { startMs: 2000, endMs: 6000 },
      ending: { startMs: 0, endMs: 5000 },
    });
    // The same slide again is no change.
    expect(engine.dispatch(goLive(0))).toMatchObject({ ok: true, changed: false });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide?.slideIndex).toBe(1);
    expect(engine.current.layers.slide).not.toHaveProperty('clips');
  });

  it('a prop and the logo carry their videos’ points as they go up: the library’s, never a page’s', () => {
    const { engine } = setup();
    const forged = { clipped: { startMs: 0, endMs: 1 }, ending: { startMs: 0, endMs: 1 } };
    engine.dispatch({ type: 'showProp', prop: { ...prop('prop', 'clipped'), clips: forged } });
    engine.dispatch({ type: 'showLogo', prop: { ...prop('logo', 'ending', false), clips: forged } });
    expect(engine.current.layers.props[0]?.clips).toEqual({ clipped: { startMs: 2000, endMs: 6000 } });
    expect(engine.current.logo?.clips).toEqual({ ending: { startMs: 0, endMs: 5000 } });
    // Its videos' files without points: none, whatever a page said.
    engine.dispatch({ type: 'showProp', prop: { ...prop('plain', 'plain'), clips: forged } });
    expect(engine.current.layers.props[1]?.id).toBe('plain');
    expect(engine.current.layers.props[1]).not.toHaveProperty('clips');
  });

  it('follow the library as its points change, carrying on: the slide up, a prop and the logo; not a change to the show', () => {
    const { engine, markers } = setup();
    engine.dispatch({ type: 'showProp', prop: prop('prop', 'clipped') });
    engine.dispatch({ type: 'showLogo', prop: prop('logo', 'clipped') });
    engine.dispatch(goLive(1));
    engine.dispatch({ type: 'next' });
    const slide = engine.current.layers.slide;
    const propShownAt = engine.current.layers.props[0]?.shownAt;
    const logoShownAt = engine.current.logo?.shownAt;
    markers['clipped'] = { startMs: 3000, endMs: null, markers: [] };
    expect(engine.refreshMarkers('clipped')).toMatchObject({ ok: true, changed: true });
    const points = { clipped: { startMs: 3000, endMs: null } };
    expect(engine.current.layers.slide).toEqual({ ...slide, clips: points });
    expect(engine.current.layers.props[0]).toMatchObject({ shownAt: propShownAt, clips: points });
    expect(engine.current.logo).toMatchObject({ shownAt: logoShownAt, clips: points });
    // Its points taken away: the whole file again.
    delete markers['clipped'];
    engine.refreshMarkers('clipped');
    expect(engine.current.layers.slide).not.toHaveProperty('clips');
    expect(engine.current.layers.props[0]).not.toHaveProperty('clips');
    expect(engine.current.logo).not.toHaveProperty('clips');
    expect(engine.current.layers.slide?.shownAt).toBe(slide?.shownAt);
    // Another file's points change nothing.
    expect(engine.refreshMarkers('ending')).toMatchObject({ changed: false });
    // Not a change to the show: Back still undoes the Next exactly (the backdrop its cue put up goes too).
    expect(engine.current.layers.background).toMatchObject({ mediaId: 'backdrop' });
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide?.slideIndex).toBe(1);
    expect(engine.current.layers.background).toBeNull();
  });

  it('reach every screen and node: a copy kept from the engine’s snapshot and patches has them, as they change', () => {
    const { engine, markers, transport } = setup();
    const mirror = new EngineMirror();
    expect(mirror.apply(engine.snapshot())).toBe('applied');
    let seen = 0;
    const follow = () => {
      for (; seen < transport.messages.length; seen++) {
        const wire = JSON.parse(JSON.stringify(transport.messages[seen])) as EnginePatchMessage;
        expect(mirror.apply(wire)).toBe('applied');
      }
      expect(mirror.state).toEqual(engine.current);
    };
    engine.dispatch(goLive(0));
    engine.dispatch({ type: 'showProp', prop: prop('prop', 'clipped') });
    follow();
    expect(mirror.state?.layers.slide?.clips?.['clipped']).toEqual({ startMs: 2000, endMs: 6000 });
    expect(mirror.state?.layers.props[0]?.clips).toEqual({ clipped: { startMs: 2000, endMs: 6000 } });
    markers['clipped'] = { startMs: 2500, endMs: 5500, markers: [] };
    engine.refreshMarkers('clipped');
    follow();
    expect(mirror.state?.layers.props[0]?.clips).toEqual({ clipped: { startMs: 2500, endMs: 5500 } });
    delete markers['clipped'];
    engine.refreshMarkers('clipped');
    follow();
    expect(mirror.state?.layers.props[0]).not.toHaveProperty('clips');
  });

  it('a slide edited while it is up takes its videos’ points afresh', () => {
    const { engine, markers } = setup();
    engine.dispatch(goLive(2));
    markers['clipped'] = { startMs: 1500, endMs: 4500, markers: [] };
    engine.refreshLive('videos');
    expect(engine.current.layers.slide?.clips).toEqual({ clipped: { startMs: 1500, endMs: 4500 } });
  });

  it('Back and Put it back bring the slide’s and the props’ videos back between the points the library has now', () => {
    const { engine, markers } = setup();
    engine.dispatch({ type: 'showProp', prop: prop('prop', 'clipped') });
    engine.dispatch(goLive(0));
    engine.dispatch({ type: 'clearAll' });
    // Set while nothing played the file: Put it back brings them back between the new points.
    markers['clipped'] = { startMs: 3000, endMs: 7000, markers: [] };
    engine.refreshMarkers('clipped');
    expect(engine.dispatch({ type: 'putBack' })).toMatchObject({ ok: true, changed: true });
    const points = { startMs: 3000, endMs: 7000 };
    expect(engine.current.layers.slide?.clips).toEqual({
      clipped: points,
      ending: { startMs: 0, endMs: 5000 },
    });
    expect(engine.current.layers.props[0]?.clips).toEqual({ clipped: points });
    // Moved on, the points change, then Back: the slide comes back between the new ones.
    engine.dispatch({ type: 'next' });
    markers['clipped'] = { startMs: 1000, endMs: 4000, markers: [] };
    engine.refreshMarkers('clipped');
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(engine.current.layers.slide?.clips?.['clipped']).toEqual({ startMs: 1000, endMs: 4000 });
    expect(engine.current.layers.props[0]?.clips).toEqual({ clipped: { startMs: 1000, endMs: 4000 } });
  });

  it('put back after an unexpected stop, they take the library’s points as they are now: recovery keeps none', () => {
    const { engine } = setup();
    const put = engine.restore({
      slide: { presentationId: 'videos', slideIndex: 0, shownAt: 900_000 },
      background: null,
      blackout: false,
      props: [{ ...prop('prop', 'clipped'), shownAt: 950_000, clips: { clipped: { startMs: 0, endMs: 1 } } }],
      logo: { ...prop('logo', 'ending', false), shownAt: 960_000 },
    });
    expect(put).toMatchObject({ slide: true, props: 1, logo: true });
    expect(engine.current.layers.slide).toMatchObject({
      shownAt: 900_000,
      clips: { clipped: { startMs: 2000, endMs: 6000 }, ending: { startMs: 0, endMs: 5000 } },
    });
    expect(engine.current.layers.props[0]).toMatchObject({
      shownAt: 950_000,
      clips: { clipped: { startMs: 2000, endMs: 6000 } },
    });
    expect(engine.current.logo).toMatchObject({
      shownAt: 960_000,
      clips: { ending: { startMs: 0, endMs: 5000 } },
    });
  });
});
