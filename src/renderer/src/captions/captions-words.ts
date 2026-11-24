import {
  CAPTIONS_STOP_AFTER_RESTS,
  type CaptionsStatus,
  type CaptionsStopped,
  type CaptionTiming,
  type LanguageModelLanguage,
  type LanguageModelView,
} from '../../../shared/captions';
import type { SlowHold, SpeechLanguage } from '../../../shared/speech';

/* The Live captions dialog's words (Session 55, Part 10). */

export const megabytes = (bytes: number): string => `${String(Math.round(bytes / 1_000_000))} MB`;

/**
 * Whether the dialog's On switch is greyed out: off, with no engine that can run on this computer. Captions that are
 * on can always be turned off (the review's S1: another language can leave them on with no engine).
 */
export function captionsSwitchDisabled(view: CaptionsStatus): boolean {
  return !view.engine && !view.on;
}

/** What the listening is doing now, and what to do about it. */
export function captionsStateText(view: CaptionsStatus): string {
  if (!view.engine) return view.engineProblem ?? 'This copy of Drashti has no captions engine.';
  if (!view.on) return view.stopped ? stoppedText(view.stopped) : 'Off on this computer.';
  const s = view.speech;
  switch (s.phase) {
    case 'off':
      return 'On: captions start when the screens are ready.';
    case 'starting':
      return 'Starting…';
    case 'listening':
      return 'Listening to the stream’s sound input.';
    case 'held':
      if (s.reason === 'busy' && s.slow) return slowText(s.slow);
      if (s.reason === 'busy')
        return 'Resting: this computer is busy, and the show comes first. Captions try again by themselves in a minute.';
      if (s.reason === 'no-sound-input')
        return 'No sound input is chosen for the stream: choose one in the stream’s settings, and captions start.';
      return 'Waiting for the model.';
    case 'failed':
      return s.message;
  }
}

/** Tenths of a second, as words say them: 9100 ms is 9.1. */
const seconds = (ms: number): string => (Math.round(ms / 100) / 10).toFixed(1);

/** What the engine measured when it rested (cap-threads): the answer's time, or how far behind it fell. */
function measured(slow: SlowHold): string {
  const threads = slow.threads === 1 ? '1 engine thread' : `${String(slow.threads)} engine threads`;
  return slow.behindMs > 8_000
    ? `it fell ${seconds(slow.behindMs)} seconds behind the speaker, with ${threads}`
    : `an answer took ${seconds(slow.answerMs)} seconds, with ${threads}`;
}

/** Resting because this computer cannot keep up (cap-threads): what was measured, and whether it keeps happening. */
function slowText(slow: SlowHold): string {
  // Kept up since it started: busy for a while, and no stop can come (review MUST-1), so none is promised.
  if (slow.rests > 1 && slow.keptUp)
    return `Resting again (${String(slow.rests)} times in a row): this computer could not keep up for a while (${measured(slow)}). Captions try again by themselves in a minute; the show comes first.`;
  if (slow.rests > 1)
    return `Resting again (${String(slow.rests)} times in a row): this computer may be too slow for live captions with this model (${measured(slow)}). Captions try once more in a minute; after ${String(CAPTIONS_STOP_AFTER_RESTS)} rests in a row they stop.`;
  return `Resting: this computer could not keep up with live captions (${measured(slow)}), so captions rest for a minute and then try again by themselves. The show comes first.`;
}

/** For Gujarati or Hindi, the IndicConformer model pack: it keeps up on slower computers (cap-threads). */
function packPointer(language: SpeechLanguage | 'auto'): string {
  if (language === 'gu' || language === 'hi') {
    const name = LANGUAGE_NAMES[language];
    return ` For ${name}, import the ${name} IndicConformer model pack (Help › Caption and Translation Models…) and choose it under ${name} model: it keeps up on slower computers.`;
  }
  if (language === 'auto')
    return ' For Gujarati or Hindi, choose the speaker’s language, then import its IndicConformer model pack (Help › Caption and Translation Models…) and choose it under that language’s model: it keeps up on slower computers.';
  return '';
}

/** Captions stopped by themselves (cap-threads, the owner: "Say so and stop"): why, and what can keep up. */
function stoppedText(stopped: CaptionsStopped): string {
  return `Off: this computer is too slow for live captions with this model. They rested ${String(stopped.slow.rests)} times in a row (${measured(stopped.slow)}), so they stopped.${packPointer(stopped.language)} Turn captions on to try again.`;
}

/**
 * The status bar's line while captions are on but show nothing for a reason the operator should know (cap-threads):
 * resting because the computer cannot keep up, no sound input, no model yet, or stopped; and while they are off
 * because this computer was too slow for them. Null otherwise.
 */
export function captionsStatusLine(view: CaptionsStatus | null): string | null {
  if (!view) return null;
  if (!view.on)
    return view.stopped
      ? 'Captions stopped: this computer is too slow for live captions with this model.'
      : null;
  const s = view.speech;
  if (s.phase === 'failed') return `Captions: ${s.message}`;
  if (s.phase !== 'held') return null;
  if (s.reason === 'no-sound-input') return 'Captions: no sound input is chosen for the stream.';
  if (s.reason === 'no-model') return 'Captions are waiting for their model.';
  if (!s.slow) return 'Captions are resting: this computer is busy.';
  return s.slow.rests > 1
    ? `Captions are resting: this computer cannot keep up (${String(s.slow.rests)} times in a row).`
    : 'Captions are resting: this computer cannot keep up.';
}

/** Under Engine threads (cap-threads): when this computer has fewer logical processors than chosen, or null. */
export function threadsNote(view: CaptionsStatus): string | null {
  const p = view.processors;
  if (p >= view.timing.threads) return null;
  return p === 1
    ? 'This computer has 1 logical processor, so captions use 1 engine thread.'
    : `This computer has ${String(p)} logical processors, so captions use ${String(p)} engine threads.`;
}

/** How the model stands on this computer. */
export function downloadText(view: CaptionsStatus): string {
  const d = view.download;
  switch (d.phase) {
    case 'missing':
      return d.message ?? `The model (${megabytes(d.total)}) downloads once, when captions are turned on.`;
    case 'downloading':
      return `Downloading the model: ${String(Math.round(d.done / 1_000_000))} of ${megabytes(d.total)}.`;
    case 'ready':
      return 'The model is on this computer.';
    case 'failed':
      return d.message ?? 'The model could not be downloaded.';
  }
}

/* ---- a model per language and live timing (alpha.22) ---- */

export const LANGUAGE_NAMES: Readonly<Record<LanguageModelLanguage, string>> = Object.freeze({
  gu: 'Gujarati',
  hi: 'Hindi',
  en: 'English',
});

/** Which model hears a language, or what to do about it. */
export function languageModelText(model: LanguageModelView): string {
  if (model.message !== null) return model.message;
  const name = LANGUAGE_NAMES[model.language];
  switch (model.phase) {
    case 'general':
      return `The general model hears ${name}.`;
    case 'ready':
      return `${name}’s own model hears ${name} when the speaker’s language is ${name}. It is on this computer and checked.`;
    case 'checking':
      return 'Checking the file…';
    case 'missing':
      return `The ${name} model is not on this computer: import the model pack that holds it.`;
    case 'changed':
      return `The ${name} model’s file has changed since Drashti checked it, so captions do not use it.`;
    case 'unknown':
      return `The model chosen for ${name} is not one this copy of Drashti knows.`;
  }
}

export const STEP_NAMES: Readonly<Record<CaptionTiming['stepMs'], string>> = Object.freeze({
  1500: 'Every 1.5 seconds (standard)',
  1000: 'Every second (quicker; needs a faster computer)',
});

export const PAUSE_NAMES: Readonly<Record<CaptionTiming['pauseMs'], string>> = Object.freeze({
  700: 'A pause of 0.7 seconds (standard)',
  500: 'A pause of 0.5 seconds (quicker; may split a sentence)',
});

export const LONGEST_NAMES: Readonly<Record<CaptionTiming['longestMs'], string>> = Object.freeze({
  12000: '12 seconds (standard)',
  8000: '8 seconds',
  6000: '6 seconds (long sentences show sooner)',
});

export const SPEECH_LEVEL_NAMES: Readonly<Record<CaptionTiming['speech'], string>> = Object.freeze({
  standard: 'Standard',
  'quiet-room': 'Quiet room: hears softer speech',
  'noisy-hall': 'Noisy hall: needs louder speech',
});

export const THREAD_NAMES: Readonly<Record<CaptionTiming['threads'], string>> = Object.freeze({
  4: '4 (standard)',
  2: '2 (for a computer with two cores)',
  1: '1 (the lightest)',
});
