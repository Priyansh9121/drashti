import { useEffect, useId, useState } from 'react';
import type { DragEvent } from 'react';
import type { Wallpaper } from '../../../shared/wallpapers';
import { wallpaperMissing } from '../../../shared/wallpaper-missing';
import type { FileTarget } from '../files/file-menu';
import { fileMenuProps } from '../files/FileMenu';
import { useWhatIsThis } from '../help/WhatIsThis';
import { relinkMedia } from '../library/import-store';
import { dragKind, droppedIds, droppedPaths, hasFiles } from '../playlists/drag';
import { MediaStill } from '../render/MediaStill';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import {
  AlertTriangle,
  Check,
  FileQuestion,
  ImagePlus,
  Repeat2,
  Wallpaper as WallpaperIcon,
} from '../ui/icons';
import { useScrolls } from '../ui/scrolls';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { WallpaperEditor } from './WallpaperEditor';
import {
  addWallpaperFiles,
  addWallpapers,
  chooseWallpaper,
  deleteWallpaper,
  importWallpapers,
  renameWallpaper,
  requestDeleteWallpaper,
  useWallpapers,
  watchWallpapers,
} from './wallpaper-store';
import { addWhenEndsToMenu } from './when-ends';

/*
 * The wallpapers (Session 55, Part 6), in the Playlists panel itself: under the playlists (and the open folder
 * playlist's folders), just above the bar of clears. Each is a small picture with its name; a click chooses it (it
 * then shows on the audience screens whenever nothing is up there, and under the Wallpaper, F12), a click on the chosen
 * one chooses none (black). Pictures dragged in from the Finder or Explorer, or from Media, become wallpapers; dropped
 * on one, they go into it (its pictures then go round); Import… is the system's dialog for pictures. The one
 * right-click menu (Part 14) has Use as the wallpaper, Edit wallpaper… (its pictures, their seconds and the fade),
 * Rename… and Delete…, each with Undo.
 */

/** A drag the wallpapers take: files from the computer, or media from the library. */
const takes = (e: DragEvent): boolean => hasFiles(e) || dragKind(e) === 'media';

/** Files or the library's media dropped: as wallpapers, or (`into`) more pictures for one. */
function dropInto(e: DragEvent, into: string | null): void {
  if (!takes(e)) return;
  e.preventDefault();
  // The window imports files dropped anywhere else: these are the wallpapers'.
  e.stopPropagation();
  if (hasFiles(e)) void addWallpaperFiles(droppedPaths(e), into);
  else void addWallpapers(droppedIds(e, 'media'), into);
}

/** What the one right-click menu holds for a wallpaper. */
export function wallpaperTarget(wallpaper: Wallpaper, chosen: boolean): FileTarget {
  const [only] = wallpaper.pictures.length === 1 ? wallpaper.pictures : [];
  return {
    kind: 'picture',
    name: wallpaper.name,
    place: 'wallpapers',
    ...(only ? { mediaId: only.mediaId } : {}),
    first: [
      {
        label: chosen ? 'Stop using it' : 'Use as the wallpaper',
        icon: WallpaperIcon,
        onSelect: () => void chooseWallpaper(chosen ? null : wallpaper.id),
      },
    ],
    edit: {
      label: 'Edit wallpaper…',
      run: () => {
        useWallpapers.setState({ editing: wallpaper.id });
      },
    },
    rename: () => {
      renameWallpaper(wallpaper);
    },
    remove: {
      label: 'Delete…',
      run: () => {
        requestDeleteWallpaper(wallpaper);
      },
    },
  };
}

export function WallpaperTile({ wallpaper, chosen }: { wallpaper: Wallpaper; chosen: boolean }) {
  const [over, setOver] = useState(false);
  const shown = wallpaper.pictures.find((p) => !p.missing && !p.unplayable);
  const count = wallpaper.pictures.length;
  // Its pictures gone from the library (QA24-WALLBLACK-1): said, never a black square.
  const missing = wallpaperMissing(wallpaper);
  return (
    <li>
      <button
        type="button"
        data-testid="wallpaper-tile"
        data-wallpaper-id={wallpaper.id}
        data-missing={missing ? missing.kind : undefined}
        aria-pressed={chosen}
        aria-label={`${wallpaper.name}${count > 1 ? `, ${String(count)} pictures in turn` : ''}${missing ? `, ${missing.label}` : ''}`}
        title={chosen ? `${wallpaper.name}: in use (click for none)` : `${wallpaper.name}: click to use it`}
        className={cx(
          'group flex w-full min-w-0 flex-col rounded-md border p-1 text-left transition-colors',
          over
            ? 'border-accent bg-panel-3'
            : chosen
              ? 'border-accent bg-panel-3'
              : 'border-transparent hover:bg-panel-2',
        )}
        onClick={() => void chooseWallpaper(chosen ? null : wallpaper.id)}
        onDragOver={(e) => {
          if (!takes(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={(e) => {
          setOver(false);
          dropInto(e, wallpaper.id);
        }}
        {...fileMenuProps(() => wallpaperTarget(wallpaper, chosen))}
      >
        <span
          className={cx(
            'relative block w-full overflow-hidden rounded',
            shown ? 'aspect-video bg-black' : 'min-h-16 bg-warning-bg px-1 py-5',
          )}
        >
          {shown ? (
            <MediaStill mediaId={shown.mediaId} media="image" />
          ) : (
            <span
              data-testid="wallpaper-missing"
              title={missing?.tile}
              className="block text-center text-[11px] leading-tight font-medium break-words text-warning-fg"
            >
              {missing?.tile}
            </span>
          )}
          {shown && missing && (
            // Some of its pictures missing, the rest going round: a mark, its words in the tile's name.
            <span
              data-testid="wallpaper-some-missing"
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 flex items-center gap-0.5 rounded bg-warning-bg px-1 text-[10px] leading-4 text-warning-fg tabular-nums"
            >
              <FileQuestion size={10} />
              {missing.count}
            </span>
          )}
          {chosen && (
            <span
              className="absolute top-0.5 left-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-white"
              aria-hidden="true"
            >
              <Check size={11} strokeWidth={3} />
            </span>
          )}
          {count > 1 && (
            <span
              data-testid="wallpaper-count"
              className="absolute right-0.5 bottom-0.5 flex items-center gap-0.5 rounded bg-black/70 px-1 text-[10px] leading-4 text-white tabular-nums"
            >
              <Repeat2 size={10} aria-hidden="true" />
              {count}
            </span>
          )}
        </span>
        <Truncate text={wallpaper.name} className="mt-0.5 block w-full text-xs" />
      </button>
    </li>
  );
}

/**
 * The chosen wallpaper's pictures gone from the library (QA24-WALLBLACK-1: deleted from Media, or gone at a start
 * after it): what the screens show for it, and Find… (Find missing media…, in a folder the operator picks).
 */
function MissingNotice({ wallpaper }: { wallpaper: Wallpaper }) {
  const missing = wallpaperMissing(wallpaper);
  if (!missing) return null;
  return (
    <div
      role="status"
      data-testid="wallpaper-missing-notice"
      className="mx-2 mb-1.5 flex shrink-0 items-start gap-2 rounded-md border border-l-4 border-warning/60 border-l-warning bg-warning-bg px-2 py-1.5 text-xs text-warning-fg"
    >
      <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1">{missing.notice}</p>
      {missing.find.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          title="Look for it in a folder on this computer"
          data-testid="wallpaper-find-missing"
          onClick={() => void relinkMedia(missing.find)}
        >
          Find…
        </Button>
      )}
    </div>
  );
}

/** Deleting the chosen one: asked first, as it is on the screens whenever nothing is up. */
function DeleteQuestion() {
  const asking = useWallpapers((s) => s.asking);
  if (!asking) return null;
  const close = () => {
    useWallpapers.setState({ asking: null });
  };
  return (
    <Dialog
      title="Delete the wallpaper in use?"
      size="sm"
      onClose={close}
      testId="wallpaper-delete-confirm"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="danger" onClick={() => void deleteWallpaper(asking.id, asking.name)}>
            Delete
          </Button>
        </>
      }
    >
      <p className="text-sm">
        “{asking.name}” is the wallpaper in use: the screens show it whenever nothing is up. Deleted, they
        show black until another is chosen. Undo brings it back.
      </p>
    </Dialog>
  );
}

/** `fill`: the whole of its column (Simple Mode's left column, Session 55, Part 18), not a part under the playlists. */
export function WallpapersPanel({ fill = false }: { fill?: boolean } = {}) {
  const view = useWallpapers((s) => s.view);
  // The editor drawn afresh for each wallpaper edited: what was typed for one never shows for the next.
  const editing = useWallpapers((s) => s.editing);
  const [over, setOver] = useState(false);
  const headingId = useId();
  // What is this? (Pro Mode's: Simple Mode has no ? of its own).
  const help = useWhatIsThis('wallpapers');
  useEffect(() => {
    watchWallpapers();
    addWhenEndsToMenu();
  }, []);
  const wallpapers = view?.wallpapers ?? [];
  const chosenOne = wallpapers.find((w) => w.id === view?.chosenId) ?? null;
  // With the text large, the empty card scrolls with nothing focusable in it: it takes the keyboard while it does.
  const [emptyBox, emptyScrolls] = useScrolls();
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      data-testid="wallpapers"
      className={cx(
        'flex min-h-0 flex-col',
        fill ? 'flex-1' : 'max-h-[45%] shrink-0 border-t border-line',
        over && 'bg-panel-2',
      )}
      onDragOver={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        dropInto(e, null);
      }}
    >
      {/* Import…'s words only where they fit beside the heading (alpha.21: the owner's column at its least cut the
          heading to "Wallpap"); its icon alone narrower, named Import… either way. */}
      <div className="@container/wallpapers flex h-9 shrink-0 items-center gap-1 px-3" data-strip="">
        <h2 id={headingId} className="flex flex-1 items-center gap-1.5 px-1 text-sm font-bold">
          <WallpaperIcon size={15} aria-hidden="true" className="shrink-0 text-muted" />
          Wallpapers
        </h2>
        <Button
          size="sm"
          icon={ImagePlus}
          data-testid="wallpapers-import"
          title="Bring pictures in as wallpapers"
          aria-label="Import…"
          onClick={() => void importWallpapers()}
        >
          <span className="hidden @[14rem]/wallpapers:inline">Import…</span>
        </Button>
        {help.button}
      </div>
      {help.card}
      {chosenOne && <MissingNotice wallpaper={chosenOne} />}
      {wallpapers.length === 0 ? (
        <div
          ref={emptyBox}
          role="group"
          aria-label="No wallpapers yet"
          className="min-h-0 overflow-y-auto px-2 pb-2"
          tabIndex={emptyScrolls ? 0 : undefined}
        >
          <EmptyState icon={WallpaperIcon} title="No wallpapers yet" compact data-testid="wallpapers-empty">
            Drop pictures here, or Import…. The one you choose shows on the screens whenever nothing is up.
          </EmptyState>
        </div>
      ) : (
        <ul
          aria-label="Wallpapers"
          className="grid min-h-0 grid-cols-3 content-start gap-1 overflow-y-auto px-2 pb-2"
        >
          {wallpapers.map((w) => (
            <WallpaperTile key={w.id} wallpaper={w} chosen={w.id === view?.chosenId} />
          ))}
        </ul>
      )}
      <WallpaperEditor key={editing ?? ''} />
      <DeleteQuestion />
    </div>
  );
}
