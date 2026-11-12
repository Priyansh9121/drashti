import { useEffect, useMemo, useState } from 'react';
import type { PlaylistItemInfo, PlaylistNode } from '../../../../shared/playlists';
import { useEngine } from '../../engine/engine-store';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Undo2 } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { api } from '../device';
import { closeSheet } from './desktop-store';
import { loadMedia, useMirror } from './mirror-store';
import { PhoneQuestion, PhoneSheet } from './PhoneSheet';
import { playlistPaths } from './playlist-paths';
import { loadLibrary, loadPlaylists, refreshPlaylist, showPlaylist, useRemote } from './remote-store';

/*
 * The library's changes from a phone (Session 54, the phone as a full Drashti), as the operator window makes them
 * on the Drashti computer: a presentation made from words; a presentation or a playlist deleted, with its Undo, as
 * the window's; a playlist made or renamed; and in a playlist, a presentation or one of Media's files added (by its
 * id), items moved up or down and taken out, with Undo. Both modes can manage playlists and their folders.
 * Creating or deleting presentations and adding existing library files to a playlist stay in Pro Mode.
 * The phone reads the lists again after each change.
 */

type Tab = 'playlists' | 'presentations';

/** What the last delete took out, and how its Undo puts it back. */
interface Undo {
  words: string;
  path: string;
  ids: string[];
  then: () => Promise<void>;
}

const FIELD = 'h-12 w-full rounded-lg border border-field bg-panel-3 px-3 text-base text-fg';
const LABEL_WORDS = 'block text-base text-muted';

/** A change sent: its answer's ids (a delete's, for its Undo), or null with the problem said. */
async function send(
  path: string,
  body: unknown,
  say: (problem: string | null) => void,
): Promise<string[] | null> {
  const r = await api<{ ids?: string[]; id?: string }>(path, { method: 'POST', body });
  if (!r.ok) {
    say(r.message);
    return null;
  }
  say(null);
  return r.ids ?? (r.id ? [r.id] : []);
}

export function LibrarySheet({ playlistsOnly = false }: { playlistsOnly?: boolean }) {
  const pro = useRemote((s) => s.hall?.simple === null);
  const justPlaylists = playlistsOnly || !pro;
  const [tab, setTab] = useState<Tab>('playlists');
  const [undo, setUndo] = useState<Undo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void loadPlaylists();
  }, []);
  useEffect(() => {
    if (!pro) return;
    void loadLibrary();
    void loadMedia();
  }, [pro]);
  const deleted = (words: string, path: string, ids: string[], then: () => Promise<void>) => {
    setUndo({ words, path, ids, then });
  };
  return (
    <PhoneSheet
      title={justPlaylists ? 'Manage playlists' : 'Change the library'}
      subtitle={justPlaylists ? undefined : 'The Drashti computer’s playlists and presentations'}
      testId="remote-library-sheet"
      onClose={closeSheet}
    >
      {problem && (
        <Notice tone="warning" data-testid="remote-library-problem" onDismiss={() => setProblem(null)}>
          {problem}
        </Notice>
      )}
      {undo && (pro || !undo.path.startsWith('/api/v1/presentations/')) && (
        <Notice tone="info" data-testid="remote-library-undo-notice" onDismiss={() => setUndo(null)}>
          <span className="flex flex-wrap items-center gap-2">
            <span>{undo.words}</span>
            <Button
              size="lg"
              className="min-h-12"
              icon={Undo2}
              data-testid="remote-library-undo"
              onClick={() =>
                void send(undo.path, { ids: undo.ids }, setProblem).then(async (back) => {
                  if (back === null) return;
                  setUndo(null);
                  await undo.then();
                })
              }
            >
              Undo
            </Button>
          </span>
        </Notice>
      )}
      {!justPlaylists && (
        <div role="group" aria-label="Which to change" className="grid grid-cols-2 gap-2">
          {(['playlists', 'presentations'] as const).map((t) => (
            <Button
              key={t}
              size="lg"
              className={cx('min-h-12 w-full', tab === t && 'ring-2 ring-accent')}
              variant={tab === t ? 'strong' : 'secondary'}
              aria-pressed={tab === t}
              data-testid={`remote-library-tab-${t}`}
              onClick={() => {
                setTab(t);
              }}
            >
              {t === 'playlists' ? 'Playlists' : 'Presentations'}
            </Button>
          ))}
        </div>
      )}
      {justPlaylists || tab === 'playlists' ? (
        <Playlists say={setProblem} deleted={deleted} />
      ) : (
        <Presentations say={setProblem} deleted={deleted} />
      )}
    </PhoneSheet>
  );
}

type Say = (problem: string | null) => void;
type Deleted = (words: string, path: string, ids: string[], then: () => Promise<void>) => void;

/** What the phone says before deleting a playlist or folder that needs confirmation. */
function deleteReason(node: PlaylistNode): string | null {
  if (node.isFolder) return 'This also deletes the playlists and folders inside it.';
  const state = useEngine.getState().state;
  if (state?.repeat?.playlistId === node.id) return 'This Repeat Slides playlist is going round.';
  if (state?.live.playlist?.playlistId === node.id) return 'This playlist is on the screens.';
  if (useRemote.getState().hall?.simple?.playlistId === node.id)
    return 'This playlist is open on the Drashti computer.';
  return null;
}

/** Create, rename or delete playlists and folders, and change the open playlist's rows. */
function Playlists({ say, deleted }: { say: Say; deleted: Deleted }) {
  const playlists = useRemote((s) => s.playlists);
  const open = useRemote((s) => s.playlistId);
  const paths = useMemo(() => playlistPaths(playlists ?? []), [playlists]);
  const folders = (playlists ?? []).filter((p) => p.isFolder);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'playlist' | 'folder'>('playlist');
  const [parent, setParent] = useState('');
  const parentId = folders.some((folder) => folder.id === parent) ? parent : '';
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [removing, setRemoving] = useState<{ node: PlaylistNode; reason: string } | null>(null);
  const isFolder = kind === 'folder';

  async function remove(node: PlaylistNode): Promise<void> {
    const wasOpen = useRemote.getState().playlistId;
    const ids = await send('/api/v1/playlists/delete', { ids: [node.id] }, say);
    if (!ids?.length) return;
    await loadPlaylists();
    const fallback = useRemote.getState().playlistId;
    deleted(`“${node.name}” was deleted.`, '/api/v1/playlists/restore', ids, async () => {
      await loadPlaylists();
      if (wasOpen !== null && ids.includes(wasOpen) && useRemote.getState().playlistId === fallback) {
        await showPlaylist(wasOpen);
      }
    });
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-2 rounded-lg border border-line bg-panel p-3"
        data-testid="remote-library-new-playlist"
        onSubmit={(e) => {
          e.preventDefault();
          void send('/api/v1/playlists/new', { name, parentId: parentId || null, isFolder }, say).then(
            async (ids) => {
              if (ids === null) return;
              setName('');
              await loadPlaylists();
              if (!isFolder && ids[0]) await showPlaylist(ids[0]);
            },
          );
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={LABEL_WORDS}>Create</span>
            <select
              className={FIELD}
              value={kind}
              data-testid="remote-library-new-playlist-kind"
              onChange={(e) => setKind(e.target.value === 'folder' ? 'folder' : 'playlist')}
            >
              <option value="playlist">Playlist</option>
              <option value="folder">Folder</option>
            </select>
          </label>
          {folders.length > 0 && (
            <label className="block space-y-1">
              <span className={LABEL_WORDS}>Put it in</span>
              <select
                className={FIELD}
                value={parentId}
                data-testid="remote-library-new-playlist-parent"
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">Top level</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {paths.get(folder.id) ?? folder.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label className="block space-y-1">
          <span className={LABEL_WORDS}>{isFolder ? 'A new folder’s name' : 'A new playlist’s name'}</span>
          <input
            className={FIELD}
            value={name}
            maxLength={200}
            data-testid="remote-library-new-playlist-name"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <Button type="submit" size="lg" className="min-h-12 w-full" icon={Plus} disabled={name.trim() === ''}>
          {isFolder ? 'Make the folder' : 'Make the playlist'}
        </Button>
      </form>
      {playlists === null ? (
        <p className="text-base text-muted">Reading the playlists…</p>
      ) : (
        <ul className="space-y-2" aria-label="Playlists" data-testid="remote-library-playlists">
          {playlists.map((p) => (
            <li
              key={p.id}
              className={cx(
                'space-y-2 rounded-lg border p-2',
                p.id === open ? 'border-accent' : 'border-line',
              )}
              data-testid="remote-library-playlist"
              data-playlist-id={p.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                {p.isFolder ? (
                  <span className="min-w-0 flex-1 break-words text-base text-fg">
                    {paths.get(p.id) ?? p.name} · Folder
                  </span>
                ) : (
                  <Button
                    size="lg"
                    wrap
                    className="min-h-12 min-w-0 flex-1 justify-start"
                    aria-pressed={p.id === open}
                    data-testid="remote-library-playlist-open"
                    onClick={() => void showPlaylist(p.id)}
                  >
                    {paths.get(p.id) ?? p.name}
                    {p.kind === 'smart' ? ' · Smart playlist' : ''}
                  </Button>
                )}
                <Button
                  size="lg"
                  className="min-h-12"
                  icon={Pencil}
                  aria-label={`Rename “${p.name}”`}
                  data-testid="remote-library-playlist-rename"
                  onClick={() => {
                    setRenaming(renaming === p.id ? null : p.id);
                    setNewName(p.name);
                  }}
                />
                <Button
                  size="lg"
                  variant="danger"
                  className="min-h-12"
                  icon={Trash2}
                  aria-label={`Delete “${p.name}”`}
                  data-testid="remote-library-playlist-delete"
                  onClick={() => {
                    const reason = deleteReason(p);
                    if (reason !== null) setRemoving({ node: p, reason });
                    else void remove(p);
                  }}
                />
              </div>
              {renaming === p.id && (
                <form
                  className="flex gap-2"
                  data-testid="remote-library-rename-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(
                      `/api/v1/playlists/${encodeURIComponent(p.id)}/rename`,
                      { name: newName },
                      say,
                    ).then(async (ids) => {
                      if (ids === null) return;
                      setRenaming(null);
                      await loadPlaylists();
                    });
                  }}
                >
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Its new name</span>
                    <input
                      className={FIELD}
                      value={newName}
                      maxLength={200}
                      data-testid="remote-library-rename-name"
                      onChange={(e) => {
                        setNewName(e.target.value);
                      }}
                    />
                  </label>
                  <Button type="submit" size="lg" className="min-h-12" disabled={newName.trim() === ''}>
                    Rename
                  </Button>
                </form>
              )}
              {!p.isFolder && p.id === open && <Items playlistId={p.id} say={say} deleted={deleted} />}
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <PhoneQuestion
          title={`Delete “${removing.node.name}”?`}
          safe="Cancel"
          act="Delete"
          testId="remote-library-playlist-delete-confirm"
          onSafe={() => setRemoving(null)}
          onAct={() => {
            setRemoving(null);
            void remove(removing.node);
          }}
        >
          <p>{removing.reason} You can undo this.</p>
        </PhoneQuestion>
      )}
    </div>
  );
}

/** The open playlist's items can be moved or taken out with Undo. */
function Items({ playlistId, say, deleted }: { playlistId: string; say: Say; deleted: Deleted }) {
  const items = useRemote((s) => (s.playlistId === playlistId ? s.items : null));
  const pro = useRemote((s) => s.hall?.simple === null);
  const [removing, setRemoving] = useState<PlaylistItemInfo | null>(null);
  const again = () => refreshPlaylist(playlistId);
  const movePath = `/api/v1/playlists/${encodeURIComponent(playlistId)}/move`;
  if (items === null) return <p className="text-base text-muted">Reading its items…</p>;

  async function remove(item: PlaylistItemInfo): Promise<void> {
    const ids = await send('/api/v1/playlist-items/delete', { ids: [item.id] }, say);
    if (!ids?.length) return;
    deleted(`“${item.label}” was taken out.`, '/api/v1/playlist-items/restore', ids, again);
    await again();
  }
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-base text-muted">Nothing in it yet.</p>
      ) : (
        <ol className="space-y-2" aria-label="Its items" data-testid="remote-library-items">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-2"
              data-testid="remote-library-item"
              data-item-id={item.id}
            >
              <span className="min-w-0 flex-1 text-base text-fg">{item.label}</span>
              <Button
                size="lg"
                className="min-h-12"
                icon={ArrowUp}
                aria-label={`Move “${item.label}” up`}
                disabled={index === 0}
                data-testid="remote-library-item-up"
                onClick={() =>
                  void send(movePath, { ids: [item.id], to: index - 1 }, say).then((ids) =>
                    ids === null ? undefined : again(),
                  )
                }
              />
              <Button
                size="lg"
                className="min-h-12"
                icon={ArrowDown}
                aria-label={`Move “${item.label}” down`}
                disabled={index === items.length - 1}
                data-testid="remote-library-item-down"
                onClick={() =>
                  void send(movePath, { ids: [item.id], to: index + 1 }, say).then((ids) =>
                    ids === null ? undefined : again(),
                  )
                }
              />
              <Button
                size="lg"
                variant="danger"
                className="min-h-12"
                icon={Trash2}
                aria-label={`Take “${item.label}” out`}
                data-testid="remote-library-item-remove"
                onClick={() => {
                  const live = useEngine.getState().state?.live.playlist?.itemId;
                  if (live === item.id) setRemoving(item);
                  else void remove(item);
                }}
              />
            </li>
          ))}
        </ol>
      )}
      {pro && <AddFromLibrary playlistId={playlistId} say={say} />}
      {removing && (
        <PhoneQuestion
          title={`Take “${removing.label}” out of the playlist?`}
          safe="Cancel"
          act="Take it out"
          testId="remote-library-item-delete-confirm"
          onSafe={() => setRemoving(null)}
          onAct={() => {
            setRemoving(null);
            void remove(removing);
          }}
        >
          <p>This item is on the screens. You can undo taking it out.</p>
        </PhoneQuestion>
      )}
    </div>
  );
}

function AddFromLibrary({ playlistId, say }: { playlistId: string; say: Say }) {
  const { list: library, total: libraryTotal } = useRemote((s) => s.library);
  const { list: media, total: mediaTotal, query: mediaQuery } = useMirror((s) => s.media);
  const [adding, setAdding] = useState('');
  const path = `/api/v1/playlists/${encodeURIComponent(playlistId)}/add`;
  const choices = [
    ...(library ?? []).map((p) => ({ value: `presentation:${p.id}`, label: p.name })),
    ...(media ?? []).filter((m) => !m.missing).map((m) => ({ value: `media:${m.id}`, label: m.name })),
  ];
  return (
    <>
      <form
        className="flex flex-wrap gap-2"
        data-testid="remote-library-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          const [kind, id] = adding.split(/:(.*)/su);
          if (!id) return;
          const item =
            kind === 'media' ? { kind: 'media', mediaId: id } : { kind: 'presentation', presentationId: id };
          void send(path, { items: [item] }, say).then(async (ids) => {
            if (ids === null) return;
            setAdding('');
            await refreshPlaylist(playlistId);
          });
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Add to this playlist</span>
          <select
            className={FIELD}
            value={adding}
            data-testid="remote-library-add-choice"
            onChange={(e) => {
              setAdding(e.target.value);
            }}
          >
            <option value="">Add a presentation or a file…</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="lg" className="min-h-12" icon={Plus} disabled={adding === ''}>
          Add
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {library && library.length < libraryTotal && (
          <Button size="lg" variant="ghost" className="min-h-12" onClick={() => void loadLibrary(true)}>
            More presentations
          </Button>
        )}
        {mediaQuery && (
          <Button
            size="lg"
            variant="ghost"
            className="min-h-12"
            onClick={() => void loadMedia({ query: '' })}
          >
            Show all files
          </Button>
        )}
        {media && media.length < mediaTotal && (
          <Button
            size="lg"
            variant="ghost"
            className="min-h-12"
            onClick={() => void loadMedia({ more: true })}
          >
            More files
          </Button>
        )}
      </div>
    </>
  );
}

/** The presentations: one made from words, and one deleted (with Undo). */
function Presentations({ say, deleted }: { say: Say; deleted: Deleted }) {
  const library = useRemote((s) => s.library);
  const [name, setName] = useState('');
  const [words, setWords] = useState('');
  return (
    <div className="space-y-4">
      <form
        className="space-y-2 rounded-lg border border-line bg-panel p-3"
        data-testid="remote-library-new-presentation"
        onSubmit={(e) => {
          e.preventDefault();
          void send('/api/v1/presentations/new', { name, words }, say).then(async (ids) => {
            if (ids === null) return;
            setName('');
            setWords('');
            await loadLibrary();
          });
        }}
      >
        <label className="block space-y-1">
          <span className={LABEL_WORDS}>A new presentation’s name</span>
          <input
            className={FIELD}
            value={name}
            maxLength={200}
            data-testid="remote-library-new-presentation-name"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label className="block space-y-1">
          <span className={LABEL_WORDS}>Its words (a blank line between slides)</span>
          <textarea
            className="min-h-32 w-full rounded-lg border border-field bg-panel-3 p-3 text-base text-fg"
            value={words}
            data-testid="remote-library-new-presentation-words"
            onChange={(e) => {
              setWords(e.target.value);
            }}
          />
        </label>
        <Button
          type="submit"
          size="lg"
          className="min-h-12 w-full"
          icon={Plus}
          disabled={name.trim() === '' || words.trim() === ''}
        >
          Make the presentation
        </Button>
      </form>
      {library.list === null ? (
        <p className="text-base text-muted">Reading the library…</p>
      ) : (
        <ul className="space-y-2" aria-label="Presentations" data-testid="remote-library-presentations">
          {library.list.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2"
              data-testid="remote-library-presentation"
              data-presentation-id={p.id}
            >
              <span className="min-w-0 flex-1 text-base text-fg">{p.name}</span>
              <Button
                size="lg"
                variant="danger"
                className="min-h-12"
                icon={Trash2}
                aria-label={`Delete “${p.name}”`}
                data-testid="remote-library-presentation-delete"
                onClick={() =>
                  void send('/api/v1/presentations/delete', { ids: [p.id] }, say).then(async (ids) => {
                    if (ids === null) return;
                    deleted(`“${p.name}” was deleted.`, '/api/v1/presentations/restore', ids, loadLibrary);
                    await loadLibrary();
                  })
                }
              />
            </li>
          ))}
          {library.list.length < library.total && (
            <li>
              <Button size="lg" className="min-h-12 w-full" onClick={() => void loadLibrary(true)}>
                More
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
