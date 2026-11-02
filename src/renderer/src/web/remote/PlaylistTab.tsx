import { useEffect, useMemo } from 'react';
import type { PresentationDoc } from '../../../../shared/library';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { backgroundCueOf } from '../../../../shared/library';
import { useEngine } from '../../engine/engine-store';
import { PlacedInParent } from '../../render/Placed';
import { PreviewPicture } from '../../render/previews';
import { SlideView } from '../../render/SlideView';
import { groupDocId, groupName, type MiddleRow } from '../../playlists/rows';
import { Badge, LiveBadge } from '../../ui/Badge';
import { cx } from '../../ui/cx';
import { ChevronDown, ChevronRight, Image, Music, Video } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';
import { LookAtMedia } from '../viewer/LookCloser';
import { itemLine } from './item-line';
import { longPressProps } from './long-press';
import { phoneRows, rowTap } from './phone-rows';
import { readDocsFor, toggleFolded, usePhoneTools } from './phone-tools-store';
import { isRepeatPlaylist, repeatItemUp } from './repeat';
import { RepeatStart } from './RepeatStart';
import { openRowMenu } from './row-actions';
import { showPlaylist, useRemote } from './remote-store';
import { useSimple } from './simple';
import { UndoLine } from './UndoLine';
import { Wallpapers } from './Wallpapers';

/*
 * The Playlist tab on a phone or tablet (Session 55, Part 9): the playlist is where things go live, as Part 4 made the
 * window's middle. Its rows (phone-rows.ts): a presentation's name, which folds its slides (remembered on this phone),
 * and a row a slide under it, "<name>_N" with a small picture and a text slide's first line; a row each for a picture,
 * video, sound or video input (a picture or video looked at, or played, on this phone with the button beside it).
 * One tap puts a row up, LIVE marking the one up; a long press opens its menu (row-actions.ts). Under the rows the
 * wallpapers, as the window has them under its playlists (Part 6). In Simple Mode only Simple Mode's playlist.
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

const MEDIA_ICON = { image: Image, video: Video, audio: Music } as const;

/** A file's small picture (a picture's or a video's preview), or its kind's icon (a sound, an input). */
function ItemPicture({ item }: { item: PlaylistItemInfo }) {
  if (item.kind === 'media' && item.media !== 'audio' && !item.missing)
    return (
      <span
        className="relative block aspect-video w-20 shrink-0 overflow-hidden rounded bg-black"
        aria-hidden="true"
        data-a11y-picture
      >
        <PreviewPicture
          mediaId={item.mediaId}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </span>
    );
  const KindIcon = item.kind === 'media' ? MEDIA_ICON[item.media] : Video;
  return (
    <span
      className="flex aspect-video w-20 shrink-0 items-center justify-center rounded bg-black text-muted"
      aria-hidden="true"
    >
      <KindIcon size={20} />
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
  const repeatItem = useEngine((s) => repeatItemUp(s.state, playlistId));
  return { item, slide, repeatItem };
}

/** The rows of the shown playlist, one tap each, a long press for the menu. */
function Rows({
  playlistId,
  items,
  repeat,
}: {
  playlistId: string;
  items: PlaylistItemInfo[];
  repeat: boolean;
}) {
  const docs = usePhoneTools((s) => s.docs);
  const folded = usePhoneTools((s) => s.folded);
  const simple = useSimple() !== null;
  const live = useLive(playlistId);
  useEffect(() => {
    if (!repeat) readDocsFor(items);
  }, [items, repeat, docs]);
  const rows = useMemo(() => phoneRows(items, docs, new Set(folded), repeat), [items, docs, folded, repeat]);
  const docOf = (row: MiddleRow): PresentationDoc | null =>
    row.kind === 'slide' && row.item ? (docs.get(groupDocId(row.item)) ?? null) : null;
  const go = (row: MiddleRow) => {
    const does = rowTap(row, playlistId, repeat);
    if (does.kind === 'fold') toggleFolded(does.itemId);
    else if (does.kind === 'post') void tap(post(does.path, does.body));
  };
  const menuOf = (row: MiddleRow, title: string) => () => {
    openRowMenu(row, playlistId, simple, docOf(row), title);
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
                data-live={up ? 'true' : undefined}
                aria-label={`${row.label}${row.line ? `: ${row.line}` : ''}${up ? ', on the screens' : ''}`}
                onClick={() => {
                  go(row);
                }}
                {...longPressProps(menuOf(row, row.label))}
                className={cx(
                  'flex min-h-14 w-full items-center gap-2 rounded-lg border bg-panel-2 py-1 pr-2 pl-3 text-left text-base select-none [-webkit-touch-callout:none]',
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
        const { item } = row;
        if (item.kind === 'header')
          return (
            <li
              key={row.key}
              data-testid="remote-row-header"
              className="truncate pt-2 text-base font-bold text-muted"
            >
              {item.label}
            </li>
          );
        if (row.kind === 'group') {
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
                {...longPressProps(menuOf(row, name))}
                className={cx(
                  'flex min-h-12 w-full items-center gap-2 rounded-lg border bg-panel px-3 py-2 text-left text-base select-none [-webkit-touch-callout:none]',
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
        }
        // A picture, video, sound, video input or slot, a row each (in a Repeat Slides playlist, every item).
        const up = live.item === item.id || live.repeatItem === item.id;
        const goes = rowTap(row, playlistId, repeat).kind !== 'none';
        return (
          <li key={row.key} className="flex gap-2">
            <button
              type="button"
              data-testid="remote-item"
              data-kind={item.kind}
              data-live={up ? 'true' : undefined}
              aria-disabled={goes ? undefined : true}
              onClick={() => {
                go(row);
              }}
              {...longPressProps(menuOf(row, item.label))}
              className={cx(
                'flex min-h-14 w-full min-w-0 items-center gap-2 rounded-lg border bg-panel-2 py-1 pr-2 pl-3 text-left text-base select-none [-webkit-touch-callout:none]',
                up ? 'border-live' : 'border-line',
              )}
            >
              {item.kind !== 'placeholder' && <ItemPicture item={item} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">{item.label}</span>
                <span className="block truncate text-muted">{itemLine(item)}</span>
              </span>
              {item.kind === 'input' && (
                <Badge tone={item.missing ? 'warning' : 'neutral'} data-testid="remote-item-input">
                  {item.missing ? 'Not on Drashti’s computer' : 'Video input'}
                </Badge>
              )}
              {item.kind === 'placeholder' && <Badge tone="warning">Empty</Badge>}
              {up && <LiveBadge />}
            </button>
            {/* Session 54 (D1): a picture looked at, or a video played, on this device only. */}
            {item.kind === 'media' && item.media !== 'audio' && !item.missing && (
              <LookAtMedia mediaId={item.mediaId} media={item.media} name={item.label} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function PlaylistTab() {
  const playlists = useRemote((s) => s.playlists);
  const playlistId = useRemote((s) => s.playlistId);
  const items = useRemote((s) => s.items);
  const simple = useSimple();
  const repeat = useRemote((s) => isRepeatPlaylist(s.playlists, s.playlistId));
  // In Simple Mode only its one playlist is offered (Part 9; its window shows that one alone).
  const offered = simple ? (playlists ?? []).filter((p) => p.id === simple.playlistId) : (playlists ?? []);
  return (
    <div className="space-y-6">
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
                {p.name}
              </option>
            ))}
          </select>
        ) : playlists ? (
          <p className="text-base text-muted">
            There are no playlists yet: they are made in Drashti on the computer, in Pro Mode.
          </p>
        ) : (
          <p role="status" className="text-base text-muted">
            Loading the playlists…
          </p>
        )}
        {repeat && playlistId && <RepeatStart playlistId={playlistId} />}
        <UndoLine where="rows" testId="remote-rows-undo" />
        {playlistId && items ? (
          <Rows playlistId={playlistId} items={items} repeat={repeat} />
        ) : (
          <ul data-testid="remote-items" />
        )}
      </section>
      <Wallpapers />
    </div>
  );
}
