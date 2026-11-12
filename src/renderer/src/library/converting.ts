import type { ConversionJob } from '../../../shared/convert';
import { isHevc } from '../../../shared/convert';
import type { MediaSummary } from '../../../shared/playlists';

/*
 * A file Drashti converts, as the operator window says it (Session 50): "Converting…" from the moment it
 * waits until it is converted, on its row in Media, on a playlist's item and in Audio.
 * Until then it cannot go live: the library marks it as a file Drashti cannot play, and the show refuses it.
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
  if (jobBusy(job) && (m.unplayable !== null || job.maxHeight !== undefined)) return 'Converting…';
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
