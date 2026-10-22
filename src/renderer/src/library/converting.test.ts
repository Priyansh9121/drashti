import { describe, expect, it } from 'vitest';
import type { ConversionJob } from '../../../shared/convert';
import {
  convertedSummary,
  convertingWords,
  copyFor,
  jobBusy,
  jobFor,
  mediaProblem,
  offeredForUndo,
  someNames,
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

  it('sums up in the import report what Drashti converts by itself: converting, then what it converted', () => {
    expect(convertedSummary(0, [])).toBeNull();
    expect(convertedSummary(2, [])).toBe(
      'Converting 2 files Drashti cannot play as they are, one at a time: each is used everywhere once it is done, and the originals stay as they are.',
    );
    expect(convertedSummary(1, [])).toBe(
      'Converting 1 file Drashti cannot play as it is, one at a time: it is used everywhere once it is done, and the original stays as it is.',
    );
    expect(convertedSummary(1, ['Placeholder katha.mp4'])).toBe(
      'Converting 1 file Drashti cannot play as it is, one at a time (1 done: Placeholder katha.mp4): each is used everywhere once it is done, and the originals stay as they are.',
    );
    expect(convertedSummary(0, ['Placeholder katha.mp4', 'Placeholder bhajan.m4a'])).toBe(
      'Converted 2 files Drashti could not play as they were: Placeholder katha.mp4 and Placeholder bhajan.m4a. The copies are used everywhere, and the originals stay as they are.',
    );
    expect(convertedSummary(0, ['Placeholder katha.mp4'])).toBe(
      'Converted 1 file Drashti could not play as it was: Placeholder katha.mp4. The copy is used everywhere, and the original stays as it is.',
    );
    expect(someNames(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('A, B, C, D, E and 2 more');
    expect(someNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(someNames(['A'])).toBe('A');
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
