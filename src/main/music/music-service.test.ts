import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { initialEngineState, type EngineState } from '../../shared/engine/state';
import { openDatabase } from '../db/database';
import { AudioPlaylistRepo } from '../db/audio-playlists';
import { MusicService } from './music-service';

/* Audio playlists in the library, and starting one (made-up sounds; the engine stood in for). */

function setup() {
  const db = openDatabase(':memory:');
  const sound = (id: string, extra = '') =>
    db
      .prepare(
        `INSERT INTO media (id, kind, name, path, duration_ms${extra ? ', playable' : ''}) VALUES (?, 'audio', ?, ?, 60000${extra ? ', 0' : ''})`,
      )
      .run(id, `Placeholder ${id}`, `${id}.mp3`);
  for (const id of ['s1', 's2', 's3', 's4']) sound(id);
  sound('broken', 'unplayable');
  db.prepare(
    "INSERT INTO media (id, kind, name, path) VALUES ('pic', 'image', 'Placeholder picture', 'pic.png')",
  ).run();
  let state: EngineState = initialEngineState();
  const commands: EngineCommand[] = [];
  const settings = new Map<string, unknown>();
  let r = 0;
  const service = new MusicService({
    repo: new AudioPlaylistRepo(db),
    settings: { get: (k) => settings.get(k), set: (k, v) => settings.set(k, v) },
    engine: {
      state: () => state,
      dispatch: (c) => {
        commands.push(c);
        return { ok: true, changed: true, rev: commands.length };
      },
    },
    changed: () => undefined,
    log: () => undefined,
    random: () => [0.9, 0.1, 0.5, 0.3][r++ % 4] ?? 0,
  });
  return {
    service,
    commands,
    setState: (s: EngineState) => {
      state = s;
    },
  };
}

describe('audio playlists', () => {
  it('keep sounds in order (only sounds), move and take them out', () => {
    const { service } = setup();
    const made = service.create('Placeholder before sabha');
    if (!made.ok || !made.id) throw new Error('not made');
    const id = made.id;
    expect(service.addTracks(id, ['s1', 's2', 'pic', 's3'], null).ok).toBe(true);
    expect(service.addTracks(id, ['pic'], null).ok).toBe(false);
    service.addTracks(id, ['s4'], 0);
    let list = service.view().playlists[0];
    expect(list?.tracks.map((t) => t.mediaId)).toEqual(['s4', 's1', 's2', 's3']);
    const [first] = list?.tracks ?? [];
    if (!first) throw new Error('no tracks');
    service.moveTrack(first.id, 3);
    list = service.view().playlists[0];
    expect(list?.tracks.map((t) => t.mediaId)).toEqual(['s1', 's2', 's3', 's4']);
    service.removeTrack(list?.tracks[1]?.id ?? '');
    list = service.view().playlists[0];
    expect(list?.tracks.map((t) => t.mediaId)).toEqual(['s1', 's3', 's4']);
    expect(list).toMatchObject({ loop: true, shuffle: false });
  });

  it('start from a track, its playable sounds in order; with none chosen, the last one played; paused, play on', () => {
    const { service, commands, setState } = setup();
    const made = service.create('Placeholder music');
    const id = made.ok ? (made.id ?? '') : '';
    service.addTracks(id, ['s1', 'broken', 's2', 's3'], null);
    expect(service.play(id, 2).ok).toBe(true);
    expect(commands.at(-1)).toMatchObject({
      type: 'playMusic',
      index: 1,
      music: {
        playlistId: id,
        tracks: [{ mediaId: 's1' }, { mediaId: 's2' }, { mediaId: 's3' }],
        loop: true,
      },
    });
    expect(service.view().lastId).toBe(id);
    // Paused: Play (no playlist named) plays on.
    const audio = {
      id: 'music',
      title: 'x',
      mediaId: 's2',
      volume: 1,
      loop: false,
      startedAt: 0,
      pausedAtMs: 5000,
      music: { playlistId: id, name: 'Placeholder music', tracks: [], index: 0, loop: true, shuffle: false },
    };
    setState({ ...initialEngineState(), layers: { ...initialEngineState().layers, audio } });
    service.play(null);
    expect(commands.at(-1)).toEqual({ type: 'resumeMusic' });
    // Nothing playing: the last one starts.
    setState(initialEngineState());
    service.play(null);
    expect(commands.at(-1)).toMatchObject({ type: 'playMusic', index: 0 });
  });

  it('shuffle, the chosen track first; and say so when nothing can play', () => {
    const { service, commands } = setup();
    const made = service.create('Placeholder shuffled');
    const id = made.ok ? (made.id ?? '') : '';
    service.addTracks(id, ['s1', 's2', 's3', 's4'], null);
    service.setOptions(id, { loop: false, shuffle: true });
    service.play(id, 2);
    const run = commands.at(-1) as Extract<EngineCommand, { type: 'playMusic' }>;
    expect(run.index).toBe(0);
    expect(run.music.tracks[0]?.mediaId).toBe('s3');
    expect(run.music.tracks.map((t) => t.mediaId).sort()).toEqual(['s1', 's2', 's3', 's4']);
    const empty = service.create('Placeholder empty');
    const emptyId = empty.ok ? (empty.id ?? '') : '';
    service.addTracks(emptyId, ['broken'], null);
    const refused = service.play(emptyId, 0);
    expect(refused.ok ? '' : refused.message).toContain('has no sound that can play');
  });
});
