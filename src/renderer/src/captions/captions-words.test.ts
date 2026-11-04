import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsStatus } from '../../../shared/captions';
import { captionsStateText, downloadText, megabytes } from './captions-words';

/* The Live captions dialog's words (Part 10). */

const view = (over: Partial<CaptionsStatus>): CaptionsStatus => ({
  on: true,
  model: 'small',
  settings: DEFAULT_CAPTION_SETTINGS,
  download: { phase: 'ready', done: 487_601_967, total: 487_601_967, message: null },
  speech: { phase: 'listening', language: 'auto' },
  engine: true,
  trial: true,
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
    expect(captionsStateText(view({ speech: { phase: 'failed', message: 'Placeholder failure.' } }))).toBe(
      'Placeholder failure.',
    );
  });

  it('say how the model stands, in megabytes', () => {
    expect(megabytes(487_601_967)).toBe('488 MB');
    expect(
      downloadText(view({ download: { phase: 'missing', done: 0, total: 487_601_967, message: null } })),
    ).toBe('The model (488 MB) downloads once, when captions are turned on.');
    expect(
      downloadText(
        view({ download: { phase: 'downloading', done: 120_000_000, total: 487_601_967, message: null } }),
      ),
    ).toBe('Downloading the model: 120 of 488 MB.');
    expect(downloadText(view({}))).toBe('The model is on this computer.');
  });
});
