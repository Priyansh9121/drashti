import { useEffect, useId, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { create } from 'zustand';
import type { NewItem } from '../../../shared/playlists';
import { useLibrary, useMedia } from '../library/library-store';
import { useNotice } from '../operator/actions';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { fileName, withoutEnding } from './drop-names';
import { droppedItems, fromLibrary } from './playlist-shared';
import { addFromLibrary, importIntoPlaylist, loadTree, openPlaylist, usePlaylists } from './playlist-store';

/*
 * Files dropped where no playlist is open (Session 60, x36; the owner, 19 Nov 2026: "when dragging a video in the empty
 * screen, it should create a new playlist/folder which should be prompted, a small window -> create a folder or
 * playlist and then the video is saved in that particular playlist or folder"; his answers to D1-D4, "Yes, all A"):
 * a small window asks where they go. A new playlist (chosen to begin with) or a new folder, named here; a new folder
 * holds a new playlist named after the first file (a folder holds playlists, never files). Create (Enter) makes it,
 * opens the new playlist in the middle and brings the files in there, in the order dragged; Cancel (Esc) brings
 * nothing in. Whatever a playlist takes, one or several, dropped from the Finder or Explorer anywhere on the window
 * while no playlist is open, and Media's rows dragged from the library onto the middle or the playlists column; the
 * same in Simple Mode. Unchanged: a drop on a playlist's name, on the open library, the wallpapers or Audio, a folder
 * (a smart playlist at once), and any drop while a playlist is open (into it).
 */

/** What was dropped: files from the computer, or the library's own rows. */
type Dropped = { kind: 'files'; paths: string[] } | { kind: 'library'; items: NewItem[] };

interface Asking {
  dropped: Dropped;
  /** What the window says of them: “Placeholder clip.mp4”, or "2 files". */
  what: string;
  /** The first one's name, without its ending: the new playlist's name to begin with. */
  first: string;
}

const useDropNew = create<{ asking: Asking | null }>(() => ({ asking: null }));

/** A library row's name, as the library shows it; null when it cannot be told. */
function nameOf(item: NewItem): string | null {
  if (item.kind === 'media')
    return useMedia.getState().media.find((m) => m.id === item.mediaId)?.name ?? null;
  if (item.kind === 'presentation')
    return useLibrary.getState().presentations.find((p) => p.id === item.presentationId)?.name ?? null;
  if (item.kind === 'input') return item.name;
  return null;
}

/** Files dropped with no playlist open: the window asks where they go. */
export function askWhereFilesGo(paths: readonly string[]): void {
  if (paths.length === 0) return;
  const first = fileName(paths[0] ?? '');
  useDropNew.setState({
    asking: {
      dropped: { kind: 'files', paths: [...paths] },
      what: paths.length === 1 ? `“${first}”` : `${String(paths.length)} files`,
      first: withoutEnding(first),
    },
  });
}

/** The library's rows dropped with no playlist open: the window asks where they go. */
export function askWhereItemsGo(items: readonly NewItem[]): void {
  const first = items[0];
  if (first === undefined) return;
  const name = nameOf(first);
  useDropNew.setState({
    asking: {
      dropped: { kind: 'library', items: [...items] },
      what: items.length === 1 ? (name !== null ? `“${name}”` : 'it') : `${String(items.length)} items`,
      first: name !== null ? withoutEnding(name) : 'New playlist',
    },
  });
}

/** Whether a drag of the library's rows is this window's to take: no playlist open, and nothing under it took it. */
const libraryRowsHere = (e: DragEvent): boolean =>
  !e.defaultPrevented && usePlaylists.getState().openId === null && fromLibrary(e);

/** Over the middle or the playlists column with no playlist open: the library's rows may be dropped here. */
export function libraryRowsOver(e: DragEvent): void {
  if (!libraryRowsHere(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}

/** The library's rows dropped on the middle or the playlists column with no playlist open: the window asks. */
export function libraryRowsDropped(e: DragEvent): void {
  if (!libraryRowsHere(e)) return;
  e.preventDefault();
  askWhereItemsGo(droppedItems(e));
}

function close(): void {
  useDropNew.setState({ asking: null });
}

type Home = 'playlist' | 'folder';

const CHOICES: readonly { home: Home; label: string; line: string }[] = [
  {
    home: 'playlist',
    label: 'A new playlist',
    line: 'The running order: Next puts its rows up one after another.',
  },
  {
    home: 'folder',
    label: 'A new folder',
    line: 'A folder holds playlists, to keep them together: Drashti makes one in it for these, named after the first.',
  },
];

/** Make it, open the new playlist and bring what was dropped in there; a problem said in the window's notice. */
async function makeHome(home: Home, name: string, asking: Asking): Promise<boolean> {
  const api = window.drashti.playlists;
  let parentId: string | null = null;
  if (home === 'folder') {
    const folder = await api.create(name, null, true);
    if (!folder.ok) {
      useNotice.setState({ text: folder.message });
      return false;
    }
    parentId = folder.ids[0] ?? null;
  }
  const made = await api.create(home === 'folder' ? asking.first : name, parentId, false);
  const id = made.ok ? made.ids[0] : undefined;
  if (!made.ok || id === undefined) {
    useNotice.setState({ text: made.ok ? 'Drashti couldn’t make the playlist.' : made.message });
    return false;
  }
  await loadTree();
  // Its folder open, so the new playlist shows in the list.
  usePlaylists.setState((s) => ({ closed: s.closed.filter((c) => c !== parentId) }));
  await openPlaylist(id);
  const { dropped } = asking;
  if (dropped.kind === 'files') void importIntoPlaylist(id, null, dropped.paths);
  else await addFromLibrary(id, null, dropped.items);
  return true;
}

function DropNewForm({ asking }: { asking: Asking }) {
  const [home, setHome] = useState<Home>('playlist');
  const [name, setName] = useState(asking.first);
  const [making, setMaking] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const formId = useId();
  // The name, ready to type over.
  useEffect(() => {
    field.current?.select();
  }, []);
  const named = name.trim();
  const create = async () => {
    if (named === '' || making) return;
    setMaking(true);
    const done = await makeHome(home, named, asking);
    if (done) close();
    else setMaking(false);
  };
  return (
    <Dialog
      title={`Put ${asking.what} in…`}
      subtitle="No playlist is open: make one for it here."
      onClose={close}
      testId="drop-new-dialog"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={named === '' || making}>
            Create
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Put it in</legend>
          {CHOICES.map((choice) => {
            const lineId = `${formId}-${choice.home}`;
            return (
              <div key={choice.home} className="rounded-lg border border-line p-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name={`${formId}-home`}
                    checked={home === choice.home}
                    aria-describedby={lineId}
                    onChange={() => {
                      setHome(choice.home);
                    }}
                  />
                  {choice.label}
                </label>
                <p id={lineId} className="pl-6 text-xs text-muted">
                  {choice.line}
                </p>
              </div>
            );
          })}
        </fieldset>
        <Field label="Name">
          <TextInput
            ref={field}
            data-autofocus
            value={name}
            maxLength={120}
            className="w-full"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** Mounted once in each mode's window; it asks only while something dropped waits for an answer. */
export function DropNewDialog() {
  const asking = useDropNew((s) => s.asking);
  return asking ? <DropNewForm asking={asking} /> : null;
}
