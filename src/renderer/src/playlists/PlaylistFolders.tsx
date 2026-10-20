import { useMemo } from 'react';
import { folderCrumbs, hasFolder, playlistFolders, subfoldersOf } from '../../../shared/playlist-folders';
import { CornerLeftUp, Folder } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
import { Truncate } from '../ui/Truncate';
import { plural } from '../ui/text';
import { openFolder, showsFolders, usePlaylists } from './playlist-store';

/*
 * The open folder playlist's folders, in the bottom left (Session 44; Priyansh: "the folders inside the main
 * folder should show up at the bottom left … if i click sub folders, their material pops up in middle
 * screen, i can go back to the main folder via clicking the playlist itself"). It lists the folders inside
 * the one the middle shows, named as on disk, in the folder's order, and the way back up. The playlist itself
 * keeps its whole order: Next, Simple Mode and the phones follow all of it.
 */

/** Whether the bottom left shows the open playlist's folders: a playlist made from a folder, with subfolders. */
export function usePlaylistFolders(): boolean {
  return usePlaylists(showsFolders);
}

/**
 * The way back up, over the open folder playlist's items (Session 44): "Placeholder Sabha › Week 1 › Videos",
 * each folder above the one shown a button.
 */
export function FolderCrumbs({ path, top }: { path: string; top: string }) {
  const crumbs = folderCrumbs(path, top);
  return (
    <nav
      aria-label="This folder"
      data-testid="folder-crumbs"
      className="shrink-0 border-b border-line px-3 py-1"
    >
      <ol className="flex flex-wrap items-center gap-x-1 text-sm">
        {crumbs.map((c, i) => (
          <li key={c.path} className="flex min-w-0 items-center gap-1">
            {i > 0 && (
              <span aria-hidden="true" className="text-faint">
                ›
              </span>
            )}
            {i === crumbs.length - 1 ? (
              <span aria-current="location" className="truncate px-1 py-1 font-bold">
                {c.name}
              </span>
            ) : (
              <button
                type="button"
                data-testid="folder-crumb"
                className="truncate rounded px-1 py-1 text-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => {
                  openFolder(c.path);
                }}
              >
                {c.name}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PlaylistFolders() {
  const node = usePlaylists((s) => s.tree.find((n) => n.id === s.openId));
  const items = usePlaylists((s) => s.items);
  const folder = usePlaylists((s) => s.folder);
  const view = useMemo(() => playlistFolders(items), [items]);
  const shown = hasFolder(view, folder) ? folder : '';
  const inside = subfoldersOf(view, shown);
  const crumbs = folderCrumbs(shown, node?.name ?? '');
  const here = crumbs.at(-1)?.name ?? '';
  const up = crumbs.at(-2);
  return (
    <section aria-label="Folders" data-testid="playlist-folders" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-3">
        <Folder size={15} aria-hidden="true" className="shrink-0 text-muted" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-heading">Folders in {here}</h2>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {up && (
          <li>
            <button
              type="button"
              data-testid="folder-up"
              className={`${rowClass({ selected: false, marked: false })} flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm`}
              onClick={() => {
                openFolder(up.path);
              }}
            >
              <CornerLeftUp size={15} aria-hidden="true" className="shrink-0 text-muted" />
              <Truncate text={`Back to ${up.name}`} className="flex-1" />
            </button>
          </li>
        )}
        {inside.map((f) => {
          const holds = subfoldersOf(view, f.path).length;
          const says = [f.own > 0 ? plural(f.own, 'item') : '', holds > 0 ? plural(holds, 'folder') : '']
            .filter((w) => w !== '')
            .join(', ');
          return (
            <li key={f.path}>
              <button
                type="button"
                data-testid="playlist-folder"
                data-path={f.path}
                className={`${rowClass({ selected: false, marked: false })} flex w-full items-center gap-2 px-2.5 py-2 text-left`}
                onClick={() => {
                  openFolder(f.path);
                }}
              >
                <Folder size={15} aria-hidden="true" className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <Truncate text={f.name} className="text-sm font-medium" />
                  {says !== '' && <span className="block text-xs text-muted">{says}</span>}
                </span>
              </button>
            </li>
          );
        })}
        {inside.length === 0 && (
          <li className="px-2.5 py-2 text-xs text-muted" data-testid="no-subfolders">
            No folders inside {here}.
          </li>
        )}
      </ul>
    </section>
  );
}
