import { z } from 'zod';
import type { Transition, TransitionKind } from './model';
import { TRANSITION_KINDS } from './model';

/*
 * Repeat Slides (Session 26d; PLAN §7): a playlist whose slides go round by
 * themselves, the last back to the first, until it is stopped. Its steps are
 * its pictures and its presentations' slides, in order, each up for its
 * seconds, played as one presentation of their own, `repeat:<playlistId>`
 * (main/playlists/repeat-slides.ts), so the engine's auto-advance times it
 * on every screen at once. Stopping leaves the slide on the screens.
 */

/** The presentation a Repeat Slides playlist plays as. */
export const repeatPresentationId = (playlistId: string): string => `repeat:${playlistId}`;

/** The Repeat Slides playlist a presentation id plays, or null when it is not one. */
export function repeatPlaylistOf(presentationId: string): string | null {
  return presentationId.startsWith('repeat:') ? presentationId.slice('repeat:'.length) || null : null;
}

export const isRepeatId = (presentationId: string): boolean => repeatPlaylistOf(presentationId) !== null;

/** How a Repeat Slides playlist goes round (its settings, Pro Mode's to change). */
export interface RepeatSettings {
  /** How long each slide is up, from when it came on. */
  secondsEach: number;
  /** How each slide comes on; its length never more than half the seconds each. */
  transition: Transition;
}

export const REPEAT_SECONDS = { min: 3, max: 600 } as const;
export const REPEAT_TRANSITION_MS = { min: 300, max: 3000 } as const;

/** To begin with: a fade every 15 s, taking 1 s. */
export const DEFAULT_REPEAT: RepeatSettings = {
  secondsEach: 15,
  transition: { kind: 'dissolve', durationMs: 1000 },
};

/** The transitions Repeat Slides offers, Fade first (Session 27's after its own). */
export const REPEAT_TRANSITIONS: readonly TransitionKind[] = [
  'dissolve',
  'cut',
  'fade-black',
  'slide',
  'zoom',
  'wipe',
  'push',
  'zoom-dissolve',
  'lines',
  'words',
];

export const repeatSettingsSchema: z.ZodType<RepeatSettings> = z
  .object({
    secondsEach: z.number().min(REPEAT_SECONDS.min).max(REPEAT_SECONDS.max),
    transition: z.object({
      kind: z.enum(TRANSITION_KINDS),
      durationMs: z.number().int().min(0).max(REPEAT_TRANSITION_MS.max),
    }),
  })
  .refine(
    (s) =>
      s.transition.kind === 'cut' ||
      (s.transition.durationMs >= REPEAT_TRANSITION_MS.min &&
        s.transition.durationMs <= (s.secondsEach * 1000) / 2),
    { message: 'A transition takes 0.3 to 3 seconds, and never more than half the seconds each.' },
  );

/** A playlist's stored settings as Repeat Slides reads them: what is valid, else the defaults. */
export function repeatSettingsOf(json: string | null): RepeatSettings {
  if (!json) return DEFAULT_REPEAT;
  try {
    const parsed = repeatSettingsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : DEFAULT_REPEAT;
  } catch {
    return DEFAULT_REPEAT;
  }
}

/** Why a video or sound cannot go in a Repeat Slides playlist. */
export const REPEAT_REFUSES =
  'Repeat Slides holds pictures and slides only: a video or a sound cannot go round in it. Put it in another playlist.';
