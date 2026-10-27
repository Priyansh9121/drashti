import { create } from 'zustand';
import type { AddFilesView, SharedPlaylist } from '../../../../shared/phone-files';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { api } from '../device';
import { onListsChanged, onOnline } from '../feed';
import { type Sending, sendFile } from './upload-client';
import { deviceTransport } from './upload-transport';

/*
 * Files between Drashti and this phone, as the remote shows them (Session 54, D3 and D4): the playlists Drashti
 * shares with phones ("Shared from Drashti"), the one opened and the item looked at on this device; whether Drashti
 * takes files from phones now; and the files this page is sending, one after another. Read again when Drashti says
 * the playlists or adding files changed, and when the feed comes back.
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
  /** An item of the open playlist looked at on this device, full size: the items it steps through, and which. */
  viewing: { items: PlaylistItemInfo[]; index: number } | null;
}

export const usePhoneFiles = create<PhoneFilesView>(() => ({
  shared: null,
  open: null,
  adding: null,
  sending: [],
  viewing: null,
}));

/** At most this many files' rows are kept on the page (the newest). */
const ROWS = 20;

export async function loadShared(): Promise<void> {
  const r = await api<{ playlists: SharedPlaylist[] }>('/api/v1/shared');
  if (!r.ok) return;
  usePhoneFiles.setState({ shared: r.playlists });
  const open = usePhoneFiles.getState().open;
  if (!open) return;
  // The one open is read again; no longer shared, it closes.
  if (r.playlists.some((p) => p.id === open.id)) void openShared(open.id);
  else usePhoneFiles.setState({ open: null, viewing: null });
}

/** Show a shared playlist's items (or, with null, the shared playlists again). */
export async function openShared(id: string | null): Promise<void> {
  if (id === null) {
    usePhoneFiles.setState({ open: null });
    return;
  }
  const was = usePhoneFiles.getState().open;
  usePhoneFiles.setState({ open: { id, items: was?.id === id ? was.items : null } });
  const r = await api<{ items: PlaylistItemInfo[] }>(`/api/v1/shared/${encodeURIComponent(id)}/items`);
  if (usePhoneFiles.getState().open?.id !== id) return;
  if (r.ok) usePhoneFiles.setState({ open: { id, items: r.items } });
  else if (r.status === 404) usePhoneFiles.setState({ open: null, viewing: null });
}

/** Look at an item on this device, full size; stepping goes through `items`. */
export function viewItem(items: PlaylistItemInfo[], index: number): void {
  usePhoneFiles.setState({ viewing: { items, index } });
}

export function stepViewer(by: number): void {
  const v = usePhoneFiles.getState().viewing;
  if (!v) return;
  const index = Math.min(v.items.length - 1, Math.max(0, v.index + by));
  usePhoneFiles.setState({ viewing: { ...v, index } });
}

export function closeViewer(): void {
  usePhoneFiles.setState({ viewing: null });
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
