import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import type { EngineMessage } from '../../shared/engine/protocol';
import { FULL_LEVELS, type SoundLevels } from '../../shared/sound';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * X33: the operator's Audio and Video levels and mutes in the engine's state, the one place every page that plays sound
 * reads them (the hall's audio player, the stream's page). Main sets them (main/sound/levels.ts) and asks the engine to
 * say them again (refreshSound), as it does for Audio's Music steps aside switch: never a change to the show. Made-up
 * media ids only.
 */

const sound: EngineCommand = {
  type: 'playAudio',
  audio: { id: 'tone', title: 'Placeholder tone', mediaId: 'tone', volume: 1, loop: true },
};

function setup() {
  let levels: SoundLevels = FULL_LEVELS;
  const transport = new RecordingTransport();
  const playlists = new MemoryPlaylistSource();
  playlists.set('pl', [
    { id: 'i-clip', kind: 'media', mediaId: 'clip', media: 'video', label: 'Placeholder clip' },
  ]);
  const engine = new ShowEngine(makeSource(), transport, () => 1_000_000, playlists, {
    mediaLength: () => 60_000,
    soundOf: (id) => (id === 'tone' ? { gain: 0.5, silent: false } : null),
    stepsAside: () => true,
    levels: () => levels,
    schedule: () => () => undefined,
  });
  return {
    engine,
    transport,
    set: (next: SoundLevels) => {
      levels = next;
    },
  };
}

const levels = (
  audio: number,
  video: number,
  muted: { audio?: boolean; video?: boolean } = {},
): SoundLevels => ({
  audio: { level: audio, muted: muted.audio ?? false },
  video: { level: video, muted: muted.video ?? false },
});

describe('the operator’s levels and mutes in the engine’s state (X33)', () => {
  it('are said with the rest of how the files sounding play, as Main has them, and follow at once when changed', () => {
    const { engine, set } = setup();
    engine.dispatch(sound);
    expect(engine.current.sound).toEqual({
      stepsAside: true,
      gains: { tone: 0.5 },
      silent: [],
      levels: FULL_LEVELS,
    });
    set(levels(0.4, 1));
    const rev = engine.rev;
    expect(engine.refreshSound()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.sound?.levels).toEqual(levels(0.4, 1));
    expect(engine.rev).toBe(rev + 1);
    set(levels(0.4, 1, { video: true }));
    expect(engine.refreshSound()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.sound?.levels).toEqual(levels(0.4, 1, { video: true }));
    // Nothing new: nothing sent.
    expect(engine.refreshSound()).toMatchObject({ ok: true, changed: false });
    // With nothing playing too: a sound started later plays at them from its first moment.
    engine.dispatch({ type: 'clearLayer', layer: 'audio' });
    expect(engine.current.sound?.levels).toEqual(levels(0.4, 1, { video: true }));
  });

  it('are never a change to the show: the layers stay, Put it back and Oops have nothing of them to undo', () => {
    const { engine, set } = setup();
    engine.dispatch(sound);
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    const layers = engine.current.layers;
    const canPutBack = engine.current.canPutBack;
    set(levels(0.2, 0.3, { audio: true }));
    engine.refreshSound();
    expect(engine.current.layers).toBe(layers);
    expect(engine.current.canPutBack).toBe(canPutBack);
    // Oops takes back the last change to the show (the slide), never the levels.
    engine.dispatch({ type: 'oops' });
    expect(engine.current.layers.slide).toBeNull();
    expect(engine.current.sound?.levels).toEqual(levels(0.2, 0.3, { audio: true }));
  });

  it('a change of the levels alone goes to every page at once and spares the main process, as live captions do', () => {
    const { engine, transport, set } = setup();
    engine.dispatch(sound);
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    const heard: number[] = [];
    engine.onChange((state) => heard.push(state.sound?.levels?.audio.level ?? -1));
    const seen = engine.rev;
    for (const level of [0.9, 0.8, 0.7]) {
      set(levels(level, 1));
      engine.refreshSound();
    }
    // Each reached the pages (a patch of the sound alone)…
    const patches = transport.messages.filter(
      (m): m is Extract<EngineMessage, { kind: 'patch' }> => m.kind === 'patch',
    );
    expect(patches.slice(-3).map((p) => p.ops.map((op) => op.path[0]))).toEqual([
      ['sound'],
      ['sound'],
      ['sound'],
    ]);
    // …while Main's listeners (the recovery file, the menus, the phones' counts) heard nothing of them.
    expect(heard).toEqual([]);
    // A phone's Next sent with the revision it saw before still goes.
    expect(engine.dispatch({ type: 'next', rev: seen })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.live.slideIndex).toBe(1);
    expect(heard).toEqual([0.7]);
  });

  it('an engine with no library says nothing (every page plays each file as it is, at 100 %)', () => {
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => 1_000_000);
    engine.dispatch(sound);
    expect(engine.current.sound).toBeUndefined();
  });
});
