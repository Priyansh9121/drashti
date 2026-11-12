import { describe, expect, it } from 'vitest';
import type { ConversionJob } from '../../../shared/convert';
import {
  convertible,
  convertingWords,
  copyFor,
  jobBusy,
  jobFor,
  mediaProblem,
  offeredForUndo,
} from './converting';

/* A file Drashti converts, as the operator window says it (Session 50). */

const job = (over: Partial<ConversionJob>): ConversionJob => ({
  id: 'job',
  mediaId: 'm-mkv',
  name: 'Placeholder katha.mkv',
  state: 'waiting',
  progress: null,
  note: null,
  message: null,
  convertedId: null,
  convertedName: null,
  conversionId: null,
  ...over,
});

describe('a file Drashti converts (Session 50)', () => {
  it('says “Converting…” from the moment it waits until it is converted, with how far once FFmpeg tells', () => {
    expect(convertingWords(job({}))).toBe('Converting…');
    expect(convertingWords(job({ note: 'Waits while the stream is on air or recording.' }))).toBe(
      'Converting…',
    );
    expect(convertingWords(job({ state: 'converting' }))).toBe('Converting…');
    expect(convertingWords(job({ state: 'converting', progress: 0.404 }))).toBe('Converting… 40%');
    expect(jobBusy(job({}))).toBe(true);
    expect(jobBusy(job({ state: 'converting' }))).toBe(true);
    for (const state of ['done', 'failed', 'cancelled'] as const) expect(jobBusy(job({ state }))).toBe(false);
    expect(jobBusy(undefined)).toBe(false);
  });

  it('cannot go live until then: a file Drashti cannot play says it is converting, not that it cannot play', () => {
    const mkv = { missing: false, unplayable: 'H.264 video with AC-3 sound (Matroska)' };
    expect(mediaProblem(mkv)).toBe('Can’t play');
    expect(mediaProblem(mkv, job({}))).toBe('Converting…');
    expect(mediaProblem(mkv, job({ state: 'failed' }))).toBe('Can’t play');
    expect(mediaProblem({ missing: true, unplayable: null }, job({}))).toBe('File missing');
    // A file that plays has no problem, converting or not.
    expect(mediaProblem({ missing: false, unplayable: null })).toBeNull();
  });

  it('finds a file’s newest job, and the copy everything uses once it is converted', () => {
    const jobs = [
      job({ id: 'a', state: 'failed' }),
      job({ id: 'b', state: 'done', convertedId: 'm-copy' }),
      job({ id: 'c', mediaId: 'm-wma' }),
    ];
    expect(jobFor(jobs, 'm-mkv')?.id).toBe('b');
    expect(jobFor(jobs, 'm-flac')).toBeUndefined();
    expect(copyFor('m-mkv', jobs)).toBe('m-copy');
    // Still converting, or never converted: the file itself.
    expect(copyFor('m-wma', jobs)).toBe('m-wma');
    expect(copyFor('m-flac', jobs)).toBe('m-flac');
  });

  // Section 9's review: a conversion Drashti did by itself (an import found the file) finished later, perhaps hours
  // after; Cmd+Z then undid it instead of the operator's own last change. Only one asked for is offered.
  it('offers for Undo a conversion the operator asked for, never one Drashti did by itself', () => {
    const done = { state: 'done' as const, conversionId: 'cv1' };
    expect(offeredForUndo(job(done))).toBe(true);
    expect(offeredForUndo(job({ ...done, byItself: true }))).toBe(false);
    expect(offeredForUndo(job({ state: 'converting', conversionId: null }))).toBe(false);
    expect(offeredForUndo(job({ state: 'done', conversionId: null }))).toBe(false);
  });
});

describe('what Media offers to convert (question 36)', () => {
  const file = (over: Partial<Parameters<typeof convertible>[0]> = {}) => ({
    missing: false,
    unplayable: null,
    format: 'HEVC (H.265) video (QuickTime)',
    convertedTo: null,
    ...over,
  });

  it('HEVC only once this computer is known not to play it: never while that is not known yet, nor where it plays', () => {
    expect(convertible(file(), false)).toBe(true);
    expect(convertible(file(), null)).toBe(false);
    expect(convertible(file(), true)).toBe(false);
  });

  it('a file Drashti cannot play whatever the answer; never one missing, converted already, or that plays', () => {
    for (const plays of [true, false, null]) {
      expect(convertible(file({ format: 'AVI video', unplayable: 'AVI video' }), plays)).toBe(true);
      expect(convertible(file({ missing: true }), plays)).toBe(false);
      expect(convertible(file({ convertedTo: 'Placeholder phone.mp4' }), plays)).toBe(false);
      expect(convertible(file({ format: 'H.264 video (MP4)' }), plays)).toBe(false);
    }
  });
});
