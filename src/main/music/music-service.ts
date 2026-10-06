import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import type { EngineState } from '../../shared/engine/state';
import { idSchema } from '../../shared/model-schema';
import type { MusicPlaylist, MusicResult, MusicView } from '../../shared/music';
import { musicNameSchema, musicOptionsSchema } from '../../shared/music';
import type { AudioPlaylistRepo } from '../db/audio-playlists';

/*
 * Audio playlists (shared/music.ts) as the main process keeps and plays
 * them: the library's lists, and starting one (its playable tracks, in
 * order or shuffled, handed to the engine, which plays them one after
 * another). Pausing, playing on and moving between tracks are the engine's
 * own commands.
 */

const LAST = 'musicPlaylistId';

export interface MusicDeps {
  repo: AudioPlaylistRepo;
  settings: { get(key: string): unknown; set(key: string, value: unknown): void };
  engine: { state(): EngineState; dispatch(command: EngineCommand): CommandResult };
  changed(view: MusicView): void;
  log(message: string): void;
  /** A random number in [0, 1) (Math.random; tests give their own). */
  random?: () => number;
}

const gone = { ok: false as const, message: 'That audio playlist is no longer there.' };

export class MusicService {
  /**
   * The playlist played last, as known here: kept at once, while the setting is written when the
   * library is free (Session 15: never in the way of the show). Undefined until first read.
   */
  private last: unknown;

  constructor(private readonly deps: MusicDeps) {}

  view(): MusicView {
    const playlists = this.deps.repo.list();
    this.last ??= this.deps.settings.get(LAST) ?? null;
    const last = this.last;
    return {
      playlists,
      lastId: typeof last === 'string' && playlists.some((p) => p.id === last) ? last : null,
    };
  }

  private done(id?: string): MusicResult {
    const view = this.view();
    this.deps.changed(view);
    return { ok: true, view, ...(id ? { id } : {}) };
  }

  create(rawName: unknown): MusicResult {
    const name = musicNameSchema.safeParse(rawName);
    if (!name.success) return { ok: false, message: 'Give it a name (up to 120 characters).' };
    const id = this.deps.repo.create(name.data);
    this.deps.log('Music: made an audio playlist');
    return this.done(id);
  }

  rename(rawId: unknown, rawName: unknown): MusicResult {
    const id = idSchema.safeParse(rawId);
    const name = musicNameSchema.safeParse(rawName);
    if (!name.success) return { ok: false, message: 'Give it a name (up to 120 characters).' };
    return id.success && this.deps.repo.rename(id.data, name.data) ? this.done(id.data) : gone;
  }

  remove(rawId: unknown): MusicResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.deps.repo.remove(id.data)) return gone;
    // Playing it: the music stops (with its fade).
    if (this.deps.engine.state().layers.audio?.music?.playlistId === id.data)
      this.deps.engine.dispatch({ type: 'clearLayer', layer: 'audio' });
    this.deps.log('Music: removed an audio playlist');
    return this.done();
  }

  setOptions(rawId: unknown, raw: unknown): MusicResult {
    const id = idSchema.safeParse(rawId);
    const options = musicOptionsSchema.safeParse(raw);
    if (!id.success || !options.success || !this.deps.repo.setOptions(id.data, options.data)) return gone;
    // Going round again changes at once; a new shuffle from the next Play.
    if (this.deps.engine.state().layers.audio?.music?.playlistId === id.data)
      this.deps.engine.dispatch({ type: 'setMusicLoop', loop: options.data.loop });
    return this.done(id.data);
  }

  addTracks(rawId: unknown, rawMediaIds: unknown, rawAt: unknown): MusicResult {
    const id = idSchema.safeParse(rawId);
    const media = idSchema.array().min(1).max(500).safeParse(rawMediaIds);
    const at = typeof rawAt === 'number' && Number.isInteger(rawAt) ? rawAt : null;
    if (!id.success || !media.success) return gone;
    const added = this.deps.repo.addTracks(id.data, media.data, at);
    if (added === 0) return { ok: false, message: 'Only sounds from the media library can go in.' };
    return this.done(id.data);
  }

  moveTrack(rawTrackId: unknown, rawTo: unknown): MusicResult {
    const id = idSchema.safeParse(rawTrackId);
    if (!id.success || typeof rawTo !== 'number' || !this.deps.repo.moveTrack(id.data, rawTo)) return gone;
    return this.done();
  }

  removeTrack(rawTrackId: unknown): MusicResult {
    const id = idSchema.safeParse(rawTrackId);
    if (!id.success || !this.deps.repo.removeTrack(id.data)) return gone;
    return this.done();
  }

  /**
   * Play: an audio playlist from one of its tracks (its playable ones, in
   * order or shuffled); with no playlist, the one paused plays on, or the
   * one played last starts (Simple Mode's Play, the remote, the API).
   */
  play(playlistId: string | null, trackIndex = 0): MusicResult {
    const audio = this.deps.engine.state().layers.audio;
    if (playlistId === null && audio?.music) {
      if (audio.pausedAtMs !== undefined) this.deps.engine.dispatch({ type: 'resumeMusic' });
      return { ok: true, view: this.view() };
    }
    const view = this.view();
    const p =
      view.playlists.find((x) => x.id === (playlistId ?? view.lastId)) ??
      (playlistId === null ? view.playlists[0] : undefined);
    if (!p) return playlistId === null ? { ok: false, message: 'There is no audio playlist yet.' } : gone;
    const { tracks, index } = this.playOrder(p, trackIndex);
    if (tracks.length === 0) return { ok: false, message: `“${p.name}” has no sound that can play.` };
    const started = this.deps.engine.dispatch({
      type: 'playMusic',
      music: {
        playlistId: p.id,
        name: p.name,
        tracks: tracks.map((t) => ({ mediaId: t.mediaId, title: t.name })),
        loop: p.loop,
        shuffle: p.shuffle,
      },
      index,
    });
    if (!started.ok) return { ok: false, message: started.message };
    this.last = p.id;
    this.deps.settings.set(LAST, p.id);
    this.deps.log(`Music: playing an audio playlist (${String(tracks.length)} track(s))`);
    return this.done(p.id);
  }

  /**
   * Its playable tracks in the order they play, and where to start: in the
   * playlist's order from the one asked for; shuffled, that one first and the
   * rest at random.
   */
  private playOrder(p: MusicPlaylist, from: number): { tracks: MusicPlaylist['tracks']; index: number } {
    const first = p.tracks[Math.max(0, Math.min(from, p.tracks.length - 1))];
    const playable = p.tracks.filter((t) => t.playable);
    if (!p.shuffle) return { tracks: playable, index: first ? Math.max(0, playable.indexOf(first)) : 0 };
    const random = this.deps.random ?? Math.random;
    const lead = from > 0 && first?.playable ? first : null;
    const rest = playable.filter((t) => t !== lead);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const [a, b] = [rest[i], rest[j]];
      if (a && b) [rest[i], rest[j]] = [b, a];
    }
    return { tracks: lead ? [lead, ...rest] : rest, index: 0 };
  }
}
