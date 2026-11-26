import { useEffect, useMemo } from 'react';
import type { PresentationDoc } from '../../../../shared/library';
import type { PlaylistItemInfo, PlaylistNode } from '../../../../shared/playlists';
import { backgroundCueOf } from '../../../../shared/library';
import { useEngine } from '../../engine/engine-store';
import { PlacedInParent } from '../../render/Placed';
import { PreviewPicture } from '../../render/previews';
import { SlideView } from '../../render/SlideView';
import { groupDocId, groupName, type MiddleRow } from '../../playlists/rows';
import { LiveBadge } from '../../ui/Badge';
import { cx } from '../../ui/cx';
import { ChevronDown, ChevronRight } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';
import { TIMER_ALONE_WORDS } from './phone-mode';
import { phoneRows, rowTap } from './phone-rows';
import { readDocsFor, toggleFolded, usePhoneTools } from './phone-tools-store';
import { playlistPaths } from './playlist-paths';
import { showPlaylist, useRemote } from './remote-store';

/*
 * The Playlist tab on a phone or tablet, in Pro Mode only (Session 55, Part 9; since alpha.23, QA23-PHONE-1, the
 * owner's "Only PPT and PDF"): the playlist the phone opens (Q10), and of it only its PowerPoints and PDFs, as Drashti
 * marks them for a phone (phonePlays). Their rows (phone-rows.ts): a presentation's name, which folds its slides
 * (remembered on this phone), and a row a slide under it, "<name>_N" with a small picture and a text slide's first
 * line; one tap on a slide's row puts it up, LIVE marking the one up. Until alpha.23 every row (pictures, videos,
 * sounds, video inputs, kirtans, words), a long press for its menu, Manage playlists…, a folder's own
 * rows, Repeat Slides and the wallpapers under the rows: none of them now (the network refuses them from a phone).
 */

const post = (path: string, body: Record<string, unknown>) => () =>
  api<{ rev?: number }>(path, { method: 'POST', body });

/** A slide's small picture: its background cue's picture behind it, as the remote's thumbnails draw slides. */
function SlidePicture({ row }: { row: Extract<MiddleRow, { kind: 'slide' }> }) {
  const slide = row.at.slide;
  const bg = backgroundCueOf(slide.cues);
  return (
    <span
      className="relative block aspect-video w-20 shrink-0 overflow-hidden rounded bg-black"
      aria-hidden="true"
      data-a11y-picture
    >
      <PlacedInParent
        content={{ width: slide.slide.width, height: slide.slide.height }}
        mode="fit"
        className="relative aspect-video w-full"
      >
        <div style={{ position: 'relative', width: slide.slide.width, height: slide.slide.height }}>
          {bg?.background.kind === 'media' && (
            <PreviewPicture
              mediaId={bg.background.mediaId}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
          <div style={{ position: 'absolute', inset: 0 }}>
            <SlideView slide={slide.slide} media="still" />
          </div>
        </div>
      </PlacedInParent>
    </span>
  );
}

/** Where the show is, as the rows mark it: the live row of this playlist. */
function useLive(playlistId: string | null) {
  const item = useEngine((s) => {
    const live = s.state?.live.playlist;
    return live?.playlistId === playlistId ? live.itemId : null;
  });
  // The slide up from that row (a timer up alone is no slide of it).
  const slide = useEngine((s) => {
    const shown = s.state?.layers.slide;
    return shown && !shown.timer ? shown.slideIndex : null;
  });
  return { item, slide };
}

/**
 * The rows of the shown playlist's PowerPoints and PDFs (QA23-PHONE-1): a presentation's name, which folds its slides,
 * and a row a slide under it, one tap to put it up. No menu and nothing else of the row: a phone renames, removes and
 * pins nothing.
 */
function Rows({
  playlistId,
  items,
  docs,
  folded,
  timerAlone,
}: {
  playlistId: string;
  items: PlaylistItemInfo[];
  docs: ReadonlyMap<string, PresentationDoc | null>;
  folded: readonly string[];
  /** A timer shown alone over the deck: no page goes up from a phone (a23-review-phoneui MUST-2). */
  timerAlone: boolean;
}) {
  const live = useLive(playlistId);
  useEffect(() => {
    readDocsFor(items);
  }, [items, docs]);
  const rows = useMemo(() => phoneRows(items, docs, new Set(folded), false), [items, docs, folded]);
  const go = (row: MiddleRow) => {
    const does = rowTap(row, playlistId, false);
    if (does.kind === 'fold') toggleFolded(does.itemId);
    else if (does.kind === 'post') void tap(post(does.path, does.body));
  };
  return (
    <ul className="space-y-1.5" data-testid="remote-items">
      {rows.map((row) => {
        if (row.kind === 'slide') {
          if (row.hidden) return null;
          const up = row.item !== null && live.item === row.item.id && live.slide === row.at.position;
          return (
            <li key={row.key} className="[contain-intrinsic-size:auto_3.5rem] [content-visibility:auto]">
              <button
                type="button"
                data-testid="remote-row"
                data-kind="slide"
                disabled={timerAlone}
                data-live={up ? 'true' : undefined}
                aria-label={`${row.label}${row.line ? `: ${row.line}` : ''}${up ? ', on the screens' : ''}`}
                onClick={() => {
                  go(row);
                }}
                className={cx(
                  'flex min-h-14 w-full items-center gap-2 rounded-lg border bg-panel-2 py-1 pr-2 pl-3 text-left text-base select-none disabled:opacity-50',
                  up ? 'border-live' : 'border-line',
                )}
              >
                <SlidePicture row={row} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fg" translate="no">
                    {row.label}
                  </span>
                  {row.line && (
                    <span className="block truncate text-muted" translate="no">
                      {row.line}
                    </span>
                  )}
                </span>
                {up && <LiveBadge />}
              </button>
            </li>
          );
        }
        if (row.kind !== 'group') return null;
        const name = groupName(row.item, docs.get(groupDocId(row.item)) ?? null);
        const open = !row.folded;
        const FoldIcon = open ? ChevronDown : ChevronRight;
        const up = live.item === row.item.id;
        return (
          <li key={row.key}>
            <button
              type="button"
              data-testid="remote-item"
              data-kind="group"
              data-live={up ? 'true' : undefined}
              aria-expanded={open}
              onClick={() => {
                go(row);
              }}
              className={cx(
                'flex min-h-12 w-full items-center gap-2 rounded-lg border bg-panel px-3 py-2 text-left text-base select-none',
                up ? 'border-live' : 'border-line',
              )}
            >
              <FoldIcon size={18} aria-hidden="true" className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-fg" translate="no">
                  {name}
                </span>
                <span className="block truncate text-muted">
                  {row.read === 'loading'
                    ? 'Reading its slides…'
                    : row.read === 'unread'
                      ? 'Its slides could not be read now.'
                      : row.read === 'gone'
                        ? 'No longer in the library.'
                        : `${String(row.count)} ${row.count === 1 ? 'slide' : 'slides'}${open ? '' : ' · folded'}`}
                </span>
              </span>
              {up && <LiveBadge />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A playlist's rows a phone may put up: its PowerPoints and PDFs, as Drashti marks them for a phone (phonePlays). */
export const phoneDeckRows = (items: readonly PlaylistItemInfo[]): PlaylistItemInfo[] =>
  items.filter((i) => i.kind === 'presentation' && i.phonePlays === true);

/** The Playlist tab (Pro Mode only, phone-mode.ts), from the phone's store. */
export function PlaylistTab() {
  const playlists = useRemote((s) => s.playlists);
  const playlistId = useRemote((s) => s.playlistId);
  const items = useRemote((s) => s.items);
  const docs = usePhoneTools((s) => s.docs);
  const folded = usePhoneTools((s) => s.folded);
  const timerAlone = useEngine((s) => Boolean(s.state?.layers.slide?.timer));
  return (
    <PlaylistTabView
      playlists={playlists}
      playlistId={playlistId}
      items={items}
      docs={docs}
      folded={folded}
      timerAlone={timerAlone}
    />
  );
}

/** The Playlist tab as drawn: which playlist, and its PowerPoint and PDF rows. */
export function PlaylistTabView({
  playlists,
  playlistId,
  items,
  docs,
  folded,
  timerAlone,
}: {
  playlists: PlaylistNode[] | null;
  playlistId: string | null;
  items: PlaylistItemInfo[] | null;
  /** The rows' presentations as read (phone-tools-store.ts), and the rows folded on this phone. */
  docs: ReadonlyMap<string, PresentationDoc | null>;
  folded: readonly string[];
  timerAlone: boolean;
}) {
  const paths = useMemo(() => playlistPaths(playlists ?? []), [playlists]);
  const decks = useMemo(() => (items ? phoneDeckRows(items) : null), [items]);
  const offered = (playlists ?? []).filter((p) => !p.isFolder);
  return (
    <section className="space-y-3" aria-labelledby="playlist-title">
      <h2 id="playlist-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Playlist
      </h2>
      {playlists && offered.length > 0 ? (
        <select
          aria-label="Which playlist"
          value={playlistId ?? ''}
          onChange={(e) => void showPlaylist(e.target.value)}
          className="h-12 w-full rounded-lg border border-field bg-panel-2 px-3 text-base text-fg"
          data-testid="remote-playlist"
        >
          {offered.map((p) => (
            <option key={p.id} value={p.id}>
              {paths.get(p.id) ?? p.name}
              {p.kind === 'smart' ? ' · Smart playlist' : ''}
            </option>
          ))}
        </select>
      ) : playlists ? (
        <p className="text-base text-muted">
          There are no playlists yet: they are made in Drashti on the computer.
        </p>
      ) : (
        <p role="status" className="text-base text-muted">
          Loading the playlists…
        </p>
      )}
      {playlistId && decks ? (
        decks.length > 0 ? (
          <>
            {timerAlone && (
              <p className="text-base text-muted" data-testid="remote-items-timer" role="status">
                {TIMER_ALONE_WORDS}
              </p>
            )}
            <Rows playlistId={playlistId} items={decks} docs={docs} folded={folded} timerAlone={timerAlone} />
          </>
        ) : (
          <>
            <p className="text-base text-muted" data-testid="remote-items-none">
              No PowerPoint or PDF in this playlist: only those go up from a phone.
            </p>
            <ul data-testid="remote-items" />
          </>
        )
      ) : (
        <ul data-testid="remote-items" />
      )}
    </section>
  );
}
