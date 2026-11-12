import type { ConversionJob } from '../../../shared/convert';
import { isHevc } from '../../../shared/convert';
import type { MediaSummary } from '../../../shared/playlists';

/*
 * The operator window shows when a file is waiting or converting, on its row in Media, on a playlist's
 * item and in Audio. A playable linked video remains available while its smaller copy is made.
 */

/**
 * A file Drashti can convert: one it cannot play, not yet converted. HEVC only once this computer is known not to play
 * it (`playsHevc` false: Windows without Microsoft's HEVC extension). Question 36: until Drashti knows, a moment after
 * the start (null), HEVC is taken as playing, as an import takes it: never said unplayable, never offered.
 */
export function convertible(
  m: Pick<MediaSummary, 'missing' | 'unplayable' | 'format' | 'convertedTo'>,
  playsHevc: boolean | null,
): boolean {
  if (m.missing || m.convertedTo !== null) return false;
  return m.unplayable !== null || (isHevc(m.format) && playsHevc === false);
}

/** A conversion waiting or going on. */
export const jobBusy = (
  job: ConversionJob | undefined,
): job is ConversionJob & { state: 'waiting' | 'converting' } =>
  job?.state === 'waiting' || job?.state === 'converting';

/**
 * A finished conversion the operator asked for, offered for Undo (Session 50: one Drashti did by itself finishes
 * when it will, perhaps long after, and Cmd+Z would undo it instead of the operator's own last change).
 */
export const offeredForUndo = (job: ConversionJob): boolean =>
  job.state === 'done' && job.conversionId !== null && job.byItself !== true;

/** The newest job for a media item. */
export function jobFor(jobs: readonly ConversionJob[], mediaId: string): ConversionJob | undefined {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i]?.mediaId === mediaId) return jobs[i];
  return undefined;
}

/** The conversion label, used while a job waits and runs. */
export function conversionLabel(job: ConversionJob): string {
  return job.maxHeight === undefined ? 'Converting…' : `Making a ${String(job.maxHeight)}p copy…`;
}

/** The words while it converts, with how far once FFmpeg tells. */
export function convertingWords(job: ConversionJob): string {
  const label = conversionLabel(job);
  return job.state === 'converting' && job.progress !== null
    ? `${label} ${String(Math.round(job.progress * 100))}%`
    : label;
}

/** What is wrong with a media file, if anything: one Drashti cannot play says it is converting, while it is. */
export function mediaProblem(
  m: { missing: boolean; unplayable: string | null },
  job?: ConversionJob,
): string | null {
  if (m.missing) return 'File missing';
  if (jobBusy(job) && (m.unplayable !== null || job.maxHeight !== undefined)) return conversionLabel(job);
  return m.unplayable === null ? null : 'Can’t play';
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
