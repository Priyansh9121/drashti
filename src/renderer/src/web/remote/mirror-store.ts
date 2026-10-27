import { create } from 'zustand';
import type {
  RemoteKeys,
  RemoteLowerThird,
  RemoteMedia,
  RemoteMediaPage,
  RemoteMusic,
  RemoteProp,
} from '../../../../shared/network-mirror';
import { api } from '../device';
import { onListsChanged, onOnline } from '../feed';

/*
 * What the remote reads to mirror the operator window (Session 54, D5), besides remote-store.ts's: the library's
 * props, its pictures, videos and sounds, the lower thirds, the audio playlists, and the keys the window answers.
 * Read over the network as the window reads them, and again when Drashti says they changed. Nothing here changes
 * the library: each is put up and taken off (mirror-actions.ts).
 */

/**
 * What the library shows: its presentations, or its pictures, videos and sounds (the window's library sheet); or,
 * while a playlist is shared with phones, Shared from Drashti (D3, library-kinds.ts).
 */
export type LibraryKind = 'presentations' | 'media' | 'shared';

/** The library's media as the phone has read it: by name, a page at a time, or found by words. */
export interface MirrorMedia {
  /** The items listed so far (null until read), and how many match. */
  list: RemoteMedia[] | null;
  total: number;
  /** The words asked for ('' for every one). */
  query: string;
}

interface MirrorView {
  libraryKind: LibraryKind;
  keys: RemoteKeys | null;
  props: RemoteProp[] | null;
  media: MirrorMedia;
  lowerThirds: RemoteLowerThird[] | null;
  music: RemoteMusic[] | null;
}

export const useMirror = create<MirrorView>(() => ({
  libraryKind: 'presentations',
  keys: null,
  props: null,
  media: { list: null, total: 0, query: '' },
  lowerThirds: null,
  music: null,
}));

export async function loadKeys(): Promise<void> {
  const r = await api<{ keys: RemoteKeys }>('/api/v1/keys');
  if (r.ok) useMirror.setState({ keys: r.keys });
}

export async function loadProps(): Promise<void> {
  const r = await api<{ props: RemoteProp[] }>('/api/v1/props');
  if (r.ok) useMirror.setState({ props: r.props });
}

export async function loadLowerThirds(): Promise<void> {
  const r = await api<{ lowerThirds: RemoteLowerThird[] }>('/api/v1/lower-thirds');
  if (r.ok) useMirror.setState({ lowerThirds: r.lowerThirds });
}

export async function loadMusic(): Promise<void> {
  const r = await api<{ playlists: RemoteMusic[] }>('/api/v1/music');
  if (r.ok) useMirror.setState({ music: r.playlists });
}

/**
 * The media whose names hold the words asked for (all of them for none): the first page, or the next one after
 * those listed. An answer to words no longer asked for is let go.
 */
export async function loadMedia(options: { more?: boolean; query?: string } = {}): Promise<void> {
  const before = useMirror.getState().media;
  const query = (options.query ?? before.query).trim();
  const more = options.more === true && query === before.query;
  const offset = more ? (before.list?.length ?? 0) : 0;
  if (!more)
    useMirror.setState({ media: { ...before, query, list: query === before.query ? before.list : null } });
  const r = await api<RemoteMediaPage>(
    `/api/v1/media?offset=${String(offset)}${query === '' ? '' : `&q=${encodeURIComponent(query)}`}`,
  );
  const now = useMirror.getState().media;
  if (!r.ok || now.query !== query) return;
  const list = more ? [...(now.list ?? []).slice(0, offset), ...r.media] : r.media;
  useMirror.setState({ media: { list, total: r.total, query } });
}

let started = false;

/** Read them when the feed is (back) online, and again when Drashti says they changed. */
export function startMirror(): void {
  if (started) return;
  started = true;
  onOnline(() => {
    void loadKeys();
    void loadProps();
    void loadLowerThirds();
    void loadMusic();
    // The media once they have been shown (a library can hold thousands).
    if (useMirror.getState().media.list) void loadMedia();
  });
  onListsChanged((what) => {
    if (what === 'keys') void loadKeys();
    if (what === 'props') void loadProps();
    if (what === 'lowerThirds') void loadLowerThirds();
    // A folder's sounds follow its playlist into Audio (Session 44); an import can bring sounds.
    if (what === 'music' || what === 'playlists' || what === 'presentations') void loadMusic();
    // The library changed (an import, a file deleted or found): Media again, if it was read.
    if (what === 'presentations' && useMirror.getState().media.list) void loadMedia();
  });
}
