import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaSummary } from '../../../shared/playlists';
import { startDrag } from '../playlists/drag';
import { MissingBadge, UnplayableBadge } from '../ui/Badge';
import type { Icon } from '../ui/icons';
import { Film, Image, Music } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
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

/** What is wrong with a media file, if anything. */
export function mediaProblem(m: { missing: boolean; unplayable: string | null }): string | null {
  if (m.missing) return 'File missing';
  if (m.unplayable !== null) return 'Can’t play';
  return null;
}

const MediaRow = memo(function MediaRow({
  m,
  marked,
  platform,
}: {
  m: MediaSummary;
  marked: boolean;
  platform: string;
}) {
  const problem = mediaProblem(m);
  const KindIcon = mediaKindIcon[m.kind];
  return (
    <button
      type="button"
      draggable
      data-testid="media-item"
      data-marked={marked ? 'true' : undefined}
      aria-pressed={marked}
      title={m.unplayable ?? undefined}
      onClick={(e) => {
        clickMedia(m.id, { toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey, range: e.shiftKey });
      }}
      onDragStart={(e) => {
        const { marked: now, media } = useMedia.getState();
        const ids = now.includes(m.id) ? media.filter((x) => now.includes(x.id)).map((x) => x.id) : [m.id];
        if (!now.includes(m.id)) clickMedia(m.id, { toggle: false, range: false });
        startDrag(e, 'media', ids);
      }}
      className={`${rowClass({ marked })} flex h-full items-center gap-2 px-2.5`}
    >
      <KindIcon size={16} aria-hidden="true" className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <Truncate text={m.name} className="text-sm" />
        <span className="block text-xs text-muted">{mediaKindLabel[m.kind]}</span>
      </span>
      {m.missing ? <MissingBadge /> : problem && <UnplayableBadge title={m.unplayable ?? undefined} />}
    </button>
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

  useEffect(() => {
    void loadMedia();
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
              <MediaRow m={m} marked={markedSet.has(m.id)} platform={platform} />
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
