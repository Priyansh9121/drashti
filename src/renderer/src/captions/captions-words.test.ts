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
import type { SlowHold } from '../../../shared/speech';
import {
  captionsStateText,
  captionsStatusLine,
  captionsSwitchDisabled,
  downloadText,
  threadsNote,
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
  processors: 8,
  stopped: null,
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

/** Resting for slowness, as the whisper engine measured it (placeholder numbers). */
const slow = (over: Partial<SlowHold> = {}): CaptionsStatus =>
  view({
    speech: {
      phase: 'held',
      reason: 'busy',
      slow: { answerMs: 9_100, behindMs: 6_200, threads: 2, processors: 2, rests: 1, ...over },
    },
  });

describe('captions resting because this computer cannot keep up (cap-threads)', () => {
  it('the dialog says what was measured, plainly: the answer’s time or how far behind, and the threads', () => {
    const first = captionsStateText(slow());
    expect(first).toMatch(/^Resting: this computer heard too slowly for live captions/u);
    expect(first).toContain('an answer took 9.1 seconds, with 2 engine threads');
    expect(first).toMatch(/rest for a minute/u);
    expect(first).toMatch(/The show comes first\.$/u);
    // Held for falling behind (an answer more than 8 s behind the speaker).
    expect(captionsStateText(slow({ answerMs: 1_200, behindMs: 9_400 }))).toContain(
      'it fell 9.4 seconds behind the speaker, with 2 engine threads',
    );
    expect(captionsStateText(slow({ threads: 1, processors: 1 }))).toContain('with 1 engine thread)');
  });

  it('rests in a row: the dialog says this computer may be too slow for live captions with this model, and that a third rest stops them', () => {
    const again = captionsStateText(slow({ rests: 2 }));
    expect(again).toMatch(/^Resting again \(2 times in a row\)/u);
    expect(again).toMatch(/may be too slow for live captions with this model/u);
    expect(again).toContain('an answer took 9.1 seconds, with 2 engine threads');
    expect(again).toMatch(/after 3 rests in a row they stop\.$/u);
  });

  it('stopped after 3 rests (the owner: “Say so and stop”): off, too slow for live captions with this model, and for Gujarati or Hindi the IndicConformer pack', () => {
    const off = (language: 'gu' | 'hi' | 'en' | 'sa' | 'auto') =>
      view({
        on: false,
        speech: { phase: 'off' },
        settings: { ...DEFAULT_CAPTION_SETTINGS, language },
        stopped: {
          language,
          slow: { answerMs: 15_500, behindMs: 16_000, threads: 2, processors: 2, rests: 3 },
        },
      });
    const gu = captionsStateText(off('gu'));
    expect(gu).toMatch(/^Off: this computer is too slow for live captions with this model\./u);
    expect(gu).toContain(
      'They rested 3 times in a row (it fell 16.0 seconds behind the speaker, with 2 engine threads)',
    );
    expect(gu).toContain(
      'For Gujarati, import the Gujarati IndicConformer model pack (Help › Caption and Translation Models…) and choose it under Gujarati model: it keeps up on slower computers.',
    );
    expect(gu).toMatch(/Turn captions on to try again\.$/u);
    expect(captionsStateText(off('hi'))).toContain(
      'For Hindi, import the Hindi IndicConformer model pack (Help › Caption and Translation Models…) and choose it under Hindi model',
    );
    expect(captionsStateText(off('auto'))).toContain(
      'For Gujarati or Hindi, choose the speaker’s language, then import its IndicConformer model pack (Help › Caption and Translation Models…) and choose it under that language’s model: it keeps up on slower computers.',
    );
    for (const other of ['en', 'sa'] as const) {
      expect(captionsStateText(off(other))).toMatch(/^Off: this computer is too slow/u);
      expect(captionsStateText(off(other))).not.toMatch(/IndicConformer/u);
    }
    // The status bar says it too, while they are off for it (Live Captions… opens the dialog).
    expect(captionsStatusLine(off('gu'))).toBe(
      'Captions stopped: this computer is too slow for live captions with this model.',
    );
    // Off by the switch alone: nothing to say.
    expect(captionsStateText(view({ on: false, speech: { phase: 'off' } }))).toBe('Off on this computer.');
  });

  it('a rest the engine measured nothing for keeps today’s words', () => {
    expect(captionsStateText(view({ speech: { phase: 'held', reason: 'busy' } }))).toBe(
      'Resting: this computer is busy, and the show comes first. Captions try again by themselves in a minute.',
    );
  });

  it('the status bar says why captions that are on show nothing: never silence', () => {
    expect(captionsStatusLine(slow())).toBe('Captions are resting: this computer cannot keep up.');
    expect(captionsStatusLine(slow({ rests: 2 }))).toBe(
      'Captions are resting: this computer cannot keep up (2 times in a row).',
    );
    expect(captionsStatusLine(view({ speech: { phase: 'held', reason: 'busy' } }))).toBe(
      'Captions are resting: this computer is busy.',
    );
    expect(captionsStatusLine(view({ speech: { phase: 'held', reason: 'no-sound-input' } }))).toBe(
      'Captions: no sound input is chosen for the stream.',
    );
    expect(captionsStatusLine(view({ speech: { phase: 'held', reason: 'no-model' } }))).toBe(
      'Captions are waiting for their model.',
    );
    expect(captionsStatusLine(view({ speech: { phase: 'failed', message: 'Placeholder failure.' } }))).toBe(
      'Captions stopped: Placeholder failure.',
    );
  });

  it('Engine threads says when this computer has fewer logical processors than it asks for', () => {
    const at = (threads: 4 | 2 | 1, processors: number) =>
      threadsNote(view({ timing: { ...DEFAULT_CAPTION_TIMING, threads }, processors }));
    expect(at(4, 2)).toBe('This computer has 2 logical processors, so captions use 2 engine threads.');
    expect(at(2, 1)).toBe('This computer has 1 logical processor, so captions use 1 engine thread.');
    expect(at(4, 3)).toBe('This computer has 3 logical processors, so captions use 3 engine threads.');
    expect(at(4, 4)).toBeNull();
    expect(at(4, 16)).toBeNull();
    expect(at(2, 2)).toBeNull();
    expect(at(1, 2)).toBeNull();
  });

  it('and nothing while captions listen, start, are off, or cannot run here', () => {
    expect(captionsStatusLine(null)).toBeNull();
    expect(captionsStatusLine(view({}))).toBeNull();
    expect(captionsStatusLine(view({ speech: { phase: 'starting' } }))).toBeNull();
    expect(captionsStatusLine(view({ speech: { phase: 'off' } }))).toBeNull();
    expect(captionsStatusLine({ ...slow(), on: false })).toBeNull();
    expect(captionsStatusLine({ ...slow(), engine: false, on: false })).toBeNull();
  });
});
