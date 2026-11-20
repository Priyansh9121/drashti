import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import { playingOf } from '../../shared/engine/playing';
import type { EngineState } from '../../shared/engine/state';
import { playbackAtMs, playbackSpanMs } from '../../shared/media';
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
/** The track an audio playlist was stopped on part-way (alpha.20): its playlist and the track's file. */
const STOPPED = 'musicStoppedAt';

/** Where the music stopped part-way: Play with no track asked plays on from there. */
interface Stopped {
  playlistId: string;
  mediaId: string;
}

const isStopped = (v: unknown): v is Stopped =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Stopped).playlistId === 'string' &&
  typeof (v as Stopped).mediaId === 'string';

/** Within this of a track's end point, the track was played to its end (ms). */
const AT_ITS_END_MS = 1500;

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
  /**
   * The music playing now, as last seen (alpha.20): its playlist, the track and whether it is the last one; then, once
   * it is gone part-way, where it stopped (kept with the library's settings, through a quit).
   */
  private following: { playlistId: string; mediaId: string; last: boolean; state: EngineState } | null = null;
  private stopped: Stopped | null | undefined;

  constructor(private readonly deps: MusicDeps) {}

  /** Where the music last stopped part-way, as known here (read from the library's settings once). */
  private stoppedAt(): Stopped | null {
    if (this.stopped === undefined) {
      const kept = this.deps.settings.get(STOPPED);
      this.stopped = isStopped(kept) ? kept : null;
    }
    return this.stopped;
  }

  private keepStopped(stopped: Stopped | null): void {
    this.stopped = stopped;
    this.deps.settings.set(STOPPED, stopped);
  }

  /**
   * The engine's state changed (alpha.20): an audio playlist that goes away part-way (Clear audio, another sound in its
   * place) keeps the track it stopped on; one played to the end of its last track keeps nothing.
   */
  follow(state: EngineState): void {
    const run = state.layers.audio?.music;
    const track = run?.tracks[run.index];
    if (run && track) {
      this.following = {
        playlistId: run.playlistId,
        mediaId: track.mediaId,
        last: run.index >= run.tracks.length - 1 && !run.loop,
        state,
      };
      return;
    }
    const was = this.following;
    this.following = null;
    if (!was) return;
    if (was.last && this.atItsEnd(was.state)) {
      if (this.stoppedAt()?.playlistId === was.playlistId) this.keepStopped(null);
      return;
    }
    this.keepStopped({ playlistId: was.playlistId, mediaId: was.mediaId });
  }

  /** Drashti quitting while an audio playlist plays: it plays on from this track next time. */
  quitting(): void {
    const was = this.following;
    if (was) this.keepStopped({ playlistId: was.playlistId, mediaId: was.mediaId });
  }

  /** Whether the track playing in this state is at (or past) its end point now. */
  private atItsEnd(state: EngineState): boolean {
    const playing = playingOf(state, { layer: 'audio' });
    const length = playing?.durationMs;
    if (!playing || length === undefined) return false;
    const { end } = playbackSpanMs(playing.clock.clip, length);
    return playbackAtMs(playing.clock, length, Date.now()) >= end - AT_ITS_END_MS;
  }

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

  /** Undo: a playlist removed, back with its tracks (until Drashti next starts, Session 26a). */
  restore(rawId: unknown): MusicResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.deps.repo.restore(id.data)) return gone;
    this.deps.log('Music: brought back an audio playlist');
    return this.done(id.data);
  }

  /** Undo: a track taken out, back at its place. */
  restoreTrack(rawTrackId: unknown, rawAt: unknown): MusicResult {
    const id = idSchema.safeParse(rawTrackId);
    const at = typeof rawAt === 'number' && Number.isInteger(rawAt) ? rawAt : 0;
    if (!id.success || !this.deps.repo.restoreTrack(id.data, at)) return gone;
    return this.done();
  }

  /**
   * Play: an audio playlist from one of its tracks (its playable ones, in
   * order or shuffled); with no playlist, the one paused plays on, or the
   * one played last starts (Simple Mode's Play, the remote, the API). With no track asked (alpha.20), the track it was
   * stopped on part-way, else its first.
   */
  play(playlistId: string | null, asked?: number): MusicResult {
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
    const stopped = this.stoppedAt();
    const onFrom =
      asked === undefined && stopped?.playlistId === p.id
        ? p.tracks.findIndex((t) => t.mediaId === stopped.mediaId)
        : -1;
    const trackIndex = asked ?? Math.max(0, onFrom);
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
    // Played again from somewhere: where it stopped is used, or no longer wanted.
    if (stopped?.playlistId === p.id) this.keepStopped(null);
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
