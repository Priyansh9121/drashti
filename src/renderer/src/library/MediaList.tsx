import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { openMarkers } from '../markers/MarkersDialog';
import type { MediaSummary } from '../../../shared/playlists';
import { ADD_LINE_HEIGHT, AddToPlaylistButton, rowMenu, usePlaylistOpen } from '../playlists/AddToPlaylist';
import { afterDrag, startDrag } from '../playlists/drag';
import { actionFor, LIBRARY_KEYMAP } from '../../../shared/keymap';
import { RowDelete } from '../ui/RowDelete';
import { requestMediaRemoval } from './media-removal';
import { Badge, MissingBadge, UnplayableBadge } from '../ui/Badge';
import type { Icon } from '../ui/icons';
import { Bookmark, Film, Image, Music, SlidersHorizontal, Wand2, X } from '../ui/icons';
import { openPictureEditor } from '../pictures/PictureEditor';
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
import { convertingWords, jobBusy } from './converting';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { layoutRows, visibleRows } from '../ui/virtual';
import {
  BoxOverlay,
  boxChoice,
  ChosenBar,
  isSelectAll,
  laidOutTouching,
  useBoxSelect,
} from '../ui/select-many';
import { clickMedia, loadMedia, setDropOnly, shownMedia, useMedia } from './library-store';
import { VideoInputsSection } from '../video-inputs/VideoInputsSection';

const ROW_HEIGHT = 48;
const MARGIN = 600;

export const mediaKindLabel = { image: 'Picture', video: 'Video', audio: 'Audio' } as const;
export const mediaKindIcon: Record<keyof typeof mediaKindLabel, Icon> = {
  image: Image,
  video: Film,
  audio: Music,
};

/** What is wrong with a media file, if anything (Session 50: “Converting…” while Drashti converts it). */
export { mediaProblem } from './converting';

/**
 * “Can’t play”, or “Converting…” while Drashti converts it (Session 50), on a playlist's item and the slides'
 * view of it: either way it cannot go live yet.
 */
export function CannotPlayBadge({ mediaId }: { mediaId: string }) {
  const busy = useConvert((s) => jobBusy(jobFor(s.jobs, mediaId)));
  useEffect(() => {
    connectConversions();
  }, []);
  return busy ? (
    <Badge
      tone="info"
      icon={Wand2}
      data-testid="badge-converting"
      title="Drashti is converting it to a file it plays: it can go live once that is done."
    >
      Converting…
    </Badge>
  ) : (
    <UnplayableBadge />
  );
}

/** Convert (Try again after a failure), or Cancel while it waits or converts, at the end of a row. */
function ConvertControl({ m, job }: { m: MediaSummary; job: ConversionJob | undefined }) {
  if (jobBusy(job))
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
        <span className="truncate tabular-nums">{convertingWords(job)}</span>
      </span>
    );
  // Waiting its turn, or for the stream to go off air: converting all the same, until it is done (Session 50).
  if (jobBusy(job))
    return (
      <span className={`${line} text-muted`} title={job.note ?? undefined} data-testid="media-note">
        {convertingWords(job)}
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
      {/* Added from a phone (Session 54): the device's name. */}
      {m.fromDevice !== undefined && ` · from ${m.fromDevice}`}
    </span>
  );
}

/** What a media row adds to a playlist: the marked ones when it is one of them, else itself. */
const pickMedia = (id: string) => () => {
  const { marked, media } = useMedia.getState();
  const ids = marked.includes(id) ? media.filter((x) => marked.includes(x.id)).map((x) => x.id) : [id];
  return ids.map((mediaId) => ({ kind: 'media' as const, mediaId }));
};

const MediaRow = memo(function MediaRow({
  m,
  marked,
  chosen,
  platform,
  job,
}: {
  m: MediaSummary;
  marked: boolean;
  /** The one last clicked: it shows Add to playlist. */
  chosen: boolean;
  platform: string;
  job: ConversionJob | undefined;
}) {
  const KindIcon = mediaKindIcon[m.kind];
  const pick = pickMedia(m.id);
  const remove = () => void requestMediaRemoval(m.id);
  // A picture's zoom and enhancements (Session 26e).
  const pictureTool = m.kind === 'image' && !m.missing && m.unplayable === null;
  return (
    <div className={`${rowClass({ marked })} group relative flex h-full flex-col`} data-testid="media-row">
      {/* Room at the end for the Picture editor and the trash buttons (below, after Add to playlist in the
          Tab order). */}
      <div className={`flex min-h-0 flex-1 items-center gap-1.5 ${pictureTool ? 'pr-[4.5rem]' : 'pr-10'}`}>
        <button
          type="button"
          draggable
          data-testid="media-item"
          data-marked={marked ? 'true' : undefined}
          aria-pressed={marked}
          onClick={(e) => {
            clickMedia(m.id, { toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey, range: e.shiftKey });
          }}
          {...rowMenu(m.name, pick, remove)}
          onDragStart={(e) => {
            startDrag(
              e,
              'media',
              pick().map((i) => i.mediaId),
            );
            // Chosen once the drag is over: choosing it now would move the rows under the pointer.
            if (!useMedia.getState().marked.includes(m.id))
              afterDrag(() => {
                clickMedia(m.id, { toggle: false, range: false });
              });
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
      {chosen && <AddToPlaylistButton pick={pick} className="px-1.5 pb-1.5" />}
      {pictureTool && (
        <span className="absolute top-2 right-9 flex">
          <IconButton
            icon={SlidersHorizontal}
            label={`Picture editor: ${m.name}`}
            size="sm"
            data-testid="media-picture"
            onClick={() => {
              openPictureEditor({ id: m.id, name: m.name });
            }}
          />
        </span>
      )}
      <RowDelete
        label={`Delete “${m.name}”`}
        chosen={chosen}
        onDelete={remove}
        className="absolute top-2 right-1.5"
      />
    </div>
  );
});

/**
 * Every media file in the library, to drag into a playlist, under this computer's video inputs (Session 50: one
 * click puts one up).
 */
export function MediaList({ platform }: { platform: string }) {
  return (
    <>
      <VideoInputsSection />
      <MediaFiles platform={platform} />
    </>
  );
}

function MediaFiles({ platform }: { platform: string }) {
  const allMedia = useMedia((s) => s.media);
  const dropOnly = useMedia((s) => s.dropOnly);
  const media = useMemo(() => shownMedia({ media: allMedia, dropOnly }), [allMedia, dropOnly]);
  const dropped = useMemo(() => allMedia.filter((m) => m.fromDrop).length, [allMedia]);
  const loaded = useMedia((s) => s.loaded);
  const marked = useMedia((s) => s.marked);
  const anchorId = useMedia((s) => s.anchorId);
  const listRef = useRef<HTMLUListElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  // The chosen row is taller while a playlist is open: Add to playlist has a line under it.
  const playlistOpen = usePlaylistOpen();
  const chosenId = anchorId !== null && marked.includes(anchorId) ? anchorId : null;
  const heights = useMemo(
    () => media.map((m) => ROW_HEIGHT + (playlistOpen && m.id === chosenId ? ADD_LINE_HEIGHT : 0)),
    [media, playlistOpen, chosenId],
  );
  const layout = useMemo(() => layoutRows(heights), [heights]);
  const { start, end } = visibleRows(layout, view.top, view.height, MARGIN);
  const markedSet = new Set(marked);
  // Many chosen at once (Session 44): a box dragged from an empty place (rows by their places), Cmd-A.
  const boxBase = useRef<string[]>([]);
  const box = useBoxSelect({
    list: listRef,
    hits: (b) =>
      laidOutTouching(
        media.map((m) => m.id),
        layout.offsets,
        heights,
        b,
      ),
    begin: () => {
      boxBase.current = useMedia.getState().marked;
    },
    onBox: (ids, adding) => {
      const chosen = boxChoice(boxBase.current, ids, adding);
      useMedia.setState({ marked: chosen, anchorId: chosen[0] ?? null });
    },
    onClear: () => {
      useMedia.setState({ marked: [], anchorId: null });
    },
  });
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
      {dropped > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 text-xs">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={dropOnly}
            data-testid="media-filter-drop"
            className={dropOnly ? 'text-accent' : 'text-muted'}
            onClick={() => {
              setDropOnly(!dropOnly);
            }}
          >
            From the drop folder ({dropped})
          </Button>
        </div>
      )}
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
      <ChosenBar
        count={marked.length}
        noun="media files"
        onDelete={() => void requestMediaRemoval()}
        onClear={() => {
          useMedia.setState({ marked: [], anchorId: null });
        }}
      />
      <ul
        ref={listRef}
        tabIndex={-1}
        className="relative min-h-0 flex-1 overflow-y-auto focus:outline-none"
        data-testid="media-list"
        data-count={media.length}
        onPointerDown={box.onPointerDown}
        onKeyDown={(e) => {
          if (isSelectAll(e, platform)) {
            e.preventDefault();
            const ids = media.map((m) => m.id);
            useMedia.setState({ marked: ids, anchorId: ids[0] ?? null });
            return;
          }
          // Delete (Backspace on a Mac), as in the presentation list: asks first, then Undo (Session 26a).
          if (e.repeat || actionFor(e.nativeEvent, platform, LIBRARY_KEYMAP) !== 'removeSelected') return;
          e.preventDefault();
          void requestMediaRemoval();
        }}
        onScroll={(e) => {
          setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
        }}
      >
        <BoxOverlay box={box.box} as="li" />
        {media.slice(start, end).map((m, k) => {
          const i = start + k;
          return (
            <li
              key={m.id}
              style={{ position: 'absolute', top: layout.offsets[i], left: 8, right: 8, height: heights[i] }}
              className="pb-1"
              aria-setsize={media.length}
              aria-posinset={i + 1}
            >
              <MediaRow
                m={m}
                marked={markedSet.has(m.id)}
                chosen={m.id === chosenId}
                platform={platform}
                job={jobFor(jobs, m.id)}
              />
            </li>
          );
        })}
        <li aria-hidden="true" style={{ position: 'absolute', top: layout.total, height: 12, width: 1 }} />
      </ul>
      {loaded && media.length === 0 && (
        <EmptyState icon={Image} title="No media yet" compact lamp className="absolute inset-x-0 top-0">
          Import pictures, videos or sound, or presentations that use them.
        </EmptyState>
      )}
    </div>
  );
}
