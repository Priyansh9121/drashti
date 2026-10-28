import { useEffect, useState } from 'react';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Undo2 } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { api } from '../device';
import { closeSheet } from './desktop-store';
import { loadMedia, useMirror } from './mirror-store';
import { PhoneSheet } from './PhoneSheet';
import { loadLibrary, loadPlaylists, showPlaylist, useRemote } from './remote-store';

/*
 * The library's changes from a phone (Session 54, the phone as a full Drashti), as the operator window makes them
 * on the Drashti computer: a presentation made from words; a presentation or a playlist deleted, with its Undo, as
 * the window's; a playlist made or renamed; and in a playlist, a presentation or one of Media's files added (by its
 * id), items moved up or down and taken out, with Undo. Pro Mode's: in Simple Mode Drashti refuses them, and says so
 * here. The lists are the remote's own, read again after each change.
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

export function LibrarySheet() {
  const [tab, setTab] = useState<Tab>('playlists');
  const [undo, setUndo] = useState<Undo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void loadPlaylists();
    void loadLibrary();
    void loadMedia();
  }, []);
  const deleted = (words: string, path: string, ids: string[], then: () => Promise<void>) => {
    setUndo({ words, path, ids, then });
  };
  return (
    <PhoneSheet
      title="Change the library"
      subtitle="The Drashti computer’s playlists and presentations"
      testId="remote-library-sheet"
      onClose={closeSheet}
    >
      {problem && (
        <Notice tone="warning" data-testid="remote-library-problem" onDismiss={() => setProblem(null)}>
          {problem}
        </Notice>
      )}
      {undo && (
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
      {tab === 'playlists' ? (
        <Playlists say={setProblem} deleted={deleted} />
      ) : (
        <Presentations say={setProblem} deleted={deleted} />
      )}
    </PhoneSheet>
  );
}

type Say = (problem: string | null) => void;
type Deleted = (words: string, path: string, ids: string[], then: () => Promise<void>) => void;

/** The playlists: one made, renamed or deleted; and the open one's items added to, moved and taken out. */
function Playlists({ say, deleted }: { say: Say; deleted: Deleted }) {
  const playlists = useRemote((s) => s.playlists);
  const open = useRemote((s) => s.playlistId);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  return (
    <div className="space-y-4">
      <form
        className="space-y-2 rounded-lg border border-line bg-panel p-3"
        data-testid="remote-library-new-playlist"
        onSubmit={(e) => {
          e.preventDefault();
          void send('/api/v1/playlists/new', { name }, say).then(async (ids) => {
            if (ids === null) return;
            setName('');
            await loadPlaylists();
            if (ids[0]) await showPlaylist(ids[0]);
          });
        }}
      >
        <label className="block space-y-1">
          <span className={LABEL_WORDS}>A new playlist’s name</span>
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
          Make the playlist
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
                <Button
                  size="lg"
                  wrap
                  className="min-h-12 min-w-0 flex-1 justify-start"
                  aria-pressed={p.id === open}
                  data-testid="remote-library-playlist-open"
                  onClick={() => void showPlaylist(p.id)}
                >
                  {p.name}
                </Button>
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
                  onClick={() =>
                    void send('/api/v1/playlists/delete', { ids: [p.id] }, say).then(async (ids) => {
                      if (ids === null) return;
                      deleted(`“${p.name}” was deleted.`, '/api/v1/playlists/restore', ids, loadPlaylists);
                      await loadPlaylists();
                    })
                  }
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
              {p.id === open && <Items playlistId={p.id} say={say} deleted={deleted} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The open playlist's items: moved up or down, taken out (with Undo), and a presentation or a file added. */
function Items({ playlistId, say, deleted }: { playlistId: string; say: Say; deleted: Deleted }) {
  const items = useRemote((s) => (s.playlistId === playlistId ? s.items : null));
  const library = useRemote((s) => s.library.list);
  const media = useMirror((s) => s.media.list);
  const [adding, setAdding] = useState('');
  const again = () => showPlaylist(playlistId);
  const path = (what: string) => `/api/v1/playlists/${encodeURIComponent(playlistId)}/${what}`;
  if (items === null) return <p className="text-base text-muted">Reading its items…</p>;
  const choices = [
    ...(library ?? []).map((p) => ({ value: `presentation:${p.id}`, label: p.name })),
    ...(media ?? []).filter((m) => !m.missing).map((m) => ({ value: `media:${m.id}`, label: m.name })),
  ];
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
                  void send(path('move'), { ids: [item.id], to: index - 1 }, say).then((ids) =>
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
                  void send(path('move'), { ids: [item.id], to: index + 1 }, say).then((ids) =>
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
                onClick={() =>
                  void send('/api/v1/playlist-items/delete', { ids: [item.id] }, say).then(async (ids) => {
                    if (ids === null) return;
                    deleted(`“${item.label}” was taken out.`, '/api/v1/playlist-items/restore', ids, again);
                    await again();
                  })
                }
              />
            </li>
          ))}
        </ol>
      )}
      <form
        className="flex flex-wrap gap-2"
        data-testid="remote-library-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          const [kind, id] = adding.split(/:(.*)/su);
          if (!id) return;
          const item =
            kind === 'media' ? { kind: 'media', mediaId: id } : { kind: 'presentation', presentationId: id };
          void send(path('add'), { items: [item] }, say).then(async (ids) => {
            if (ids === null) return;
            setAdding('');
            await again();
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
    </div>
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
