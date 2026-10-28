import type { DeckMedia, DeckSlide } from '../../shared/deck';
import { playsAcross } from '../../shared/deck-show';
import type { AcrossSlides, AudioLayer, Layers, LiveCursor } from '../../shared/engine/state';
import { type AudioCue, soundCueOf } from '../../shared/library';
import type { PlaybackClip } from '../../shared/media';
import type { PlaybackMarker } from '../../shared/markers';
import type { DeckEntry } from './deck-steps';
import type { PlayedSlide } from './slide-source';

/*
 * A sound set to play across slides (Session 54; the owner: "the sound should play as it does in the deck's own
 * slideshow"): PowerPoint's Play Across Slides and "stop after N slides", and Keynote's soundtrack, which Keynote's own
 * PowerPoint copy has as a sound on the first slide playing across all of them (tried on the dev Mac). Taken from the
 * deck itself at import (deck-import.ts): a deck's own sound (its steps' media) or, for a deck that came in as
 * pictures, its slide's sound cue saying so. It goes on the audio layer, so the time bar, Back 15 s and the rest, the
 * sound's clear and Clear all, LIVE's line, the stage's time left, the audio player, the stream and a restart have it
 * as any sound, and it carries where it plays (`across`): its presentation and its last slide.
 *
 * - It starts with its slide, at its moment in the slide's coming in (by Next, or a click on the slide), or at its
 *   click; the same file already playing carries on as it is, so Next and a click on its slide never start it again.
 * - It plays on as the slides and their clicks change. Back and Previous never start it (back onto its slide, or
 *   undoing its click) and never stop it: Back undoing a Next leaves it as it plays now.
 * - It stops at its end (as any sound played once: held there, silent), once a slide past its last goes up (by Next
 *   or a jump), as soon as anything else goes live (another presentation or deck, a playlist's picture, video or
 *   input, Repeat Slides), at Clear all or the sound's own clear, and when another sound takes its place, as any
 *   sound does. Clearing only the slide, black-out, the logo or a timer shown alone leave it playing: its deck is
 *   still what is live.
 */

/** A sound set to play across slides, as it starts. */
export interface AcrossStart {
  mediaId: string;
  title: string;
  /** 0 to 1 (0 when its deck mutes it). */
  volume: number;
  loop: boolean;
  /** How many slides it plays across, its own the first. */
  slides: number;
  /** How long after now it starts (ms): its moment in its slide's coming in, or after its click. */
  offsetMs: number;
  fades?: { inMs: number; outMs: number };
}

/** A slide's sound cue set to play across slides (more than its own): started here, never as its plain sound. */
export const isAcrossCue = (cue: AudioCue | null): cue is AudioCue & { acrossSlides: number } =>
  cue !== null && (cue.acrossSlides ?? 1) > 1;

function fromDeck(m: DeckMedia, offsetMs: number): AcrossStart {
  const inMs = Math.max(0, m.fadeInMs ?? 0);
  const outMs = Math.max(0, m.fadeOutMs ?? 0);
  return {
    mediaId: m.mediaId,
    title: m.name ?? '',
    volume: m.muted ? 0 : Math.min(1, Math.max(0, m.volume)),
    loop: m.loop,
    slides: m.acrossSlides ?? 1,
    offsetMs: Math.max(0, Math.round(offsetMs)),
    ...(inMs > 0 || outMs > 0 ? { fades: { inMs, outMs } } : {}),
  };
}

/** The deck's own sound set to play across slides that starts at `step` (0: with the slide), the last of several. */
function deckAcross(deck: DeckSlide | undefined, step: number): DeckMedia | undefined {
  return deck?.media.findLast((m) => playsAcross(m) && 'step' in m.start && m.start.step === step);
}

/**
 * What a slide coming on starts that plays across slides: its deck's own with it, at its moment (its clip started
 * `fromMs` in, past the deck's own transition after a jump, starts it that much sooner), else its sound cue saying
 * so. Never when it is come back to (Back and Previous). A cue whose file is missing starts nothing (`heard` false).
 */
export function startsWith(
  played: PlayedSlide,
  entry: DeckEntry,
  fromMs: number,
  heard: boolean,
): AcrossStart | null {
  if (entry === 'back') return null;
  const own = deckAcross(played.slide.deck, 0);
  if (own) return fromDeck(own, ('offsetMs' in own.start ? own.start.offsetMs : 0) - fromMs);
  const cue = soundCueOf(played.cues);
  if (!heard || !isAcrossCue(cue)) return null;
  return {
    mediaId: cue.mediaId,
    title: cue.label || cue.name,
    volume: cue.volume,
    loop: cue.loop,
    slides: cue.acrossSlides,
    offsetMs: 0,
  };
}

/** What a click (Next to step `step`) starts that plays across slides, after its own delay. */
export function startsAt(deck: DeckSlide | undefined, step: number): AcrossStart | null {
  const own = deckAcross(deck, step);
  return own ? fromDeck(own, 'offsetMs' in own.start ? own.start.offsetMs : 0) : null;
}

/**
 * The audio layer for a sound set to play across slides from slide `slideIndex` of `presentationId`, starting `at`
 * plus its offset; null when nothing changes: the same file already playing across this presentation's slides
 * carries on as it is (never from its start again). The same file playing otherwise carries on too, from where it
 * is, now across these slides (as a slide's sound carries on a file already playing). Any other takes the place of
 * the sound playing, as a slide's sound does.
 */
export function acrossLayer(
  start: AcrossStart,
  where: { presentationId: string; slideIndex: number },
  at: number,
  playing: AudioLayer | null,
  library: { durationMs?: number; clip?: PlaybackClip; marks?: PlaybackMarker[] },
): AudioLayer | null {
  const same = playing?.mediaId === start.mediaId ? playing : null;
  if (same?.across?.presentationId === where.presentationId) return null;
  const across: AcrossSlides = {
    presentationId: where.presentationId,
    lastIndex: where.slideIndex + Math.max(1, start.slides) - 1,
  };
  return {
    id: `across:${start.mediaId}`,
    title: start.title,
    mediaId: start.mediaId,
    volume: start.volume,
    loop: start.loop,
    startedAt: same ? same.startedAt : at + start.offsetMs,
    ...library,
    ...(same?.seek ? { seek: same.seek } : {}),
    across,
    ...(start.fades ? { fades: start.fades } : {}),
  };
}

/** Whether a sound playing across slides plays on with the show at `live`: one of its deck's slides, up to its last. */
export function playsOn(across: AcrossSlides, live: LiveCursor): boolean {
  return live.presentationId === across.presentationId && (live.slideIndex ?? 0) <= across.lastIndex;
}

/** The layers Back puts back, the sound playing across slides now playing on as it is (Back never stops it). */
export function keptPlaying(layers: Layers, playing: AudioLayer | null): Layers {
  return playing?.across && layers.audio !== playing ? { ...layers, audio: playing } : layers;
}
