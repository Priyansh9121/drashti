import { describe, expect, it } from 'vitest';
import {
  CAPTION_LONGEST_MS,
  CAPTION_PAUSES_MS,
  CAPTION_SPEECH_LEVELS,
  CAPTION_STEPS_MS,
  CAPTION_THREADS,
  DEFAULT_CAPTION_SETTINGS,
  DEFAULT_CAPTION_TIMING,
  type CaptionsStatus,
  type LanguageModelView,
} from '../../../shared/captions';
import {
  captionsStateText,
  captionsSwitchDisabled,
  downloadText,
  languageModelText,
  LONGEST_NAMES,
  megabytes,
  PAUSE_NAMES,
  SPEECH_LEVEL_NAMES,
  STEP_NAMES,
  THREAD_NAMES,
} from './captions-words';

/* The Live captions dialog's words (Part 10). */

const view = (over: Partial<CaptionsStatus>): CaptionsStatus => ({
  on: true,
  model: 'small',
  settings: DEFAULT_CAPTION_SETTINGS,
  download: { phase: 'ready', done: 487_601_967, total: 487_601_967, message: null },
  speech: { phase: 'listening', language: 'auto' },
  engine: true,
  engineProblem: null,
  trial: true,
  languageModels: [],
  timing: DEFAULT_CAPTION_TIMING,
  ...over,
});

describe('the Live captions dialog’s words (Part 10)', () => {
  it('say what the listening is doing, plainly, with what to do', () => {
    expect(captionsStateText(view({ on: false, speech: { phase: 'off' } }))).toBe('Off on this computer.');
    expect(captionsStateText(view({}))).toBe('Listening to the stream’s sound input.');
    expect(captionsStateText(view({ speech: { phase: 'held', reason: 'busy' } }))).toMatch(
      /^Resting: this computer is busy, and the show comes first\./,
    );
    expect(captionsStateText(view({ speech: { phase: 'held', reason: 'no-sound-input' } }))).toMatch(
      /No sound input is chosen for the stream/,
    );
    expect(captionsStateText(view({ engine: false }))).toBe('This copy of Drashti has no captions engine.');
    expect(
      captionsStateText(
        view({ engine: false, engineProblem: 'Live captions need macOS 13.3 or later on this Mac.' }),
      ),
    ).toBe('Live captions need macOS 13.3 or later on this Mac.');
    expect(captionsStateText(view({ speech: { phase: 'failed', message: 'Placeholder failure.' } }))).toBe(
      'Placeholder failure.',
    );
  });

  it('say how the model stands, in megabytes', () => {
    expect(megabytes(487_601_967)).toBe('488 MB');
    expect(
      downloadText(view({ download: { phase: 'missing', done: 0, total: 487_601_967, message: null } })),
    ).toBe('The model (488 MB) downloads once, when captions are turned on.');
    const paused = 'The model download waits until the stream and recording stop.';
    expect(
      downloadText(view({ download: { phase: 'missing', done: 0, total: 487_601_967, message: paused } })),
    ).toBe(paused);
    expect(
      downloadText(
        view({ download: { phase: 'downloading', done: 120_000_000, total: 487_601_967, message: null } }),
      ),
    ).toBe('Downloading the model: 120 of 488 MB.');
    expect(downloadText(view({}))).toBe('The model is on this computer.');
  });
});

describe('a model per language and live timing in the dialog (alpha.22)', () => {
  const model = (over: Partial<LanguageModelView>): LanguageModelView => ({
    language: 'gu',
    known: [],
    chosen: null,
    phase: 'general',
    message: null,
    ...over,
  });

  it('say which model hears each language, and what to do', () => {
    expect(languageModelText(model({}))).toBe('The general model hears Gujarati.');
    expect(languageModelText(model({ language: 'hi', chosen: 'placeholder-hi', phase: 'ready' }))).toBe(
      'Hindi’s own model hears Hindi when the speaker’s language is Hindi. It is on this computer and checked.',
    );
    expect(languageModelText(model({ phase: 'checking' }))).toBe('Checking the file…');
    expect(languageModelText(model({ phase: 'missing', chosen: 'placeholder-gu' }))).toBe(
      'The Gujarati model is not on this computer: import the model pack that holds it.',
    );
    expect(
      languageModelText(model({ phase: 'changed', chosen: 'placeholder-gu', message: 'Placeholder.' })),
    ).toBe('Placeholder.');
  });

  it('name every timing choice plainly, the timing captions always had first', () => {
    expect(CAPTION_STEPS_MS.map((v) => STEP_NAMES[v])).toEqual([
      'Every 1.5 seconds (standard)',
      'Every second (quicker; needs a faster computer)',
    ]);
    expect(CAPTION_PAUSES_MS.map((v) => PAUSE_NAMES[v])).toEqual([
      'A pause of 0.7 seconds (standard)',
      'A pause of 0.5 seconds (quicker; may split a sentence)',
    ]);
    expect(CAPTION_LONGEST_MS.map((v) => LONGEST_NAMES[v])).toEqual([
      '12 seconds (standard)',
      '8 seconds',
      '6 seconds (long sentences show sooner)',
    ]);
    expect(CAPTION_SPEECH_LEVELS.map((v) => SPEECH_LEVEL_NAMES[v])).toEqual([
      'Standard',
      'Quiet room: hears softer speech',
      'Noisy hall: needs louder speech',
    ]);
    expect(CAPTION_THREADS.map((v) => THREAD_NAMES[v])).toEqual([
      '4 (standard)',
      '2 (for a computer with two cores)',
      '1 (the lightest)',
    ]);
  });
});

describe('the dialog’s On switch (review S1)', () => {
  it('is greyed out only while off with no engine that can run: captions that are on can always be turned off', () => {
    expect(captionsSwitchDisabled(view({ on: false, engine: false }))).toBe(true);
    expect(captionsSwitchDisabled(view({ on: true, engine: false }))).toBe(false);
    expect(captionsSwitchDisabled(view({ on: false, engine: true }))).toBe(false);
    expect(captionsSwitchDisabled(view({ on: true, engine: true }))).toBe(false);
  });
});
