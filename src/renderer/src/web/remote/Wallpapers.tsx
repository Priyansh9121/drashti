import { useEffect } from 'react';
import type { RemoteWallpaper } from '../../../../shared/network-phone';
import { PreviewPicture } from '../../render/previews';
import { cx } from '../../ui/cx';
import { Check, Pencil, Trash2, Wallpaper as WallpaperIcon } from '../../ui/icons';
import { longPressProps } from './long-press';
import {
  askRename,
  chooseWallpaper,
  deleteWallpaper,
  loadWallpapers,
  openMenu,
  renameWallpaper,
  usePhoneTools,
} from './phone-tools-store';
import { UndoLine } from './UndoLine';

/*
 * The wallpapers on a phone or tablet (Session 55, Part 9, from Part 6): under the playlist's rows, as the window has
 * them under its playlists, each a small picture with its name (one that goes round shows its first picture and how
 * many). One tap chooses one, the picture the screens show whenever nothing is up; a tap on the chosen one chooses
 * none (black). A long press opens its menu: Use as the wallpaper (or Stop using it), Rename…, and Delete, with Undo.
 * Simple Mode's window has them too, so a phone does all of it there as well. Adding pictures stays in Drashti.
 */

function Tile({ w, chosen }: { w: RemoteWallpaper; chosen: boolean }) {
  const first = w.pictures.find((p) => !p.missing);
  const menu = () => {
    openMenu(w.name, [
      {
        id: 'choose',
        label: chosen ? 'Stop using it' : 'Use as the wallpaper',
        icon: Check,
        run: () => void chooseWallpaper(chosen ? null : w.id),
      },
      {
        id: 'rename',
        label: 'Rename…',
        icon: Pencil,
        run: () => {
          askRename({
            what: 'the wallpaper',
            name: w.name,
            save: async (to) => ((await renameWallpaper(w.id, to)) ? null : 'It could not be renamed now.'),
          });
        },
      },
      {
        id: 'remove',
        label: 'Delete',
        icon: Trash2,
        danger: true,
        run: () => void deleteWallpaper(w.id, w.name),
      },
    ]);
  };
  return (
    <li>
      <button
        type="button"
        data-testid="remote-wallpaper"
        data-chosen={chosen ? 'true' : undefined}
        aria-pressed={chosen}
        onClick={() => void chooseWallpaper(chosen ? null : w.id)}
        {...longPressProps(menu)}
        className={cx(
          'block w-full overflow-hidden rounded-lg border-2 bg-panel-2 text-left select-none [-webkit-touch-callout:none]',
          chosen ? 'border-accent' : 'border-line',
        )}
      >
        <span className="relative block aspect-video bg-black" aria-hidden="true" data-a11y-picture>
          {first && (
            <PreviewPicture
              mediaId={first.mediaId}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
          {chosen && (
            <span className="absolute top-1 right-1 rounded-full bg-accent p-0.5 text-white">
              <Check size={16} />
            </span>
          )}
        </span>
        <span className="flex min-h-11 items-center gap-1 px-2 py-1 text-base">
          <span className="min-w-0 flex-1 truncate text-fg" translate="no">
            {w.name}
          </span>
          {w.pictures.length > 1 && (
            <span className="shrink-0 text-muted">⟳ {String(w.pictures.length)}</span>
          )}
        </span>
      </button>
    </li>
  );
}

export function Wallpapers() {
  const wallpapers = usePhoneTools((s) => s.wallpapers);
  useEffect(() => {
    if (!usePhoneTools.getState().wallpapers) void loadWallpapers();
  }, []);
  return (
    <section className="space-y-3" aria-labelledby="remote-wallpapers-title" data-testid="remote-wallpapers">
      <h2
        id="remote-wallpapers-title"
        className="flex items-center gap-2 text-base font-bold tracking-wider text-muted uppercase"
      >
        <WallpaperIcon size={18} aria-hidden="true" />
        Wallpapers
      </h2>
      <UndoLine where="wallpapers" testId="remote-wallpapers-undo" />
      {wallpapers === null ? (
        <p role="status" className="text-base text-muted">
          Loading the wallpapers…
        </p>
      ) : wallpapers.wallpapers.length === 0 ? (
        <p className="text-base text-muted">
          No wallpapers yet: they are added in Drashti on the computer. The one chosen shows on the screens
          whenever nothing is up.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2" aria-label="Wallpapers">
          {wallpapers.wallpapers.map((w) => (
            <Tile key={w.id} w={w} chosen={w.id === wallpapers.chosenId} />
          ))}
        </ul>
      )}
    </section>
  );
}
