import { type EngineState, videoClip, videoSeek } from '../../../shared/engine/state';
import type { DeckMedia } from '../../../shared/deck';
import { deckMediaOf, playsAcross } from '../../../shared/deck-show';
import { MUSIC_FADE_IN_MS, MUSIC_FADE_OUT_MS } from '../../../shared/music';
import type { PlaybackClip, PlaybackSeek } from '../../../shared/media';
import { gainOf } from '../../../shared/sound';

/** One sound the show is making: a file, when it started, and how. */
export interface Sound {
  /** The same key is the same playback, carrying on. */
  key: string;
  mediaId: string;
  startedAt: number;
  loop: boolean;
  /** 0 to 1. */
  volume: number;
  /** An audio playlist's track (Session 14): it fades in as it starts and out as it stops. */
  fadeInMs?: number;
  fadeOutMs?: number;
  /** Start and end points, and a jump to a marker (Session 14). */
  clip?: PlaybackClip;
  seek?: PlaybackSeek;
  /**
   * A deck's video or sound (Session 54, C2): it fades in from its start point and out before its end point as its
   * deck says, by where it plays (ms). Left out: none.
   */
  fades?: { inMs: number; outMs: number };
  /**
   * Even loudness (Session 55, Part 7, shared/sound.ts): the gain its file plays with, as the engine's state says, on
   * top of its volume (it can be more than 1: a quiet file made louder). Left out: 1, as it is.
   */
  gain?: number;
  /** The music (Part 7, K): the audio layer's sound, which steps aside under a video with sound. */
  aside?: true;
}

/** Its file's even-loudness gain (Session 55, Part 7), when it has one other than 1. */
function evenGain(state: EngineState, mediaId: string): { gain?: number } {
  const gain = gainOf(state, mediaId);
  return gain === 1 ? {} : { gain };
}

/** How loud a deck's video or sound plays (0 when muted), and its fades. */
function deckSound(m: DeckMedia | undefined): { volume?: number; fades?: Sound['fades'] } {
  if (!m) return {};
  const inMs = Math.max(0, m.fadeInMs ?? 0);
  const outMs = Math.max(0, m.fadeOutMs ?? 0);
  return {
    volume: m.muted ? 0 : Math.min(1, Math.max(0, m.volume)),
    ...(inMs > 0 || outMs > 0 ? { fades: { inMs, outMs } } : {}),
  };
}

/**
 * Whether the engine has sent a sound that plays on somewhere new since `was`: a jump (a skip or a marker), or
 * new start or end points while it plays (Session 52), which move every screen's picture at once
 * (BackgroundMedia.tsx, SlideView.tsx). Its player then checks it against the clock at once (resync()), so it
 * lands there with its picture: asked only at a jump, a start point moved 0.2 s left the sound 0.2 s off,
 * short of the half second that makes a sound jump, easing back at 2% a second for 10 s.
 */
export function soundMoved(was: Sound, now: Sound): boolean {
  return (
    was.seek?.at !== now.seek?.at ||
    was.clip?.startMs !== now.clip?.startMs ||
    was.clip?.endMs !== now.clip?.endMs
  );
}

/**
 * Every sound the show should be making now: the audio layer, the
 * background video's sound, and the sound of videos on the live slide, each
 * from when it started (so it is in step with the pictures), and from where
 * the time bar moved it, or waiting where it paused it (Session 54). Black-out
 * hides pictures, not sound.
 */
export function soundsOf(state: EngineState): Sound[] {
  // Drashti stopped (Session 54, access by Gmail): no sound at all, as every screen goes black.
  if (state.stopped) return [];
  const sounds: Sound[] = [];
  const audio = state.layers.audio;
  // A paused audio playlist makes no sound (it fades out, and starts again where it was).
  if (audio?.mediaId && audio.pausedAtMs === undefined) {
    sounds.push({
      key: `audio:${audio.mediaId}@${audio.startedAt}`,
      mediaId: audio.mediaId,
      startedAt: audio.startedAt,
      loop: audio.loop,
      volume: audio.volume,
      ...(audio.music ? { fadeInMs: MUSIC_FADE_IN_MS, fadeOutMs: MUSIC_FADE_OUT_MS } : {}),
      ...(audio.clip ? { clip: audio.clip } : {}),
      ...(audio.seek ? { seek: audio.seek } : {}),
      // A deck's sound set to play across slides (Session 54): its deck's fades.
      ...(audio.fades ? { fades: audio.fades } : {}),
      ...evenGain(state, audio.mediaId),
      // The music steps aside under a video with sound (Part 7), never a deck's own sound across its slides.
      ...(audio.across ? {} : { aside: true as const }),
    });
  }
  // A slide's own sound or a deck's own soundtrack over the music (Session 55, Part 7: the owner's answer of 30 Oct),
  // playing whatever the music does (paused, or between tracks), with its deck's fades.
  const over = audio?.over;
  if (over?.mediaId && over.pausedAtMs === undefined) {
    sounds.push({
      key: `over:${over.mediaId}@${over.startedAt}`,
      mediaId: over.mediaId,
      startedAt: over.startedAt,
      loop: over.loop,
      volume: over.volume,
      ...(over.clip ? { clip: over.clip } : {}),
      ...(over.seek ? { seek: over.seek } : {}),
      ...(over.fades ? { fades: over.fades } : {}),
      ...evenGain(state, over.mediaId),
    });
  }
  const bg = state.layers.background;
  if (bg?.kind === 'media' && bg.media === 'video') {
    sounds.push({
      key: `background:${bg.mediaId}@${bg.startedAt}`,
      mediaId: bg.mediaId,
      startedAt: bg.startedAt,
      loop: bg.loop,
      volume: 1,
      ...(bg.clip ? { clip: bg.clip } : {}),
      ...(bg.seek ? { seek: bg.seek } : {}),
      ...evenGain(state, bg.mediaId),
    });
  }
  const slide = state.layers.slide;
  if (slide) {
    for (const el of slide.slide.elements) {
      if (el.kind !== 'video') continue;
      // A deck's own video (Session 54, C2): as loud as its deck says, its loop and fades its deck's.
      const own = deckSound(deckMediaOf(slide.slide, el.mediaId, 'video'));
      const volume = own.volume ?? el.volume ?? 1;
      // A video whose sound is turned right down makes none.
      if (volume === 0) continue;
      const clip = videoClip(slide.clips, el.mediaId);
      const seek = videoSeek(slide.seeks, el.mediaId);
      sounds.push({
        // By the slide's id, not its position: a new order for the live slide keeps its sound going.
        key: `slide:${slide.slide.id}/${el.id}@${slide.shownAt}`,
        mediaId: el.mediaId,
        startedAt: slide.shownAt,
        loop: deckMediaOf(slide.slide, el.mediaId, 'video')?.loop ?? el.loop ?? false,
        volume,
        // Between its file's start and end points, as its picture plays (Session 52), from where the time bar left it
        // (Session 54).
        ...(clip ? { clip } : {}),
        ...(seek ? { seek } : {}),
        ...(own.fades ? { fades: own.fades } : {}),
        ...evenGain(state, el.mediaId),
      });
    }
    // A deck's sounds (Session 54, C2): each from its click, as the engine stamps it, between its deck's trims. One
    // set to play across slides plays on the audio layer instead, never as its slide's.
    for (const m of slide.slide.deck?.media ?? []) {
      const own = deckSound(m);
      if (m.kind !== 'audio' || own.volume === 0 || playsAcross(m)) continue;
      const clip = videoClip(slide.clips, m.mediaId);
      const seek = videoSeek(slide.seeks, m.mediaId);
      sounds.push({
        key: `deck:${slide.slide.id}/${m.mediaId}@${slide.shownAt}`,
        mediaId: m.mediaId,
        startedAt: slide.shownAt,
        loop: m.loop,
        volume: own.volume ?? 1,
        ...(clip ? { clip } : {}),
        ...(seek ? { seek } : {}),
        ...(own.fades ? { fades: own.fades } : {}),
        ...evenGain(state, m.mediaId),
      });
    }
    // Its deck's transition's sound, once, as the slide comes in with that transition (in order, or Drashti's own over
    // it), from when the engine stamped it: none when Drashti's comes instead, or after a jump. It plays on to its end
    // under the same key whatever clicks come meanwhile (C review: the first click cut it off).
    const chime = slide.slide.deck?.transition?.soundId;
    const rang = chime ? videoSeek(slide.seeks, chime) : undefined;
    if (chime && rang && !rang.waiting)
      sounds.push({
        key: `deck-transition:${slide.slide.id}@${slide.shownAt}`,
        mediaId: chime,
        startedAt: slide.shownAt,
        loop: false,
        volume: 1,
        seek: rang,
        ...evenGain(state, chime),
      });
  }
  return sounds;
}
