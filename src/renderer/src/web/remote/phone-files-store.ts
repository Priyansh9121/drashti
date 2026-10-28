import { create } from 'zustand';
import type { AddFilesView, SharedPlaylist } from '../../../../shared/phone-files';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { api } from '../device';
import { oneAtATime } from '../one-at-a-time';
import { onListsChanged, onOnline } from '../feed';
import { closeViewer, useViewer, type ViewerPage } from '../viewer/viewer-store';
import { useMirror } from './mirror-store';
import { type Sending, sendFile } from './upload-client';
import { deviceTransport } from './upload-transport';

/*
 * Files between Drashti and this phone, as the remote shows them (Session 54, D3 and D4): the playlists Drashti
 * shares with phones ("Shared from Drashti"), the one opened and the file being opened in D1's viewer (which closes
 * once its playlist is no longer shared); whether Drashti takes files from phones now; and the files this page is
 * sending, one after another. Read again when Drashti says the playlists or adding files changed, and when the feed
 * comes back.
 */

interface PhoneFilesView {
  /** The shared playlists, in the order they were shared; null until read. */
  shared: SharedPlaylist[] | null;
  /** The shared playlist whose items are shown, and its items (null while they are read). */
  open: { id: string; items: PlaylistItemInfo[] | null } | null;
  /** Whether Drashti takes files from phones now, and how large; null until read. */
  adding: AddFilesView | null;
  /** The files this page is sending or has sent, newest first. */
  sending: Sending[];
  /** The item of the open playlist being opened on this device (its presentations read first), by its id. */
  opening: string | null;
  /** The item that could not be opened (its presentation gone), by its label: said under the list. */
  notOpened: string | null;
}

export const usePhoneFiles = create<PhoneFilesView>(() => ({
  shared: null,
  open: null,
  adding: null,
  sending: [],
  opening: null,
  notOpened: null,
}));

/** The shared playlist whose files D1's viewer was opened with, and those pages. */
let looking: { playlistId: string; pages: readonly ViewerPage[] } | null = null;

/** D1's viewer shows this shared playlist's files now (shared-pages.ts). */
export function lookingAt(playlistId: string, pages: readonly ViewerPage[]): void {
  looking = { playlistId, pages };
}

/** A playlist no longer shared: its files close on this device, if the viewer still shows them. */
function stopLooking(playlistId: string): void {
  if (looking?.playlistId !== playlistId) return;
  if (useViewer.getState().pages === looking.pages) closeViewer();
  looking = null;
}

/** At most this many files' rows are kept on the page (the newest). */
const ROWS = 20;

/** The playlists shared with phones, one read at a time however often Drashti says they changed. */
export const loadShared = oneAtATime(readShared);

async function readShared(): Promise<void> {
  const r = await api<{ playlists: SharedPlaylist[] }>('/api/v1/shared');
  if (!r.ok) return;
  usePhoneFiles.setState({ shared: r.playlists });
  // Nothing shared: the library's Shared from Drashti goes, back to Presentations, never chosen again by itself.
  if (r.playlists.length === 0 && useMirror.getState().libraryKind === 'shared')
    useMirror.setState({ libraryKind: 'presentations' });
  // Its files looked at here close once it is no longer shared.
  const lookedAt = looking?.playlistId;
  if (lookedAt !== undefined && !r.playlists.some((p) => p.id === lookedAt)) stopLooking(lookedAt);
  const open = usePhoneFiles.getState().open;
  if (!open) return;
  // The one open is read again; no longer shared, it closes.
  if (r.playlists.some((p) => p.id === open.id)) void openShared(open.id);
  else usePhoneFiles.setState({ open: null, opening: null, notOpened: null });
}

/** Show a shared playlist's items (or, with null, the shared playlists again). */
export async function openShared(id: string | null): Promise<void> {
  if (id === null) {
    usePhoneFiles.setState({ open: null, opening: null, notOpened: null });
    return;
  }
  const was = usePhoneFiles.getState().open;
  // Another playlist: what was being opened, or could not be, was the one before's.
  usePhoneFiles.setState(
    was?.id === id
      ? { open: { id, items: was.items } }
      : { open: { id, items: null }, opening: null, notOpened: null },
  );
  const r = await api<{ items: PlaylistItemInfo[] }>(`/api/v1/shared/${encodeURIComponent(id)}/items`);
  if (usePhoneFiles.getState().open?.id !== id) return;
  if (r.ok) usePhoneFiles.setState({ open: { id, items: r.items } });
  else if (r.status === 404) {
    usePhoneFiles.setState({ open: null, opening: null, notOpened: null });
    stopLooking(id);
  }
}

async function loadAdding(): Promise<void> {
  const r = await api<{ adding: AddFilesView }>('/api/v1/uploads');
  if (r.ok) usePhoneFiles.setState({ adding: r.adding });
}

// ---- sending files -------------------------------------------------------------------------------

const queue: { key: string; file: File }[] = [];
const cancels = new Map<string, () => void>();
let made = 0;
let busy = false;

function changed(sending: Sending): void {
  usePhoneFiles.setState((s) => ({ sending: s.sending.map((x) => (x.key === sending.key ? sending : x)) }));
}

async function sendInTurn(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const job = sendFile(next.file, deviceTransport, next.key, changed);
      cancels.set(next.key, job.cancel);
      await job.done;
      cancels.delete(next.key);
    }
  } finally {
    busy = false;
  }
}

/** Files chosen on this phone: sent whole, one after another, each with its own row. */
export function addFiles(files: readonly File[]): void {
  const rows: Sending[] = files.map((file) => {
    const key = `file-${String(++made)}`;
    queue.push({ key, file });
    return {
      key,
      name: file.name,
      size: file.size,
      sent: 0,
      state: 'starting',
      message: 'Waiting its turn…',
      slowed: false,
    };
  });
  usePhoneFiles.setState((s) => ({ sending: [...rows.reverse(), ...s.sending].slice(0, ROWS) }));
  void sendInTurn();
}

/** Cancel a file: one still waiting its turn never goes; one going stops at once. */
export function cancelSending(key: string): void {
  const waiting = queue.findIndex((q) => q.key === key);
  if (waiting >= 0) {
    queue.splice(waiting, 1);
    usePhoneFiles.setState((s) => ({
      sending: s.sending.map((x) =>
        x.key === key ? { ...x, state: 'cancelled' as const, message: 'Cancelled.' } : x,
      ),
    }));
    return;
  }
  cancels.get(key)?.();
}

let started = false;

/** Read what is shared and whether adding is on, and again whenever Drashti says they changed. */
export function startPhoneFiles(): void {
  if (started) return;
  started = true;
  onOnline(() => {
    void loadShared();
    void loadAdding();
  });
  onListsChanged((what) => {
    if (what === 'playlists' || what === 'presentations') void loadShared();
    if (what === 'files') void loadAdding();
  });
  void loadShared();
  void loadAdding();
}
