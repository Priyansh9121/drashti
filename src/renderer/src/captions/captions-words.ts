import type {
  CaptionsStatus,
  CaptionTiming,
  LanguageModelLanguage,
  LanguageModelView,
} from '../../../shared/captions';

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
  if (!view.on) return 'Off on this computer.';
  const s = view.speech;
  switch (s.phase) {
    case 'off':
      return 'On: captions start when the screens are ready.';
    case 'starting':
      return 'Starting…';
    case 'listening':
      return 'Listening to the stream’s sound input.';
    case 'held':
      if (s.reason === 'busy')
        return 'Resting: this computer is busy, and the show comes first. Captions try again by themselves in a minute.';
      if (s.reason === 'no-sound-input')
        return 'No sound input is chosen for the stream: choose one in the stream’s settings, and captions start.';
      return 'Waiting for the model.';
    case 'failed':
      return s.message;
  }
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
