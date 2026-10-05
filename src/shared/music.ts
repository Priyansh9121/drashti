import { z } from 'zod';
import { idSchema } from './model-schema';

/*
 * Audio playlists (Session 14): ordered lists of sounds from the media
 * library, played one after another on the audio layer by the one audio
 * player, independent of the slides (music before the sabha, say). Play,
 * pause, next and previous, going round again at the end, and an optional
 * shuffle. Short fades when the music stops and between tracks. The engine
 * keeps the tracks in play order (shared/engine/state.ts MusicRun), so every
 * window, the remote and recovery agree.
 *
 * How it meets the rest of the audio layer: one sound at a time. A slide's
 * sound cue (or a sound item, a macro's sound, a kirtan's recording) takes
 * the audio layer and the music stops, with its fade; Back after that Next
 * brings it back where it would be by now. Clear audio (F6) and Clear all
 * stop it; Put it back brings it back where it would be by now. Music
 * playing is never undone by Back or Put it back (it is independent of the
 * slides), and starting, pausing or moving through it does not stop them
 * from working. After an unexpected stop it comes back where it would be by
 * now, or paused where it was. Simple Mode plays and pauses it; the remote
 * and the API play, pause, and move to the next or previous track.
 */

export interface MusicTrackInfo {
  /** The track's own id in the playlist (a sound can be in it twice). */
  id: string;
  mediaId: string;
  name: string;
  /** Its length once learned (ms), or null. */
  durationMs: number | null;
  /** The file is missing, or Drashti cannot play it: it is passed over. */
  playable: boolean;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  loop: boolean;
  shuffle: boolean;
  tracks: MusicTrackInfo[];
}

export interface MusicView {
  playlists: MusicPlaylist[];
  /** The one played last (Simple Mode's Play starts it), or null. */
  lastId: string | null;
}

export type MusicResult = { ok: true; view: MusicView; id?: string } | { ok: false; message: string };

export const musicNameSchema = z.string().trim().min(1).max(120);
export const musicOptionsSchema = z.object({ loop: z.boolean(), shuffle: z.boolean() }).strict();
export const musicPlaySchema = z
  .object({ playlistId: idSchema.nullable(), index: z.number().int().min(0).max(999).default(0) })
  .strict();

/** Fades on the one audio player: in as a track starts, out as it stops (pause, next, Clear audio). */
export const MUSIC_FADE_IN_MS = 400;
export const MUSIC_FADE_OUT_MS = 700;
