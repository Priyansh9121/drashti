import { deckMediaOf } from './deck-show';
import { type Playing, playingOf, type PlayingRef } from './engine/playing';
import type { AudioLayer, EngineState } from './engine/state';
import { playbackAtMs, playbackSpanMs } from './media';

/*
 * Drashti's own sound with everything else (Session 55, Part 7: the owner's ideas K and L).
 *
 * Even loudness (L): each video's and sound's loudness is measured once, with FFmpeg's EBU R128 meter (main/sound/:
 * at import, and once in the background for the library already there), and it plays at EVEN_LOUDNESS_LUFS, in the
 * hall (the audio player) and on the stream (the stream's page) alike, by a gain as it plays: the file is never
 * changed. A quiet file is made louder only as far as its loudest moment stays clean (EVEN_PEAK_DBTP) and at most by
 * EVEN_MOST_BOOST_DB, so nothing distorts and a quiet recording's hiss is not made a roar. A switch per file (Even
 * loudness, in its right-click menu) plays it as it is.
 *
 * Why −16 LUFS: it is the level most listening and streaming services play at (Apple's, and AES's recommendation
 * for sound played online, between YouTube's −14 and broadcast's −23), so the stream sounds like what people hear
 * elsewhere, and most music, mastered louder, only comes down a little in the hall, while a quiet talk comes up to it.
 *
 * Music steps aside (K): the audio layer (a sound, or an audio playlist's track) fades down to MUSIC_ASIDE_DB over
 * about a second while a video with sound plays (the background video, or a video on the slide up), and back up when
 * that video ends, is paused or is cleared; it never stops. The same while a slide's own sound or a deck's own
 * soundtrack plays over it (the owner's answer of 30 Oct: the music keeps playing, lowered, never stopped for it). On
 * by default; Audio's switch turns it off. A deck's own soundtrack with no music under it plays as its deck says.
 */

/** The loudness every video and sound plays at with even loudness (LUFS: EBU R128's integrated loudness). */
export const EVEN_LOUDNESS_LUFS = -16;
/** A file made louder never goes past this at its loudest moment (dBTP, true peak): nothing distorts. */
export const EVEN_PEAK_DBTP = -1;
/** The most a quiet file is made louder (dB). */
export const EVEN_MOST_BOOST_DB = 12;
/** Quieter than this overall (LUFS), a file has no sound to speak of (silence, or a faint hum). */
export const SILENT_BELOW_LUFS = -60;

/** The music under a video with sound (K): 14 dB down, about a fifth as loud: the video's words are clear, and the music is still there. */
export const MUSIC_ASIDE_DB = -14;
/** How long the music takes to step aside, and to come back (ms). */
export const MUSIC_ASIDE_FADE_MS = 1000;

/** What the loudness meter read in a file: its integrated loudness (LUFS) and true peak (dBTP). */
export interface Loudness {
  /** Null: no sound in it (no sound track, or only silence). */
  lufs: number | null;
  peak: number | null;
}

/** Whether a file measured so has sound to speak of. */
export const hasSound = (m: Loudness): boolean =>
  m.lufs !== null && Number.isFinite(m.lufs) && m.lufs >= SILENT_BELOW_LUFS;

/**
 * The gain (dB, to a tenth) that plays a file at the even level: down by what it is louder, up by what it is quieter,
 * but never past its clean peak, nor by more than EVEN_MOST_BOOST_DB. 0 for a file with no sound.
 */
export function evenGainDb(m: Loudness): number {
  if (!hasSound(m) || m.lufs === null) return 0;
  let db = EVEN_LOUDNESS_LUFS - m.lufs;
  if (db > 0) {
    const headroom = m.peak !== null && Number.isFinite(m.peak) ? EVEN_PEAK_DBTP - m.peak : 0;
    db = Math.min(db, EVEN_MOST_BOOST_DB, Math.max(0, headroom));
  }
  return Math.round(db * 10) / 10 || 0;
}

/** A gain in dB as a multiplier (0 dB: 1). */
export const gainOfDb = (db: number): number => 10 ** (db / 20);

/** A gain as the engine's state carries it: three decimals, so a file measured again the same says nothing new. */
export const roundedGain = (gain: number): number => Math.round(gain * 1000) / 1000;

/**
 * How Drashti's own sound plays now (Session 55, Part 7), the engine's `sound`: left out of an older state, and by an
 * engine with no library (then: the music steps aside, and every file plays as it is).
 */
export interface SoundState {
  /** Music steps aside under a video with sound (K): Audio's switch, on by default. */
  stepsAside: boolean;
  /** Even loudness (L): the gain each file sounding now plays with, by media id; one playing as it is is left out. */
  gains: Record<string, number>;
  /** Files up now that have no sound of their own (none in the file, or only silence): music never steps aside for them. */
  silent: string[];
}

/** The gain a file plays with now (even loudness), 1 when the state says none. */
export function gainOf(state: Pick<EngineState, 'sound'> | null | undefined, mediaId: string): number {
  const gains = state?.sound?.gains;
  const g = gains && Object.hasOwn(gains, mediaId) ? gains[mediaId] : undefined;
  return g !== undefined && Number.isFinite(g) && g > 0 ? g : 1;
}

/**
 * The files that may be sounding now: the audio layer's, the background video's, the slide's videos, its deck's own
 * sounds and its deck's transition sound. Each once.
 */
export function soundFilesOf(state: Pick<EngineState, 'layers'>): string[] {
  const ids = new Set<string>();
  const { audio, background, slide } = state.layers;
  if (audio?.mediaId) ids.add(audio.mediaId);
  // A slide's or a deck's own sound over the music (the owner's answer of 30 Oct).
  if (audio?.over?.mediaId) ids.add(audio.over.mediaId);
  if (background?.kind === 'media' && background.media === 'video') ids.add(background.mediaId);
  for (const el of slide?.slide.elements ?? []) if (el.kind === 'video') ids.add(el.mediaId);
  for (const m of slide?.slide.deck?.media ?? []) ids.add(m.mediaId);
  const chime = slide?.slide.deck?.transition?.soundId;
  if (chime) ids.add(chime);
  return [...ids];
}

/** Whether a sound over the music (the owner's answer of 30 Oct) plays at `now`, as playsAt has it. */
function overPlaysAt(over: AudioLayer, now: number): boolean {
  if (!over.mediaId) return false;
  return playsAt(
    {
      ref: { layer: 'audio' },
      mediaId: over.mediaId,
      clock: over,
      durationMs: over.durationMs,
      marks: [],
      track: false,
      paused: over.pausedAtMs !== undefined || over.seek?.paused === true,
    },
    now,
  );
}

/** Whether something playing makes sound at `now`: started, not paused, and short of its end (or going round). */
function playsAt(p: Playing, now: number): boolean {
  if (p.paused) return false;
  // A start still to come (a deck's video a moment after its click): not yet.
  if ((p.clock.seek ? p.clock.seek.at : p.clock.startedAt) > now) return false;
  if (p.clock.loop || p.durationMs === undefined) return true;
  const { end } = playbackSpanMs(p.clock.clip, p.durationMs);
  return playbackAtMs(p.clock, p.durationMs, now) < end;
}

/** A video on the slide up whose sound is turned right down (its own volume, or its deck's) makes none. */
function slideVideoHeard(state: EngineState, mediaId: string): boolean {
  const slide = state.layers.slide;
  if (!slide) return false;
  const own = deckMediaOf(slide.slide, mediaId, 'video');
  if (own) return !own.muted && own.volume > 0;
  const el = slide.slide.elements.find((e) => e.kind === 'video' && e.mediaId === mediaId);
  return el?.kind === 'video' && (el.volume ?? 1) > 0;
}

/**
 * Whether the music steps aside at `now` (the engine's time): Audio's switch on, a sound or an audio playlist's track
 * playing on the audio layer (not a deck's own sound set to play across its slides), and a video with sound playing
 * then: the background video, or a video on the slide up, known to have sound (a file not measured yet counts),
 * started, not paused and short of its end.
 */
export function musicAside(state: EngineState | null | undefined, now: number): boolean {
  if (!state || state.stopped || state.sound?.stepsAside === false) return false;
  const audio = state.layers.audio;
  if (!audio?.mediaId || audio.pausedAtMs !== undefined || audio.across) return false;
  // A slide's own sound or a deck's own soundtrack over it (the owner's answer of 30 Oct), until it ends.
  if (audio.over && overPlaysAt(audio.over, now)) return true;
  const silent = new Set(state.sound?.silent ?? []);
  const refs: PlayingRef[] = [{ layer: 'background' }];
  const seen = new Set<string>();
  for (const el of state.layers.slide?.slide.elements ?? []) {
    if (el.kind !== 'video' || seen.has(el.mediaId)) continue;
    seen.add(el.mediaId);
    if (slideVideoHeard(state, el.mediaId)) refs.push({ layer: 'slide', mediaId: el.mediaId });
  }
  return refs.some((ref) => {
    const p = playingOf(state, ref);
    return p !== null && p.sound !== true && !silent.has(p.mediaId) && playsAt(p, now);
  });
}

/**
 * The music's own level as it steps aside and comes back (Part 7, K), as a multiplier: 1 up, MUSIC_ASIDE_DB's aside.
 * Each page that plays sound keeps one, and asks it every few tens of milliseconds whether the music is aside now
 * (musicAside); it moves towards that by at most a whole fade a MUSIC_ASIDE_FADE_MS, evenly in decibels. First asked,
 * it is already there: a page opened while a video plays has the music aside at once.
 */
export class StepAside {
  private db: number | null = null;
  private at = 0;

  /** Its level at `nowMs` (the page's own clock), moving since the last time it was asked. */
  levelAt(aside: boolean, nowMs: number): number {
    const target = aside ? MUSIC_ASIDE_DB : 0;
    if (this.db === null) {
      this.db = target;
    } else {
      const most = (-MUSIC_ASIDE_DB * Math.max(0, nowMs - this.at)) / MUSIC_ASIDE_FADE_MS;
      const d = target - this.db;
      this.db = Math.abs(d) <= most ? target : this.db + Math.sign(d) * most;
    }
    this.at = nowMs;
    return this.db === 0 ? 1 : gainOfDb(this.db);
  }
}

/** Audio's switch and the files played as they are (their Even loudness off), for the operator window (Part 7). */
export interface SoundView {
  /** Music steps aside under a video with sound (K). */
  stepsAside: boolean;
  /** The files whose own Even loudness switch is off (the menus' ticks). */
  evenOff: string[];
}

export type SoundViewResult = { ok: true; view: SoundView } | { ok: false; message: string };

/** A video's or sound's loudness as Drashti knows it (Part 7, L): what it plays at, in the words' numbers. */
export interface FileSoundView {
  /** Its own switch: at the even level, or as it is. */
  even: boolean;
  /** Measured yet (for its bytes as they are). */
  measured: boolean;
  /** Its measured loudness (LUFS); null while not measured, or with no sound. */
  lufs: number | null;
  /** The gain it plays with at the even level (dB; 0 when off or not measured). */
  gainDb: number;
}

/** A file's Even loudness switched (Part 7, L): what it plays at now. */
export type EvenResult = ({ ok: true } & FileSoundView) | { ok: false; message: string };

/** A video's points set past its black and silence (Part 7, M): its points before (for Undo) and after. */
export type TrimEdgesResult =
  | {
      ok: true;
      /** Null: none at its start or end worth a point (nothing changed). */
      points: { startMs: number; endMs: number | null } | null;
      before: { startMs: number | null; endMs: number | null };
    }
  | { ok: false; message: string };
