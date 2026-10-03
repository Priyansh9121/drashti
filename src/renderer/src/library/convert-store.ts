import { create } from 'zustand';
import type { ConversionJob } from '../../../shared/convert';
import { HEVC_TYPE, isHevc } from '../../../shared/convert';
import type { MediaSummary } from '../../../shared/playlists';
import { pushRemoval } from './undo';

/*
 * Converting media Drashti cannot play, as the operator window sees it: the
 * jobs and their progress, what can be converted, and Undo for each
 * conversion that finished.
 */

interface ConvertStore {
  jobs: ConversionJob[];
  error: string | null;
}

export const useConvert = create<ConvertStore>(() => ({ jobs: [], error: null }));

/** Whether this computer plays HEVC video (most Macs do; Windows needs Microsoft's HEVC extension). */
let hevc: boolean | null = null;
export function playsHevc(): boolean {
  if (hevc === null) {
    try {
      hevc = document.createElement('video').canPlayType(HEVC_TYPE) !== '';
    } catch {
      hevc = false;
    }
  }
  return hevc;
}

/** A file Drashti can convert: one it cannot play (HEVC only where this computer cannot), not yet converted. */
export function convertible(
  m: Pick<MediaSummary, 'missing' | 'unplayable' | 'format' | 'convertedTo'>,
): boolean {
  if (m.missing || m.convertedTo !== null) return false;
  return m.unplayable !== null || (isHevc(m.format) && !playsHevc());
}

const undoable = new Set<string>();
let connected = false;

function accept(jobs: ConversionJob[]): void {
  useConvert.setState({ jobs });
  // Each conversion that finishes can be undone (the original used again where it was).
  for (const job of jobs) {
    if (job.state !== 'done' || !job.conversionId || undoable.has(job.conversionId)) continue;
    undoable.add(job.conversionId);
    const conversionId = job.conversionId;
    pushRemoval({
      text: `Converted “${job.name}”`,
      restore: async () => {
        await window.drashti.media.undoConversion(conversionId);
      },
    });
  }
}

export function connectConversions(): void {
  if (connected) return;
  connected = true;
  window.drashti.media.onConversions(accept);
  void window.drashti.media.conversions().then((jobs) => {
    // Conversions already finished before this window opened are not offered for Undo here.
    for (const j of jobs) if (j.conversionId) undoable.add(j.conversionId);
    useConvert.setState({ jobs });
  });
}

export async function convert(mediaIds: string[]): Promise<void> {
  const result = await window.drashti.media.convert(mediaIds);
  useConvert.setState(result.ok ? { jobs: result.jobs, error: null } : { error: result.message });
}

export async function cancelConversion(jobId: string | null): Promise<void> {
  const result = await window.drashti.media.cancelConversion(jobId);
  if (result.ok) useConvert.setState({ jobs: result.jobs });
}

/** The newest job for a media item. */
export function jobFor(jobs: readonly ConversionJob[], mediaId: string): ConversionJob | undefined {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i]?.mediaId === mediaId) return jobs[i];
  return undefined;
}
