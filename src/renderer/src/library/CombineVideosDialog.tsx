import { useEffect, useState } from 'react';
import { COMBINE_TRANSITION_MS, type CombineJob, type CombineTransition } from '../../../shared/video-copies';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select } from '../ui/Field';
import { ArrowDown, ArrowUp } from '../ui/icons';
import { Progress } from '../ui/Progress';
import { Checkbox } from '../ui/Toggle';
import { Truncate } from '../ui/Truncate';
import {
  addCombineToMenu,
  closeCombineVideos,
  combineJobWords,
  exportWords,
  moved,
  useCombineVideos,
  type CombineVideo,
} from './combine-videos';
import { setLibraryTab, useMedia } from './library-store';

/** Combine videos… (alpha.22): mounted once; its window opens from Media's right-click menu. */
export function CombineVideosDialog() {
  const videos = useCombineVideos((s) => s.videos);
  useEffect(() => addCombineToMenu(), []);
  return videos ? <Combine key={videos.map((v) => v.id).join(' ')} initial={videos} /> : null;
}

/** The transition's lengths offered: 0.5 to 3 s (COMBINE_TRANSITION_MS), by half seconds. */
const LENGTHS = [500, 1000, 1500, 2000, 2500, 3000] as const;

/** Show in Media: the window closed, Media open, and the new video the one chosen there. */
function showInMedia(mediaId: string): void {
  closeCombineVideos();
  setLibraryTab('media');
  useMedia.setState({ marked: [mediaId], anchorId: mediaId });
}

function Combine({ initial }: { initial: CombineVideo[] }) {
  const [order, setOrder] = useState(initial);
  const [transition, setTransition] = useState<CombineTransition>('dissolve');
  const [transitionMs, setTransitionMs] = useState<number>(COMBINE_TRANSITION_MS.usual);
  const [saveCopy, setSaveCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [jobs, setJobs] = useState<CombineJob[]>([]);
  // Export…'s words, by combine.
  const [exported, setExported] = useState<Record<string, string>>({});
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
      const result = await window.drashti.media.combineVideos({
        mediaIds: ids,
        transition,
        transitionMs,
        saveCopy,
      });
      if (!result.ok) setMessage(result.message);
      else if (result.job) {
        const job = result.job;
        setJobs((old) => [...old.filter((item) => item.id !== job.id), job]);
      }
    } catch {
      setMessage('The videos could not be queued. Check them and free disk space, then Combine again.');
    } finally {
      setBusy(false);
    }
  };
  const exportJob = async (id: string) => {
    try {
      const words = exportWords(await window.drashti.media.exportCombined(id));
      if (words) setExported((now) => ({ ...now, [id]: words }));
    } catch {
      setExported((now) => ({ ...now, [id]: 'The video could not be exported. Try Export… again.' }));
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
        {/* The owner, 24 Nov 2026: "transition between 2 merged videos". */}
        <div className="flex flex-wrap gap-3">
          <Field label="Transition">
            <Select value={transition} onChange={(e) => setTransition(e.target.value as CombineTransition)}>
              <option value="dissolve">Dissolve</option>
              <option value="fade-black">Fade through black</option>
              <option value="cut">Cut</option>
            </Select>
          </Field>
          {transition !== 'cut' && (
            <Field label="Length">
              <Select value={String(transitionMs)} onChange={(e) => setTransitionMs(Number(e.target.value))}>
                {LENGTHS.map((ms) => (
                  <option key={ms} value={String(ms)}>
                    {`${String(ms / 1000)} s`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {transition !== 'cut' && (
          <p className="text-xs text-muted">
            The same transition goes between each two. A video shorter than it is joined with a plain cut.
          </p>
        )}
        {/* The owner, 24 Nov 2026: "export button as well to download". */}
        <div>
          <Checkbox
            label="Also save a copy to a file"
            checked={saveCopy}
            onChange={(e) => setSaveCopy(e.target.checked)}
          />
        </div>
        {message && (
          <p role="alert" className="text-sm text-danger-fg">
            {message}
          </p>
        )}
        {jobs.length > 0 && (
          <ul className="space-y-2" aria-label="Combines">
            {jobs.map((job) => {
              const [line, ...more] = combineJobWords(job);
              return (
                <li
                  key={job.id}
                  className="space-y-1 rounded border border-line p-2 text-sm"
                  data-testid="combine-videos-job"
                  data-state={job.state}
                >
                  <p role="status" className={job.state === 'failed' ? 'text-danger-fg' : undefined}>
                    {line}
                  </p>
                  {more.map((words) => (
                    <p key={words} className="text-xs text-muted">
                      {words}
                    </p>
                  ))}
                  {exported[job.id] && <p className="text-xs text-muted">{exported[job.id]}</p>}
                  {job.state === 'preparing' && (
                    <Progress value={job.progress ?? 0} label={`Combining “${job.name}”`} />
                  )}
                  <div className="flex flex-wrap gap-2">
                    {(job.state === 'waiting' || job.state === 'preparing') && (
                      <Button size="sm" onClick={() => void window.drashti.media.stopCombine(job.id)}>
                        Stop
                      </Button>
                    )}
                    {job.state === 'done' && job.mediaId && (
                      <>
                        <Button size="sm" onClick={() => showInMedia(job.mediaId ?? '')}>
                          Show in Media
                        </Button>
                        <Button size="sm" onClick={() => void exportJob(job.id)}>
                          Export…
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
