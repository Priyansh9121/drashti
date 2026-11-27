import { useEffect, useState } from 'react';
import type { ClipExportJob, ClipExportRequest } from '../../../shared/video-copies';
import { JOINED_PARTS_ORIGINAL, clipPartsSummary, type ClipPart } from '../../../shared/clip-parts';
import { Button } from '../ui/Button';
import { Field, Select } from '../ui/Field';
import { Checkbox } from '../ui/Toggle';

/**
 * One range supplied by the editor in source time, or (alpha.24) two or more parts joined into one clip, in time
 * order, from the original picture and sound. Export is independent of closing that editor.
 */
export function ClipExportPanel({
  mediaId,
  startMs,
  endMs,
  revision,
  dirty = false,
  ready = true,
  parts,
  problem = null,
}: {
  mediaId: string;
  startMs: number;
  endMs: number | null;
  revision: number;
  dirty?: boolean;
  ready?: boolean;
  /** Two or more parts, checked and in time order (shared/clip-parts.ts): one clip of them all. */
  parts?: readonly ClipPart[];
  /** Why the editor's times cannot be exported now, in its words (a time not typed, an overlap). */
  problem?: string | null;
}) {
  const [frame, setFrame] = useState<ClipExportRequest['frame']>('edited');
  const [shape, setShape] = useState<ClipExportRequest['shape']>('source');
  const [container, setContainer] = useState<ClipExportRequest['container']>('mp4');
  const [add, setAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ClipExportJob[]>([]);
  useEffect(() => {
    let wanted = true;
    const load = () => {
      void window.drashti.media
        .clipExports()
        .then((all) => {
          if (wanted) setJobs(all.filter((job) => job.mediaId === mediaId));
        })
        .catch(() => {
          if (wanted) setMessage('The export list could not be read. Open Edit Video… again.');
        });
    };
    load();
    const timer = setInterval(load, 1000);
    return () => {
      wanted = false;
      clearInterval(timer);
    };
  }, [mediaId]);
  const joined = parts !== undefined && parts.length >= 2 ? parts : null;
  // Saved edits cover Start and End only: joined parts come from the original.
  const joinedEdited = joined !== null && frame === 'edited';
  const needsSave = !joined && frame === 'edited' && (dirty || !ready);
  const exportClip = async () => {
    if (endMs === null || endMs <= startMs || needsSave || joinedEdited || problem !== null) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.drashti.media.clipExport({
        mediaId,
        ...(joined
          ? {
              startMs: joined[0]?.startMs ?? startMs,
              endMs: joined[joined.length - 1]?.endMs ?? endMs,
              parts: joined.map((part) => ({ startMs: part.startMs, endMs: part.endMs })),
            }
          : { startMs, endMs }),
        frame,
        shape,
        container,
        addToLibrary: add,
        revision: frame === 'edited' ? revision : null,
      });
      if (!result.ok) setMessage(result.message);
      else if (result.job) {
        const job = result.job;
        setJobs((old) => [...old.filter((item) => item.id !== job.id), job]);
      }
    } catch {
      setMessage('The clip could not be queued. Check the video and free space, then try Export again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Export a video clip" className="space-y-3" data-testid="video-clip-export">
      <p className="text-xs text-muted">
        Export saves the selected start and end as a new file. It waits until the show, stream and recording
        are idle. The original is kept.
      </p>
      <div className="flex flex-wrap gap-3">
        <Field label="Picture and sound">
          <Select value={frame} onChange={(e) => setFrame(e.target.value as ClipExportRequest['frame'])}>
            <option value="edited">Saved edits</option>
            <option value="original">Original</option>
          </Select>
        </Field>
        <Field label="Clip shape">
          <Select value={shape} onChange={(e) => setShape(e.target.value as ClipExportRequest['shape'])}>
            <option value="source">As the video</option>
            <option value="vertical">Vertical 9:16</option>
          </Select>
        </Field>
        <Field label="File format">
          <Select
            value={container}
            onChange={(e) => setContainer(e.target.value as ClipExportRequest['container'])}
          >
            <option value="mp4">MP4 for sharing</option>
            <option value="webm">WebM, keeps transparency</option>
          </Select>
        </Field>
      </div>
      {shape === 'vertical' && (
        <p className="text-xs text-muted">
          Vertical keeps the middle of the picture, filling a 9:16 frame without stretching.
        </p>
      )}
      {/* A line of its own: inline, it ran right up to Export clip… with no gap (alpha.21). */}
      <div>
        <Checkbox
          label="Also add the clip to Media"
          checked={add}
          onChange={(e) => setAdd(e.target.checked)}
        />
      </div>
      {joined && !problem && (
        <p className="text-xs text-muted" role="status" data-testid="clip-parts-export">
          {clipPartsSummary(joined)}
        </p>
      )}
      {joinedEdited && <p className="text-xs text-muted">{JOINED_PARTS_ORIGINAL}</p>}
      {problem && <p className="text-xs text-danger-fg">{problem}</p>}
      {needsSave && (
        <p className="text-xs text-muted">
          Save the edits and wait for preparation before exporting the edited clip.
        </p>
      )}
      {endMs === null && (
        <p className="text-xs text-muted">
          Wait for the video’s length or choose an end time before exporting.
        </p>
      )}
      <Button
        type="button"
        onClick={() => {
          void exportClip();
        }}
        disabled={busy || needsSave || joinedEdited || problem !== null || endMs === null || endMs <= startMs}
      >
        Export clip…
      </Button>
      {message && (
        <p role="alert" className="text-sm text-danger-fg">
          {message}
        </p>
      )}
      <ul className="space-y-2" aria-label="Clip exports">
        {jobs.map((job) => (
          <li
            key={job.id}
            className="space-y-1 rounded border border-line p-2 text-sm"
            data-testid="clip-export-job"
            data-state={job.state}
          >
            <p role="status">
              {job.state === 'done'
                ? `Saved “${job.name}”${job.added ? ' and added to Media' : ''}.`
                : job.state === 'waiting'
                  ? (job.note ?? `Waiting to export “${job.name}”.`)
                  : job.state === 'preparing'
                    ? `Exporting “${job.name}”… ${String(Math.round((job.progress ?? 0) * 100))}%`
                    : (job.message ?? 'The export was stopped. Choose Export clip to start again.')}
            </p>
            {job.state === 'done' && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void window.drashti.media.showClipExport(job.id);
                }}
              >
                Show the file
              </Button>
            )}
            {(job.state === 'waiting' || job.state === 'preparing') && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void window.drashti.media.stopClipExport(job.id);
                }}
              >
                Stop export
              </Button>
            )}
            {job.state === 'done' && job.message && <p className="text-xs text-muted">{job.message}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
