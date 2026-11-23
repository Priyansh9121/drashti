import { expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { MemoryPlaylistSource } from '../engine/playlist-source';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport, textSlide } from '../engine/testing';
import { prepareVideoProxies } from './proxy-showing';

/*
 * The lighter playing copies' hook (Edit Video S4) as Main wires it into the engine (index.ts), with every video needing
 * none: a change that puts up no new file must leave the engine's state as it was. The second mid-way CI on phase1
 * (lead-1121-094436-midway2) found Oops, Put it back and a cover's undo broken on both systems (one-at-a-time.spec.ts,
 * simple-mode.spec.ts, small-window.spec.ts): the hook gave back new layers on every change, so a cover counted as a
 * change of the screens. Placeholder names and media ids only.
 */

function setup() {
  const source = makeSource();
  source.set('words', [textSlide('w1', 'Placeholder one'), textSlide('w2', 'Placeholder two')]);
  const playlists = new MemoryPlaylistSource();
  playlists.set('pl', [
    { id: 'i-words', kind: 'presentation', presentationId: 'words', arrangementId: undefined },
    { id: 'i-clip', kind: 'media', mediaId: 'clip', media: 'video', label: 'Placeholder clip' },
  ]);
  const engine = new ShowEngine(source, new RecordingTransport(), () => 1_000_000, playlists, {
    mediaLength: () => 10_000,
    mediaKind: () => 'video',
    prepareVideoEdits: (previous, next, historic) =>
      prepareVideoProxies(previous, next, (id) => ({ mediaId: id, message: null }), historic),
  });
  const run = (command: unknown) => engine.dispatch(command as EngineCommand);
  const words = () => {
    const el = engine.current.layers.slide?.slide.elements[0];
    return el?.kind === 'text' ? el.text : null;
  };
  return { engine, run, words };
}

it('Oops after Next and the Wallpaper puts back the slide before Next and takes the Wallpaper off', () => {
  const { engine, run, words } = setup();
  run({ type: 'playItem', playlistId: 'pl', itemId: 'i-words' });
  run({ type: 'next' });
  expect(words()).toBe('Placeholder two');
  run({ type: 'toggleWallpaper' });
  expect(engine.current.wallpaper).toBe(true);
  run({ type: 'oops' });
  expect(engine.current.wallpaper).toBe(false);
  expect(words()).toBe('Placeholder one');
});

it('Oops after Black-out on and off puts the video back that Black-out took off', () => {
  const { engine, run } = setup();
  run({ type: 'playItem', playlistId: 'pl', itemId: 'i-clip' });
  const playing = engine.current.layers.background;
  expect(playing).toMatchObject({ kind: 'media', mediaId: 'clip' });
  run({ type: 'toggleBlackout' });
  expect(engine.current.layers.background).toBeNull();
  run({ type: 'toggleBlackout' });
  run({ type: 'oops' });
  expect(engine.current.layers.background).toEqual(playing);
});

it('Put it back stays offered after Clear all while a cover goes on', () => {
  const { engine, run } = setup();
  run({ type: 'playItem', playlistId: 'pl', itemId: 'i-words' });
  run({ type: 'clearAll' });
  expect(engine.current.canPutBack).toBe(true);
  run({ type: 'toggleBlackout' });
  expect(engine.current.canPutBack).toBe(true);
  run({ type: 'toggleWallpaper' });
  expect(engine.current.canPutBack).toBe(true);
});

it('a command that changes nothing leaves the state and its revision as they were', () => {
  const { engine, run } = setup();
  run({ type: 'playItem', playlistId: 'pl', itemId: 'i-words' });
  const before = engine.current;
  expect(run({ type: 'setWallpaper', on: false })).toMatchObject({ ok: true, changed: false });
  expect(engine.current).toBe(before);
});
