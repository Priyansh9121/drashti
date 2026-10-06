import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { openMarkers } from '../markers/MarkersDialog';
import type { MediaSummary } from '../../../shared/playlists';
import { startDrag } from '../playlists/drag';
import { MissingBadge } from '../ui/Badge';
import type { Icon } from '../ui/icons';
import { Bookmark, Film, Image, Music, Wand2, X } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
import type { ConversionJob } from '../../../shared/convert';
import { Button, IconButton } from '../ui/Button';
import { Progress } from '../ui/Progress';
import {
  cancelConversion,
  connectConversions,
  convert,
  convertible,
  jobFor,
  useConvert,
} from './convert-store';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { layoutRows, visibleRows } from '../ui/virtual';
import { clickMedia, loadMedia, useMedia } from './library-store';

const ROW_HEIGHT = 48;
const MARGIN = 600;

export const mediaKindLabel = { image: 'Picture', video: 'Video', audio: 'Audio' } as const;
export const mediaKindIcon: Record<keyof typeof mediaKindLabel, Icon> = {
  image: Image,
  video: Film,
  audio: Music,
};

/** A conversion waiting or going on. */
const jobBusy = (job: ConversionJob | undefined) => job?.state === 'waiting' || job?.state === 'converting';

/** What is wrong with a media file, if anything. */
export function mediaProblem(m: { missing: boolean; unplayable: string | null }): string | null {
  if (m.missing) return 'File missing';
  if (m.unplayable !== null) return 'Can’t play';
  return null;
}

/** Convert (Try again after a failure), or Cancel while it waits or converts, at the end of a row. */
function ConvertControl({ m, job }: { m: MediaSummary; job: ConversionJob | undefined }) {
  if (job && jobBusy(job))
    return (
      <IconButton
        icon={X}
        size="sm"
        label={`Cancel converting ${m.name}`}
        onClick={() => void cancelConversion(job.id)}
      />
    );
  if (!convertible(m)) return null;
  return (
    <Button
      size="sm"
      icon={Wand2}
      title={
        job?.state === 'failed' ? (job.message ?? undefined) : `Convert ${m.name} to a file Drashti plays`
      }
      data-testid="convert-one"
      onClick={() => void convert([m.id])}
    >
      {job?.state === 'failed' ? 'Try again' : 'Convert'}
    </Button>
  );
}

/** A row's second line: what the file is, or how converting it is going, or what it became. */
function MediaNote({ m, job }: { m: MediaSummary; job: ConversionJob | undefined }) {
  const line = 'block truncate text-xs';
  if (m.convertedTo !== null)
    return (
      <span
        className={`${line} text-muted`}
        title={`Converted: everything that used it now uses ${m.convertedTo}`}
        data-testid="media-note"
      >
        Converted to .{m.convertedTo.split('.').pop()}
      </span>
    );
  if (job?.state === 'converting' && job.progress !== null)
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted" data-testid="media-note">
        <Progress
          value={job.progress}
          label=""
          decorative
          className="w-12 shrink-0"
          data-testid="convert-progress"
        />
        <span className="truncate tabular-nums">Converting… {Math.round(job.progress * 100)}%</span>
      </span>
    );
  if (job && jobBusy(job))
    return (
      <span className={`${line} text-muted`} title={job.note ?? undefined} data-testid="media-note">
        Waiting to convert
      </span>
    );
  if (job?.state === 'failed')
    return (
      <span className={`${line} text-danger-fg`} title={job.message ?? undefined} data-testid="media-note">
        {job.message ?? 'Could not convert it'}
      </span>
    );
  if (convertible(m))
    return (
      <span
        className={`${line} text-warning-fg`}
        title={m.unplayable ?? `${m.format ?? 'HEVC video'}: this computer cannot play it`}
        data-testid="media-note"
      >
        {mediaKindLabel[m.kind]} · can’t play as it is
      </span>
    );
  return (
    <span className={`${line} text-muted`} data-testid="media-note">
      {mediaKindLabel[m.kind]}
    </span>
  );
}

const MediaRow = memo(function MediaRow({
  m,
  marked,
  platform,
  job,
}: {
  m: MediaSummary;
  marked: boolean;
  platform: string;
  job: ConversionJob | undefined;
}) {
  const KindIcon = mediaKindIcon[m.kind];
  return (
    <div
      className={`${rowClass({ marked })} flex h-full items-center gap-1.5 pr-1.5`}
      data-testid="media-row"
    >
      <button
        type="button"
        draggable
        data-testid="media-item"
        data-marked={marked ? 'true' : undefined}
        aria-pressed={marked}
        onClick={(e) => {
          clickMedia(m.id, { toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey, range: e.shiftKey });
        }}
        onDragStart={(e) => {
          const { marked: now, media } = useMedia.getState();
          const ids = now.includes(m.id) ? media.filter((x) => now.includes(x.id)).map((x) => x.id) : [m.id];
          if (!now.includes(m.id)) clickMedia(m.id, { toggle: false, range: false });
          startDrag(e, 'media', ids);
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2.5 text-left"
      >
        <KindIcon size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <Truncate text={m.name} className="text-sm" />
          <MediaNote m={m} job={job} />
        </span>
        {m.missing && <MissingBadge />}
      </button>
      <ConvertControl m={m} job={job} />
      {(m.kind === 'video' || m.kind === 'audio') && !m.missing && m.unplayable === null && (
        <IconButton
          icon={Bookmark}
          label={`Start, end and markers of ${m.name}`}
          size="sm"
          data-testid="media-markers"
          onClick={() => {
            openMarkers(m);
          }}
        />
      )}
    </div>
  );
});

/** Every media file in the library, to drag into a playlist. */
export function MediaList({ platform }: { platform: string }) {
  const media = useMedia((s) => s.media);
  const loaded = useMedia((s) => s.loaded);
  const marked = useMedia((s) => s.marked);
  const listRef = useRef<HTMLUListElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  const layout = useMemo(() => layoutRows(media.map(() => ROW_HEIGHT)), [media]);
  const { start, end } = visibleRows(layout, view.top, view.height, MARGIN);
  const markedSet = new Set(marked);
  const jobs = useConvert((s) => s.jobs);
  const convertError = useConvert((s) => s.error);
  const toConvert = media.filter((m) => convertible(m) && !jobBusy(jobFor(jobs, m.id)));
  const going = jobs.filter(jobBusy);

  useEffect(() => {
    void loadMedia();
    connectConversions();
  }, []);
  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const observer = new ResizeObserver(() => {
      setView({ top: ul.scrollTop, height: ul.clientHeight });
    });
    observer.observe(ul);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {(toConvert.length > 0 || going.length > 0 || convertError) && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs"
          data-testid="convert-bar"
        >
          <span className="min-w-0 flex-1 text-muted" aria-live="polite">
            {convertError ??
              (going.length > 0
                ? `Converting ${going.length === 1 ? '1 file' : `${going.length} files`}, one at a time${going[0]?.note ? `. ${going[0].note}` : ''}`
                : `${toConvert.length === 1 ? '1 file' : `${toConvert.length} files`} Drashti cannot play.`)}
          </span>
          {toConvert.length > 0 && (
            <Button
              size="sm"
              icon={Wand2}
              data-testid="convert-all"
              onClick={() => void convert(toConvert.map((m) => m.id))}
            >
              Convert all
            </Button>
          )}
          {going.length > 1 && (
            <Button size="sm" onClick={() => void cancelConversion(null)}>
              Cancel all
            </Button>
          )}
        </div>
      )}
      <ul
        ref={listRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        data-testid="media-list"
        data-count={media.length}
        onScroll={(e) => {
          setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
        }}
      >
        {media.slice(start, end).map((m, k) => {
          const i = start + k;
          return (
            <li
              key={m.id}
              style={{ position: 'absolute', top: layout.offsets[i], left: 8, right: 8, height: ROW_HEIGHT }}
              className="pb-1"
              aria-setsize={media.length}
              aria-posinset={i + 1}
            >
              <MediaRow m={m} marked={markedSet.has(m.id)} platform={platform} job={jobFor(jobs, m.id)} />
            </li>
          );
        })}
        <li aria-hidden="true" style={{ position: 'absolute', top: layout.total, height: 12, width: 1 }} />
      </ul>
      {loaded && media.length === 0 && (
        <EmptyState icon={Image} title="No media yet" compact className="absolute inset-x-0 top-0">
          Import pictures, videos or sound, or presentations that use them.
        </EmptyState>
      )}
    </div>
  );
}
