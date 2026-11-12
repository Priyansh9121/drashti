import { create } from 'zustand';
import type { ConversionJob } from '../../../shared/convert';
import { offeredForUndo } from './converting';
import { showImportNotice } from './import-notices';
import { pushRemoval } from './undo';

/*
 * Converting media Drashti cannot play, as the operator window sees it: the
 * jobs and their progress, what can be converted, and Undo for each
 * conversion that finished.
 */

// The newest job for a media item, and what can be converted (Session 50: in converting.ts, with what a converting
// file says).
export { convertible, jobFor } from './converting';

interface ConvertStore {
  jobs: ConversionJob[];
  error: string | null;
  /**
   * Whether this computer plays HEVC video (most Macs do; Windows needs Microsoft's HEVC extension), as the main
   * process says: null until it knows. Question 36: this window never asks Chromium itself, which would hold it until
   * the GPU process has said which video decoders it has (about 15 s on CI's Mac late in a run).
   */
  playsHevc: boolean | null;
}

export const useConvert = create<ConvertStore>(() => ({ jobs: [], error: null, playsHevc: null }));

const undoable = new Set<string>();
const failureNotices = new Set<string>();
let connected = false;

function accept(jobs: ConversionJob[]): void {
  useConvert.setState({ jobs });
  // Each conversion the operator asked for that finishes can be undone (the original used again where it was); one
  // Drashti did by itself is not offered (Session 50).
  for (const job of jobs) {
    if (job.byItself && job.state === 'failed' && !failureNotices.has(job.id)) {
      failureNotices.add(job.id);
      showImportNotice(
        `Couldn’t convert “${job.name}”. ${job.message ?? 'Check the file and import it again.'}`,
        job.retryable ? () => retryConversion(job.id) : undefined,
      );
    }
    if (!job.conversionId || undoable.has(job.conversionId)) continue;
    if (!offeredForUndo(job)) {
      if (job.state === 'done') undoable.add(job.conversionId);
      continue;
    }
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
  // Whether this computer plays HEVC: known now, or told once it is (a moment after the start).
  window.drashti.media.onPlaysHevc((playsHevc) => {
    useConvert.setState({ playsHevc });
  });
  void window.drashti.media.playsHevc().then((playsHevc) => {
    if (playsHevc !== null) useConvert.setState({ playsHevc });
  });
  void window.drashti.media.conversions().then((jobs) => {
    // Conversions already finished before this window opened are not offered for Undo here.
    for (const j of jobs) if (j.conversionId) undoable.add(j.conversionId);
    accept(jobs);
  });
}

export async function convert(mediaIds: string[]): Promise<void> {
  const result = await window.drashti.media.convert(mediaIds);
  useConvert.setState(result.ok ? { jobs: result.jobs, error: null } : { error: result.message });
}

async function retryConversion(jobId: string): Promise<void> {
  const result = await window.drashti.media.retryConversion(jobId);
  if (!result.ok) showImportNotice(result.message);
}

export async function cancelConversion(jobId: string | null): Promise<void> {
  const result = await window.drashti.media.cancelConversion(jobId);
  if (result.ok) useConvert.setState({ jobs: result.jobs });
}
