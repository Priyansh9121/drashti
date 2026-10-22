import type { ConversionJob } from '../../../shared/convert';
import { plural } from '../../../shared/text';

/*
 * A file Drashti converts, as the operator window says it (Session 50): "Converting…" from the moment it
 * waits until it is converted, on its row in Media, on a playlist's item, in Audio and in the import report.
 * Until then it cannot go live: the library marks it as a file Drashti cannot play, and the show refuses it.
 */

/** A conversion waiting or going on. */
export const jobBusy = (job: ConversionJob | undefined): job is ConversionJob =>
  job?.state === 'waiting' || job?.state === 'converting';

/** The newest job for a media item. */
export function jobFor(jobs: readonly ConversionJob[], mediaId: string): ConversionJob | undefined {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i]?.mediaId === mediaId) return jobs[i];
  return undefined;
}

/** The words while it converts: "Converting…", with how far once FFmpeg tells. */
export function convertingWords(job: ConversionJob): string {
  return job.state === 'converting' && job.progress !== null
    ? `Converting… ${String(Math.round(job.progress * 100))}%`
    : 'Converting…';
}

/** What is wrong with a media file, if anything: one Drashti cannot play says it is converting, while it is. */
export function mediaProblem(
  m: { missing: boolean; unplayable: string | null },
  job?: ConversionJob,
): string | null {
  if (m.missing) return 'File missing';
  if (m.unplayable !== null) return jobBusy(job) ? 'Converting…' : 'Can’t play';
  return null;
}

/**
 * The media item everything uses for this one: its converted copy once it is converted (in this window's
 * time), else itself. What an import made is added somewhere by it (Session 50: the copy, when the import's
 * own conversion finished first).
 */
export function copyFor(mediaId: string, jobs: readonly ConversionJob[]): string {
  const job = jobFor(jobs, mediaId);
  return job?.state === 'done' && job.convertedId !== null ? job.convertedId : mediaId;
}

/** A few names, and how many more: "A, B and C"; "A, B, C, D, E and 2 more". */
export function someNames(names: readonly string[], most = 5): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= most) return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return `${names.slice(0, most).join(', ')} and ${String(names.length - most)} more`;
}

/**
 * The import report's word on what Drashti converts by itself (Session 50): how many it is converting, and
 * what it converted. Null when there is nothing to say.
 */
export function convertedSummary(converting: number, converted: readonly string[]): string | null {
  const done = converted.length;
  if (converting > 0) {
    const many = converting + done > 1;
    return `Converting ${plural(converting, 'file')} Drashti cannot play as ${converting === 1 ? 'it is' : 'they are'}, one at a time${done > 0 ? ` (${String(done)} done: ${someNames(converted)})` : ''}: ${many ? 'each is' : 'it is'} used everywhere once it is done, and ${many ? 'the originals stay as they are' : 'the original stays as it is'}.`;
  }
  if (done === 0) return null;
  return `Converted ${plural(done, 'file')} Drashti could not play as ${done === 1 ? 'it was' : 'they were'}: ${someNames(converted)}. ${done === 1 ? 'The copy is used everywhere, and the original stays as it is' : 'The copies are used everywhere, and the originals stay as they are'}.`;
}
