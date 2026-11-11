import { describe, expect, it } from 'vitest';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * The Wallpaper (Session 55, Part 13), in the Logo's place: it puts the chosen wallpaper up on the audience screens
 * instead of the picture (render/NothingUp.tsx draws it: black until Part 6 brings wallpapers) and takes it off
 * again. Like the Logo it covers the layers without clearing them, so taking it off brings back exactly what was
 * there; Clear all leaves it as it is, and black-out covers it in turn.
 */

function setup() {
  let clock = 1000;
  return new ShowEngine(makeSource(), new RecordingTransport(), () => ++clock);
}

describe('the Wallpaper (Session 55, Part 13)', () => {
  it('goes up over what is up, which carries on underneath, and comes off again', () => {
    const engine = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 1 });
    const layers = engine.current.layers;
    expect(engine.current.wallpaper).toBe(false);
    expect(engine.dispatch({ type: 'toggleWallpaper' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.wallpaper).toBe(true);
    expect(engine.current.layers).toEqual(layers);
    expect(engine.dispatch({ type: 'toggleWallpaper' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.wallpaper).toBe(false);
    expect(engine.current.layers).toEqual(layers);
  });

  it('is set on and off as asked (a phone, the API); Clear all leaves it up; black-out is a cover of its own', () => {
    const engine = setup();
    expect(engine.dispatch({ type: 'setWallpaper', on: true })).toMatchObject({ ok: true, changed: true });
    expect(engine.dispatch({ type: 'setWallpaper', on: true })).toMatchObject({ ok: true, changed: false });
    // A slide put up takes it off (Session 56: LIVE shows one thing at a time, one-at-a-time.test.ts); on again over it.
    engine.dispatch({ type: 'goLive', presentationId: 'p2', slideIndex: 0 });
    expect(engine.current.wallpaper).toBe(false);
    engine.dispatch({ type: 'setWallpaper', on: true });
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.wallpaper).toBe(true);
    engine.dispatch({ type: 'setBlackout', on: true });
    expect([engine.current.blackout, engine.current.wallpaper]).toEqual([true, true]);
    engine.dispatch({ type: 'setBlackout', on: false });
    expect(engine.dispatch({ type: 'setWallpaper', on: false })).toMatchObject({ ok: true, changed: true });
    expect([engine.current.blackout, engine.current.wallpaper]).toEqual([false, false]);
  });

  it('is never in the state of an older engine: no logo, no idle rotation, no props or masks layer', () => {
    const state = setup().current as unknown as Record<string, unknown>;
    expect(['logo' in state, 'idle' in state]).toEqual([false, false]);
    const layers = state['layers'] as Record<string, unknown>;
    expect(['props' in layers, 'masks' in layers]).toEqual([false, false]);
  });
});
