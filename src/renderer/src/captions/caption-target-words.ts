import {
  NO_CAPTION_TRANSLATION,
  translationTarget,
  type CaptionTarget,
  type CaptionTranslationStatus,
  type CaptionTranslationUnavailable,
} from '../../../shared/caption-translation';
import type { CaptionsStatus } from '../../../shared/captions';
import { LANGUAGE_NAMES } from './captions-words';

/*
 * "Captions in" (alpha.24, QA24-CAPLANG-2, the owner's 2a-2f, all A): the Live captions dialog's words for translated
 * captions, and the status bar's line while a chosen translation cannot be made. Plain words; nothing heard is ever
 * in them.
 */

/** How translated captions stand on this computer (none from a Drashti that says nothing of them). */
export const translationOf = (view: CaptionsStatus): CaptionTranslationStatus =>
  view.translation ?? NO_CAPTION_TRANSLATION;

/** What "Captions in" is set to (the speaker's own words in a library from before alpha.24). */
export const chosenTarget = (view: CaptionsStatus): CaptionTarget => view.settings.captionLanguage ?? 'same';

/** 2e: the Trial warning, once a translation is chosen. */
export const TRANSLATION_TRIAL_WARNING =
  'Trial: translated captions are a machine translation made on this computer, and nobody checks them before they show. They can say something the speaker did not, including wrong times and numbers. Have a reader who knows both languages check them in a rehearsal before a sabha uses them.';

/** How translated captions show (2b, 2c), once a translation is chosen. */
export const TRANSLATION_HOW =
  'The audience screens and the stream show the translation a whole phrase at a time, about a second after the speaker pauses; a long one shows as two-line pages. A phrase whose translation is late is skipped, never shown late. The stage screens keep the speaker’s own words.';

/** Why "Captions in" cannot translate on this computer now, in plain words (null: this Drashti says nothing). */
export function unavailableText(reason: CaptionTranslationUnavailable | null): string {
  switch (reason) {
    case 'no-engine':
      return 'This copy of Drashti has no translation program, so it cannot translate captions.';
    case 'no-pack':
      return 'The translation model pack is not on this computer. Import it in Help › Caption and Translation Models… first.';
    case 'unknown-model':
      return 'The translation model pack on this computer has a model this copy of Drashti cannot use. Import the pack from this release’s page.';
    case 'speaker-as-heard':
      return 'As heard, captions are not translated: they show the speaker’s own words. Choose one speaker’s language above to translate them.';
    case 'speaker-sanskrit':
      return 'Sanskrit speech is not translated: captions show the speaker’s own words.';
    case 'too-slow':
      return 'This computer could not keep up with translated captions, so they stopped. They are offered only where live captions keep up. Choosing a language in Captions in again tries once more.';
    case 'engine-fault':
      return 'The translation engine stopped or could not load its model, so translated captions are off. Choosing a language in Captions in again tries once more.';
    case null:
      return 'Translated captions are not ready on this computer.';
  }
}

/**
 * Whether choosing "Captions in" again mends it (df4a47045: main forgets a stop for slowness or the engine's fault and
 * loads the model once more), so the translations stay choosable while it says so.
 */
export const triedAgainOnChoosing = (reason: CaptionTranslationUnavailable | null): boolean =>
  reason === 'too-slow' || reason === 'engine-fault';

/**
 * Why the translations in "Captions in" are greyed out now, or null while one can be chosen. A reason main left out is
 * the speaker's language's own where it has one ("as heard", Sanskrit).
 */
export function captionTargetWhyNot(view: CaptionsStatus): string | null {
  const reason = captionTargetReason(view);
  return reason === undefined ? null : unavailableText(reason);
}

/** Why this computer cannot translate now (null: no reason given), or undefined while it can. */
export function captionTargetReason(view: CaptionsStatus): CaptionTranslationUnavailable | null | undefined {
  const t = translationOf(view);
  if (t.offered) return undefined;
  const speaker = view.settings.language;
  return (
    t.unavailable ?? (speaker === 'auto' ? 'speaker-as-heard' : speaker === 'sa' ? 'speaker-sanskrit' : null)
  );
}

/** Phrases skipped since captions started (2c): late, failed, or could not be shown. */
export function skippedText(skipped: number): string {
  if (skipped === 0) return 'No phrase has been skipped since captions started.';
  if (skipped === 1)
    return '1 phrase was skipped since captions started: its translation came too late or failed, so it was not shown.';
  return `${String(skipped)} phrases were skipped since captions started: their translation came too late or failed, so they were not shown.`;
}

/** The engine's last fault (2c), as the dialog says it. */
export const faultText = (fault: string): string => `Last problem translating captions: ${fault}`;

/** The speaker's own language chosen as the target: the speaker's own words show. */
export function sameLanguageText(view: CaptionsStatus): string | null {
  const target = chosenTarget(view);
  if (target === 'same' || target !== view.settings.language) return null;
  return `The speaker’s language is ${LANGUAGE_NAMES[target]}, so captions show the speaker’s own words.`;
}

/** A translation chosen but not possible now: what the screens show meanwhile (2c: never the speaker's words). */
export function chosenUnavailableText(
  view: CaptionsStatus,
): { tone: 'warning' | 'danger'; text: string; retry: boolean } | null {
  const target = chosenTarget(view);
  if (target === 'same' || target === view.settings.language) return null;
  const why = captionTargetWhyNot(view);
  if (why === null) return null;
  const t = translationOf(view);
  const speakers = t.unavailable === 'speaker-as-heard' || t.unavailable === 'speaker-sanskrit';
  if (speakers || translationTarget(view.settings.language, target) === null)
    return { tone: 'warning', text: why, retry: false };
  return {
    tone: 'danger',
    // Choosing again tries once more after slowness or the engine's fault: Try again does so.
    retry: triedAgainOnChoosing(captionTargetReason(view) ?? null),
    text: `${why} Until then the audience screens and the stream show no captions, and the stage screens keep the speaker’s words. Choose Same as the speaker to show the speaker’s own words everywhere.`,
  };
}

/** The status bar's short reason (2c: "If the engine stops or the pack is missing, the status bar says so"). */
function shortReason(reason: CaptionTranslationUnavailable | null): string | null {
  switch (reason) {
    case 'no-engine':
      return 'this copy of Drashti has no translation program';
    case 'no-pack':
      return 'the translation model pack is not on this computer';
    case 'unknown-model':
      return 'this copy of Drashti cannot use the translation pack’s model';
    case 'too-slow':
      return 'this computer cannot keep up with them';
    case 'engine-fault':
      return 'the translation engine stopped';
    case 'speaker-as-heard':
    case 'speaker-sanskrit':
    case null:
      return null;
  }
}

/**
 * The status bar's line while captions are on, a translation is chosen for a pair that translates, and it cannot be
 * made now (the audience screens and the stream show no captions meanwhile); null otherwise. Captions' own line
 * (resting, no sound input, stopped) comes first (captions-store.ts).
 */
export function translationStatusLine(view: CaptionsStatus | null): string | null {
  if (!view?.on) return null;
  if (translationTarget(view.settings.language, chosenTarget(view)) === null) return null;
  const t = translationOf(view);
  if (t.offered) return null;
  const reason = shortReason(t.unavailable);
  if (reason !== null) return `Translated captions are off: ${reason}.`;
  if (t.fault !== null) return `Translated captions are off: ${t.fault}`;
  return 'Translated captions are off on this computer.';
}
