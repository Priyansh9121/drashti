import { useEffect, useState } from 'react';
import type { CombineJob } from '../../../shared/video-copies';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ArrowDown, ArrowUp } from '../ui/icons';
import { Progress } from '../ui/Progress';
import { Truncate } from '../ui/Truncate';
import {
  addCombineToMenu,
  closeCombineVideos,
  moved,
  useCombineVideos,
  type CombineVideo,
} from './combine-videos';

/** Combine videos… (alpha.22): mounted once; its window opens from Media's right-click menu. */
export function CombineVideosDialog() {
  const videos = useCombineVideos((s) => s.videos);
  useEffect(() => addCombineToMenu(), []);
  return videos ? <Combine key={videos.map((v) => v.id).join(' ')} initial={videos} /> : null;
}

/** What a combine is doing, in plain words. */
function jobWords(job: CombineJob): string {
  if (job.state === 'done') return `Added “${job.name}” to Media.`;
  if (job.state === 'waiting') return job.note ?? `Waiting to combine “${job.name}”.`;
  if (job.state === 'preparing')
    return `Combining “${job.name}”… ${String(Math.round((job.progress ?? 0) * 100))}%`;
  if (job.state === 'stopped') return job.message ?? 'Stopped. Nothing was added to Media.';
  return job.message ?? 'The videos could not be combined. Check them, then Combine again.';
}

function Combine({ initial }: { initial: CombineVideo[] }) {
  const [order, setOrder] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [jobs, setJobs] = useState<CombineJob[]>([]);
  useEffect(() => {
    let wanted = true;
    const load = () => {
      void window.drashti.media
        .combineList()
        .then((all) => {
          if (wanted) setJobs(all);
        })
        .catch(() => {
          if (wanted) setMessage('The list of combines could not be read. Open Combine videos… again.');
        });
    };
    load();
    const timer = setInterval(load, 1000);
    return () => {
      wanted = false;
      clearInterval(timer);
    };
  }, []);
  const ids = order.map((v) => v.id);
  // The same videos in the same order already waiting or combining: not asked twice.
  const going = jobs.some(
    (job) =>
      (job.state === 'waiting' || job.state === 'preparing') && job.mediaIds.join(' ') === ids.join(' '),
  );
  const combine = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.drashti.media.combineVideos({ mediaIds: ids });
      if (!result.ok) setMessage(result.message);
      else setJobs((old) => [...old.filter((job) => job.id !== result.job.id), result.job]);
    } catch {
      setMessage('The videos could not be queued. Check them and free disk space, then Combine again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Combine videos"
      onClose={closeCombineVideos}
      testId="combine-videos"
      footer={
        <>
          <Button variant="primary" disabled={busy || going} onClick={() => void combine()}>
            Combine
          </Button>
          <Button onClick={closeCombineVideos}>Close</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          They play one after the other, in this order, as one new video added to Media. The originals are
          kept as they are. It waits until the show, stream and recording are idle.
        </p>
        <ol className="space-y-1" aria-label="Videos, in the order they play">
          {order.map((video, at) => (
            <li
              key={video.id}
              className="flex items-center gap-2 rounded border border-line px-2 py-1"
              data-testid="combine-videos-row"
            >
              <span className="w-5 shrink-0 text-right text-xs text-muted tabular-nums" aria-hidden="true">
                {at + 1}
              </span>
              <Truncate text={video.name} className="min-w-0 flex-1 text-sm" />
              <IconButton
                icon={ArrowUp}
                size="sm"
                label={`Move “${video.name}” up`}
                disabled={at === 0}
                onClick={() => setOrder((now) => moved(now, at, -1))}
              />
              <IconButton
                icon={ArrowDown}
                size="sm"
                label={`Move “${video.name}” down`}
                disabled={at === order.length - 1}
                onClick={() => setOrder((now) => moved(now, at, 1))}
              />
            </li>
          ))}
        </ol>
        {message && (
          <p role="alert" className="text-sm text-danger-fg">
            {message}
          </p>
        )}
        {jobs.length > 0 && (
          <ul className="space-y-2" aria-label="Combines">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="space-y-1 rounded border border-line p-2 text-sm"
                data-testid="combine-videos-job"
                data-state={job.state}
              >
                <p role="status" className={job.state === 'failed' ? 'text-danger-fg' : undefined}>
                  {jobWords(job)}
                </p>
                {job.state === 'preparing' && (
                  <Progress value={job.progress ?? 0} label={`Combining “${job.name}”`} />
                )}
                {(job.state === 'waiting' || job.state === 'preparing') && (
                  <Button size="sm" onClick={() => void window.drashti.media.stopCombine(job.id)}>
                    Stop
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
