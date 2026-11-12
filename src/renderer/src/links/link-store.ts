import { create } from 'zustand';
import { kindRank, partsInFolderOrder } from '../../../shared/folder-order';
import type { ImportReport } from '../../../shared/import';
import { itemsMadeBy } from '../../../shared/import-items';
import {
  checkLink,
  DEFAULT_LINK_MAX_HEIGHT,
  linkKind,
  type LinkView,
  waitingKind,
} from '../../../shared/links';
import type { NewItem } from '../../../shared/playlists';
import { showImportFailures, showImportNotice } from '../library/import-notices';
import { importPaths, relinkMedia } from '../library/import-store';
import { addSoundsMade } from '../music/audio-actions';
import { nameAfter } from '../playlists/add-made';
import { importIntoPlaylist, loadTree, openPlaylist, usePlaylists } from '../playlists/playlist-store';
import { landInPlaylist, linkPlaylistId } from './link-playlist';

interface AudioTarget {
  playlistId: string | null;
}

interface LinkRequest {
  url: string;
  playlistId: string | null;
  audio: AudioTarget | null;
}

interface LinkStore {
  view: LinkView | null;
  open: boolean;
  audio: AudioTarget | null;
  request: LinkRequest | null;
}

export const useLinks = create<LinkStore>(() => ({
  view: null,
  open: false,
  audio: null,
  request: null,
}));

/** The download's title, or the file's name without its extension. */
export function newPlaylistName(view: LinkView | null): string {
  const look = view?.look;
  if (look?.shape === 'video' || look?.shape === 'folder') return look.name.trim();
  return nameAfter(look?.name ?? 'Download');
}

function playlistItems(view: LinkView, report: ImportReport): NewItem[] {
  if (!view.folderFiles?.length) return itemsMadeBy(report.items, report.paths);
  // Keep a folder's grouping even when it is appended to a playlist the operator has open.
  return partsInFolderOrder(
    view.folderFiles,
    (file) => file.relative,
    (path) => (waitingKind(path) ? 5 : kindRank(path)),
  ).flatMap((part): NewItem[] => {
    const items = itemsMadeBy(
      report.items,
      part.entries.map((entry) => entry.path),
    );
    if (items.length === 0 || part.title === '') return items;
    return [{ kind: 'header', label: part.title }, ...items];
  });
}

async function takeImported(view: LinkView, request: LinkRequest): Promise<void> {
  const runId = view.runId;
  if (!runId) return;
  const report = await window.drashti.library.getImportReport(runId);
  if (!report) return;

  const playlistId = view.playlist?.id ?? request.playlistId;
  const options = view.kind === 'dropbox' ? { maxVideoHeight: DEFAULT_LINK_MAX_HEIGHT } : undefined;
  const { audio } = request;
  const retry = (paths: string[]) =>
    audio
      ? importPaths(paths, options, (made) => addSoundsMade(audio.playlistId, made))
      : playlistId
        ? importIntoPlaylist(playlistId, null, paths, null, options)
        : importPaths(paths, options, null);
  showImportFailures(report, retry, relinkMedia);

  if (view.playlist) {
    await loadTree();
    await openPlaylist(view.playlist.id);
    return;
  }
  const items = playlistItems(view, report);
  if (request.audio) {
    await addSoundsMade(request.audio.playlistId, items);
    return;
  }
  if (items.length === 0) return;
  const add = async () => {
    if (usePlaylists.getState().unread.playlists) await loadTree();
    if (usePlaylists.getState().unread.playlists) {
      showImportNotice('Drashti couldn’t read the playlists. The download is in the library.', add);
      return;
    }
    const name = await landInPlaylist(
      request.playlistId
        ? { kind: 'playlist', id: request.playlistId }
        : { kind: 'new', name: newPlaylistName(view) },
      items,
    );
    if (!name) showImportNotice('Drashti couldn’t add the download to the playlist. Find it in the library.');
  };
  await add();
}

function heard(view: LinkView): void {
  const { request, view: previous } = useLinks.getState();
  useLinks.setState({ view });
  if (view.link !== request?.url) return;
  if (view.folderFallback && !previous?.folderFallback)
    showImportNotice(
      'The previous downloads folder couldn’t be used. Look in Drashti downloads when the download finishes.',
    );
  if (view.phase !== 'done' && view.phase !== 'failed' && view.phase !== 'stopped') return;
  useLinks.setState({ request: null });
  if (view.phase === 'stopped') return;
  for (const file of view.notTaken) showImportNotice(`“${file.name}”: ${file.reason}`);
  if (view.phase === 'failed') {
    showImportNotice(
      view.message ?? 'The download stopped. Try again.',
      view.saved === null && view.retryable ? () => start(request) : undefined,
    );
    return;
  }
  void takeImported(view, request).catch(() => {
    showImportNotice('Drashti could not read what the link brought in. Open the library to check.');
  });
}

let connected = false;

export function connectLinks(): void {
  if (connected) return;
  connected = true;
  window.drashti.links.onChanged(heard);
  window.drashti.links.onOpen(openLinkDialog);
  void window.drashti.links.view().then((view) => {
    if (useLinks.getState().view === null) useLinks.setState({ view });
  });
}

export function openLinkDialog(): void {
  connectLinks();
  useLinks.setState({ open: true, audio: null });
}

/** Pasting from Audio takes a YouTube video's sound and adds the imported sounds to Audio. */
export function openLinkForAudio(playlistId: string | null): void {
  connectLinks();
  useLinks.setState({ open: true, audio: { playlistId } });
}

export function closeLinkDialog(): void {
  useLinks.setState({ open: false, audio: null });
}

async function start(request: LinkRequest): Promise<boolean> {
  const { view, request: pending } = useLinks.getState();
  if (pending || linkBusy(view)) {
    showImportNotice('A link import is going on. Wait for it to finish, or stop it first.');
    return false;
  }
  useLinks.setState({ request });
  try {
    const result = await window.drashti.links.start(
      request.url,
      request.audio !== null,
      request.playlistId !== null,
    );
    if (result.ok) return true;
    showImportNotice(result.message);
  } catch {
    showImportNotice('Drashti could not start the download. Paste the link again.');
  }
  if (useLinks.getState().request === request) useLinks.setState({ request: null });
  return false;
}

/** Start at the paste, with the playlist open then as its destination. */
export async function importLink(text: string): Promise<boolean> {
  connectLinks();
  const kind = linkKind(text);
  if (kind === null) {
    showImportNotice('Paste a share link from YouTube or Dropbox.');
    return false;
  }
  const check = checkLink(kind, text);
  if (!check.ok) {
    showImportNotice(check.message);
    return false;
  }
  const { audio } = useLinks.getState();
  return start({ url: check.url, playlistId: audio ? null : linkPlaylistId(), audio });
}

export async function stopDownload(): Promise<void> {
  try {
    const result = await window.drashti.links.stop();
    if (!result.ok) showImportNotice(result.message);
  } catch {
    showImportNotice('Drashti could not stop the download. Try Stop again.');
  }
}

export const linkBusy = (view: LinkView | null): boolean =>
  view !== null &&
  ['looking', 'waiting', 'downloading', 'unpacking', 'converting', 'importing'].includes(view.phase);
