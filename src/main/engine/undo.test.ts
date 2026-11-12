import { describe, expect, it } from 'vitest';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * Simple Mode's safety nets in the engine: Put it back after Clear all, Back
 * that undoes the last Next exactly, and the Wallpaper instead of the picture
 * (Session 55, in the Logo's place).
 */

/** A kirtan, then a picture, then a sound, in a playlist. */
function sabha() {
  const source = makeSource();
  source.set('kirtan', [textSlide('k1', 'Chorus'), textSlide('k2', 'Verse')]);
  const playlists = new MemoryPlaylistSource();
  playlists.set('ravi', [
    { id: 'i-kirtan', kind: 'presentation', presentationId: 'kirtan', arrangementId: undefined },
    { id: 'i-pic', kind: 'media', mediaId: 'pic', media: 'image', label: 'Backdrop.png' },
    { id: 'i-p1', kind: 'presentation', presentationId: 'p1', arrangementId: undefined },
  ]);
  let clock = 1000;
  const engine = new ShowEngine(source, new RecordingTransport(), () => (clock += 10), playlists);
  return { engine };
}

const words = (engine: ShowEngine) => {
  const el = engine.current.layers.slide?.slide.elements[0];
  return el?.kind === 'text' ? el.text : null;
};

describe('Put it back after Clear all', () => {
  it('puts back exactly what Clear all took down, with videos and sound carrying on', () => {
    const { engine } = sabha();
    engine.dispatch({ type: 'playItem', playlistId: 'ravi', itemId: 'i-kirtan' });
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'vid', media: 'video', fit: 'fill', loop: true },
    });
    engine.dispatch({
      type: 'playAudio',
      audio: { id: 'a', title: 'Dhun', mediaId: 'a', volume: 1, loop: true },
    });
    engine.dispatch({ type: 'showMessage', message: { id: 'm', text: 'Car 12 please move' } });
    const before = engine.current.layers;
    expect(engine.current.canPutBack).toBe(false);

    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.layers.slide).toBeNull();
    expect(engine.current.canPutBack).toBe(true);
    // Black-out and the timers do not stop it being put back.
    engine.dispatch({ type: 'toggleBlackout' });
    engine.dispatch({ type: 'toggleBlackout' });

    expect(engine.dispatch({ type: 'putBack' })).toMatchObject({ ok: true, changed: true });
    // The very same layers: the background video and the sound keep their start, so they carry on.
    expect(engine.current.layers).toEqual(before);
    expect(engine.current.canPutBack).toBe(false);
    // Next carries on from the slide that came back.
    engine.dispatch({ type: 'next' });
    expect(words(engine)).toBe('Verse');
  });

  it('cannot put back once something else has gone up', () => {
    const { engine } = sabha();
    engine.dispatch({ type: 'playItem', playlistId: 'ravi', itemId: 'i-kirtan' });
    engine.dispatch({ type: 'clearAll' });
    engine.dispatch({ type: 'next' });
    expect(engine.current.canPutBack).toBe(false);
    expect(engine.dispatch({ type: 'putBack' })).toMatchObject({ ok: false, error: 'nothing-to-put-back' });
    expect(words(engine)).toBe('Verse');
  });

  it('has nothing to put back when Clear all cleared nothing', () => {
    const { engine } = sabha();
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.canPutBack).toBe(false);
    expect(engine.dispatch({ type: 'putBack' })).toMatchObject({ ok: false });
  });
});

describe('Back undoes the last Next', () => {
  it('goes back exactly, across items, taking the picture down again', () => {
    const { engine } = sabha();
    engine.dispatch({ type: 'playItem', playlistId: 'ravi', itemId: 'i-kirtan' });
    engine.dispatch({ type: 'next' });
    const onVerse = engine.current.layers;
    // One Next too many: the picture item takes the words off and goes on the background.
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toBeNull();
    expect(engine.current.layers.background).toMatchObject({ mediaId: 'pic' });

    engine.dispatch({ type: 'back' });
    expect(engine.current.layers).toBe(onVerse);
    expect(engine.current.layers.background).toBeNull();
    expect(engine.current.live.playlist?.itemId).toBe('i-kirtan');
    expect(engine.current.next).toMatchObject({ kind: 'media', itemId: 'i-pic' });
    // And again, one Next at a time.
    engine.dispatch({ type: 'back' });
    expect(words(engine)).toBe('Chorus');
  });

  it('acts as Previous when something else changed since the Next', () => {
    const { engine } = sabha();
    engine.dispatch({ type: 'playItem', playlistId: 'ravi', itemId: 'i-kirtan' });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'clearLayer', layer: 'background' });
    engine.dispatch({ type: 'back' });
    // Previous from the picture item: the kirtan's last slide, the picture already cleared.
    expect(words(engine)).toBe('Verse');
    expect(engine.current.layers.background).toBeNull();
  });

  it('keeps working through black-out and the Wallpaper', () => {
    const { engine } = sabha();
    engine.dispatch({ type: 'playItem', playlistId: 'ravi', itemId: 'i-kirtan' });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'toggleBlackout' });
    engine.dispatch({ type: 'toggleBlackout' });
    engine.dispatch({ type: 'toggleWallpaper' });
    engine.dispatch({ type: 'toggleWallpaper' });
    engine.dispatch({ type: 'back' });
    expect(words(engine)).toBe('Chorus');
  });
});

describe('the Wallpaper (Session 55, in the Logo’s place)', () => {
  it('goes up and comes off without touching the layers', () => {
    const { engine } = sabha();
    engine.dispatch({ type: 'playItem', playlistId: 'ravi', itemId: 'i-kirtan' });
    const layers = engine.current.layers;
    expect(engine.dispatch({ type: 'toggleWallpaper' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.wallpaper).toBe(true);
    expect(engine.current.layers).toBe(layers);
    // Up again changes nothing.
    expect(engine.dispatch({ type: 'setWallpaper', on: true })).toMatchObject({ changed: false });
    engine.dispatch({ type: 'toggleWallpaper' });
    expect(engine.current.wallpaper).toBe(false);
    expect(engine.current.layers).toBe(layers);
  });

  it('leaves Black-out up after restoring a show saved with both covers', () => {
    const { engine } = sabha();
    const put = engine.restore({ slide: null, background: null, blackout: true, wallpaper: true });
    expect(put).toMatchObject({ wallpaper: false, blackout: true });
    expect(engine.current.wallpaper).toBe(false);
  });
});
