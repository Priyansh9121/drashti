import { describe, expect, it } from 'vitest';
import { parseEngineCommand } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, readsEngineVersion } from '../../shared/engine/state';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * A stream link as the background (alpha.20, the playback set's slice 8; the owner's Q60-39 P3 A), as the engine keeps
 * it: put up by the main process alone, a video's one-at-a-time rules (a cover takes it off; putting it up takes the
 * covers off), the Wallpaper of a link gone 20 seconds as the engine's own change, and never put back after a restart.
 */

function setup() {
  let clock = 1000;
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => ++clock);
  return { engine };
}

const LINK = { linkId: '00000000-0000-4000-8000-000000000001', name: 'media.example.org' };

describe('a stream link as the background (alpha.20)', () => {
  it('is engine 32, which retains the stream link and every preceding saved state whole', () => {
    expect(ENGINE_STATE_VERSION).toBe(32);
    for (const v of [31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 20, 18, 17, 16, 15, 14, 13, 12])
      expect(readsEngineVersion(v), String(v)).toBe(true);
  });

  it('goes up as the background, live from then; a slide goes over it, and a picture takes its place', () => {
    const { engine } = setup();
    expect(engine.showLink(LINK)).toMatchObject({ ok: true, changed: true });
    const up = engine.current.layers.background;
    expect(up).toMatchObject({ kind: 'link', ...LINK });
    expect(up?.kind === 'link' ? up.startedAt : 0).toBeGreaterThan(1000);
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    expect(engine.current.layers.background).toBe(up);
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'clouds', media: 'image', fit: 'fit', loop: false },
    });
    expect(engine.current.layers.background?.kind).toBe('media');
  });

  it('takes black-out and the Wallpaper off as it goes up, as a video does', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'setWallpaper', on: true });
    engine.showLink(LINK);
    expect(engine.current.wallpaper).toBe(false);
    engine.dispatch({ type: 'setBlackout', on: true });
    expect(engine.current.layers.background).toBeNull();
    engine.showLink(LINK);
    expect(engine.current.blackout).toBe(false);
    expect(engine.current.layers.background?.kind).toBe('link');
  });

  it('comes off under a cover going on, never played on underneath (its sound heard in the hall)', () => {
    const { engine } = setup();
    engine.showLink(LINK);
    engine.dispatch({ type: 'setWallpaper', on: true });
    expect(engine.current.layers.background).toBeNull();
    engine.dispatch({ type: 'setWallpaper', on: false });
    engine.showLink(LINK);
    engine.dispatch({ type: 'setBlackout', on: true });
    expect(engine.current.layers.background).toBeNull();
  });

  it('gone 20 seconds: the Wallpaper goes up by the engine itself, the link off under it; another link is left as it is', () => {
    const { engine } = setup();
    engine.showLink(LINK);
    expect(engine.linkDropped('00000000-0000-4000-8000-000000000009')).toMatchObject({ changed: false });
    expect(engine.current.wallpaper).toBe(false);
    expect(engine.linkDropped(LINK.linkId)).toMatchObject({ ok: true, changed: true });
    expect(engine.current.wallpaper).toBe(true);
    expect(engine.current.layers.background).toBeNull();
  });

  it('is taken off by the main process (the operator’s Stop), and only the link named', () => {
    const { engine } = setup();
    engine.showLink(LINK);
    expect(engine.clearLink('00000000-0000-4000-8000-000000000009')).toMatchObject({ changed: false });
    expect(engine.current.layers.background?.kind).toBe('link');
    engine.clearLink(LINK.linkId);
    expect(engine.current.layers.background).toBeNull();
  });

  it('comes off with Clear all and its own clear, and Put it back brings it back as it was', () => {
    const { engine } = setup();
    engine.showLink(LINK);
    const up = engine.current.layers.background;
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.layers.background).toBeNull();
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.background).toEqual(up);
    engine.dispatch({ type: 'clearLayer', layer: 'background' });
    expect(engine.current.layers.background).toBeNull();
  });

  it('cannot be named by a command: no window, phone or API puts a link up', () => {
    const background = { kind: 'link', ...LINK, startedAt: 1 };
    expect(parseEngineCommand({ type: 'setBackground', background }).ok).toBe(false);
  });

  it('is never put back after a restart (its local stream went with the stop), and says which it was', () => {
    const { engine } = setup();
    const put = engine.restore({
      slide: { presentationId: 'p1', slideIndex: 0 },
      background: { kind: 'link', ...LINK, startedAt: 42 },
      blackout: false,
    });
    expect(engine.current.layers.background).toBeNull();
    expect(engine.current.layers.slide).not.toBeNull();
    expect(put).toMatchObject({ slide: true, background: false, link: 'media.example.org' });
  });
});
