import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../../shared/engine/commands';
import type { LinkResult, LinkView } from '../../../shared/links';
import type { NewItem, PlaylistItemInfo, PlaylistNode } from '../../../shared/playlists';
import { useLibrary } from '../library/library-store';
import { useMode } from '../operator/mode-store';
import { usePlaylists } from '../playlists/playlist-store';
import { chosenTarget, landInPlaylist, linkTarget, useLanded } from './link-playlist';
import {
  addToNow,
  anotherLink,
  chooseAddTo,
  connectLinks,
  newPlaylistName,
  startDownload,
  useLinks,
} from './link-store';

/*
 * Where a download from a link goes (Session 54, F1): the playlist chosen last, offered first; with none, a new
 * one named before the download starts; when it is in, that playlist opens with the new item chosen, never up
 * by itself. The main process is stood in for by a fake that keeps playlists as src/main/db/playlists.ts does.
 * Placeholder names only.
 */

let tree: PlaylistNode[] = [];
let itemsOf: Record<string, PlaylistItemInfo[]> = {};
let refuseAdding = false;
const remembered: string[] = [];
const made: string[] = [];
const downloads: unknown[] = [];
const commands: EngineCommand[] = [];
let heard: ((view: LinkView) => void) | null = null;
/** The playlist the main process keeps as the one a download went into last. */
let keptLast: string | null = null;

const node = (id: string, name: string, isFolder = false): PlaylistNode => ({
  id,
  name,
  isFolder,
  kind: 'normal',
  parentId: null,
  itemCount: 0,
  placeholders: 0,
  imported: false,
  template: false,
});

const VIEW: LinkView = {
  phase: 'looked',
  kind: 'youtube',
  link: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
  look: { shape: 'video', name: 'Placeholder video', size: null },
  folder: '/placeholder/Drashti downloads',
  progress: null,
  waitingFor: null,
  message: null,
  saved: null,
  notTaken: [],
  fitted: [],
  maxHeight: 1080,
  runId: null,
  choice: null,
  playlist: null,
  waiting: [],
  waitingAdded: null,
  lastPlaylist: null,
};

const answer = (view: LinkView): Promise<LinkResult> => Promise.resolve({ ok: true, view });
let added = 0;

beforeEach(() => {
  tree = [];
  itemsOf = {};
  refuseAdding = false;
  keptLast = null;
  remembered.length = 0;
  made.length = 0;
  downloads.length = 0;
  commands.length = 0;
  (globalThis as { window?: unknown }).window = {
    drashti: {
      playlists: {
        tree: () => Promise.resolve(tree),
        templates: () => Promise.resolve([]),
        items: (id: string) => Promise.resolve(itemsOf[id] ?? []),
        opened: () => Promise.resolve(null),
        create: (name: string) => {
          const id = `made-${String(made.length + 1)}`;
          made.push(name);
          tree = [node(id, name), ...tree];
          return Promise.resolve({ ok: true, ids: [id] });
        },
        addItems: (id: string, _at: number | null, items: NewItem[]) => {
          if (refuseAdding) return Promise.resolve({ ok: false, message: 'Refused' });
          const ids = items.map(() => `item-${String(++added)}`);
          itemsOf[id] = [
            ...(itemsOf[id] ?? []),
            ...ids.map((itemId): PlaylistItemInfo => ({
              id: itemId,
              kind: 'media',
              label: 'Placeholder video.mp4',
              mediaId: 'media-new',
              media: 'video',
              missing: false,
              unplayable: null,
              timers: [],
            })),
          ];
          return Promise.resolve({ ok: true, ids });
        },
      },
      links: {
        view: () => Promise.resolve(VIEW),
        onChanged: (listener: (view: LinkView) => void) => {
          heard = listener;
          return () => undefined;
        },
        onOpen: () => () => undefined,
        download: (choice: unknown) => {
          downloads.push(choice);
          return answer({ ...VIEW, phase: 'downloading' });
        },
        setPlaylist: (id: string) => {
          remembered.push(id);
          return answer({ ...VIEW, lastPlaylist: id });
        },
        // Another link: the dialog afresh, the playlist chosen last as the main process keeps it.
        reset: () => answer({ ...VIEW, phase: 'idle', look: null, lastPlaylist: keptLast }),
      },
      library: {
        getImportReport: (runId: string) =>
          Promise.resolve({
            id: runId,
            paths: ['/placeholder/Placeholder video.mp4'],
            items: [
              {
                sourcePath: '/placeholder/Placeholder video.mp4',
                outcome: 'imported',
                target: { kind: 'media', id: 'media-new' },
              },
            ],
          }),
      },
      engine: {
        dispatch: (command: EngineCommand) => {
          commands.push(command);
          return Promise.resolve({ ok: true, changed: true, rev: -1 });
        },
      },
    },
  };
  usePlaylists.setState({ tree: [], templates: [], openId: null, items: [], marked: [], anchorId: null });
  useLibrary.setState({ item: null });
  useLanded.setState({ itemId: null });
  useMode.setState({ mode: 'pro' });
  useLinks.setState({
    view: VIEW,
    open: true,
    addTo: null,
    choice: { type: 'mp4', height: null, permission: true },
  });
});

/** The playlists, as the window last read them. */
async function playlists(...nodes: PlaylistNode[]): Promise<void> {
  tree = nodes;
  usePlaylists.setState({ tree: nodes });
  await Promise.resolve();
}

describe('where a download from a link goes, to begin with', () => {
  it('is the playlist chosen last, offered first even with another open', async () => {
    await playlists(node('sunday', 'Placeholder Sunday'), node('youth', 'Placeholder Youth'));
    usePlaylists.setState({ openId: 'sunday' });
    expect(linkTarget('youth', 'Placeholder video')).toEqual({ kind: 'playlist', id: 'youth' });
  });

  it('else the open playlist; else a new one named after what the link holds; never no playlist', async () => {
    await playlists(node('sunday', 'Placeholder Sunday'), node('youth', 'Placeholder Youth'));
    usePlaylists.setState({ openId: 'sunday' });
    expect(linkTarget(null, 'Placeholder video')).toEqual({ kind: 'playlist', id: 'sunday' });
    // The one chosen last, since deleted: the open one.
    expect(linkTarget('gone', 'Placeholder video')).toEqual({ kind: 'playlist', id: 'sunday' });
    usePlaylists.setState({ openId: null });
    expect(linkTarget(null, 'Placeholder video')).toEqual({ kind: 'new', name: 'Placeholder video' });
    // No playlist at all (a folder is not one): a new one, whose name the dialog asks for.
    await playlists(node('folder', 'Placeholder folder', true));
    expect(linkTarget('folder', 'Placeholder video')).toEqual({ kind: 'new', name: 'Placeholder video' });
  });

  it('is the one chosen in the dialog while it is there', async () => {
    await playlists(node('sunday', 'Placeholder Sunday'), node('youth', 'Placeholder Youth'));
    expect(chosenTarget({ kind: 'playlist', id: 'sunday' }, 'youth', 'Placeholder video')).toEqual({
      kind: 'playlist',
      id: 'sunday',
    });
    expect(chosenTarget({ kind: 'none' }, 'youth', 'Placeholder video')).toEqual({ kind: 'none' });
    // Deleted meanwhile: where it goes to begin with.
    expect(chosenTarget({ kind: 'playlist', id: 'gone' }, 'youth', 'Placeholder video')).toEqual({
      kind: 'playlist',
      id: 'youth',
    });
  });
});

describe('a new playlist’s name, to begin with', () => {
  it('is a video’s title as it is (trimmed), and a file’s name without its extension', () => {
    const video = (name: string): LinkView => ({ ...VIEW, look: { shape: 'video', name, size: null } });
    expect(newPlaylistName(video('Placeholder Kirtan Vol. 2'))).toBe('Placeholder Kirtan Vol. 2');
    expect(newPlaylistName(video('Placeholder Bhajan 1/3'))).toBe('Placeholder Bhajan 1/3');
    expect(newPlaylistName(video('  Placeholder video  '))).toBe('Placeholder video');
    const file: LinkView = {
      ...VIEW,
      kind: 'dropbox',
      look: { shape: 'file', name: 'Placeholder clip.mp4', size: 1000 },
    };
    expect(newPlaylistName(file)).toBe('Placeholder clip');
    expect(newPlaylistName(null)).toBe('Download');
  });
});

describe('when a download is in', () => {
  it('lands in the playlist chosen, which is remembered and opens with the new item chosen, never up by itself', async () => {
    await playlists(node('sunday', 'Placeholder Sunday'), node('youth', 'Placeholder Youth'));
    // Sunday open, its kirtan's slides in the middle.
    const kirtan: PlaylistItemInfo = {
      id: 'kirtan',
      kind: 'presentation',
      label: 'Placeholder Kirtan',
      presentationId: 'presentation-kirtan',
      presentationName: 'Placeholder Kirtan',
      order: { mode: 'presentation' },
      arrangementName: null,
      timers: [],
    };
    itemsOf['sunday'] = [kirtan];
    usePlaylists.setState({ openId: 'sunday', items: [kirtan] });
    useLibrary.setState({ item: { ...kirtan, playlistId: 'sunday' } });
    const name = await landInPlaylist({ kind: 'playlist', id: 'youth' }, [
      { kind: 'media', mediaId: 'media-new' },
    ]);
    expect(name).toBe('Placeholder Youth');
    expect(remembered).toEqual(['youth']);
    const state = usePlaylists.getState();
    expect(state.openId).toBe('youth');
    const [first] = itemsOf['youth'] ?? [];
    expect(state.marked).toEqual([first?.id]);
    expect(state.anchorId).toBe(first?.id);
    expect(useLanded.getState().itemId).toBe(first?.id);
    // Never up by itself, and the middle shows what it showed (Next carries on with the show).
    expect(commands).toEqual([]);
    expect(useLibrary.getState().item?.id).toBe('kirtan');
  });

  it('with no playlist, makes the one named before the download, remembers it and opens it', async () => {
    const name = await landInPlaylist({ kind: 'new', name: 'Placeholder Downloads' }, [
      { kind: 'media', mediaId: 'media-new' },
    ]);
    expect(made).toEqual(['Placeholder Downloads']);
    expect(name).toBe('Placeholder Downloads');
    expect(remembered).toEqual(['made-1']);
    expect(usePlaylists.getState().openId).toBe('made-1');
    expect(usePlaylists.getState().marked).toEqual([itemsOf['made-1']?.[0]?.id]);
  });

  it('remembers and opens nothing when nothing went in', async () => {
    await playlists(node('youth', 'Placeholder Youth'));
    refuseAdding = true;
    expect(await landInPlaylist({ kind: 'playlist', id: 'youth' }, [{ kind: 'media', mediaId: 'm' }])).toBe(
      null,
    );
    expect(await landInPlaylist({ kind: 'none' }, [{ kind: 'media', mediaId: 'm' }])).toBe(null);
    expect(remembered).toEqual([]);
    expect(usePlaylists.getState().openId).toBeNull();
  });

  it('never changes the playlist Simple Mode shows', async () => {
    await playlists(node('sunday', 'Placeholder Sunday'), node('youth', 'Placeholder Youth'));
    usePlaylists.setState({ openId: 'sunday' });
    useMode.setState({ mode: 'simple' });
    await landInPlaylist({ kind: 'playlist', id: 'youth' }, [{ kind: 'media', mediaId: 'media-new' }]);
    expect(usePlaylists.getState().openId).toBe('sunday');
    expect(useLanded.getState().itemId).toBeNull();
  });
});

describe('Download in the dialog', () => {
  it('with no playlist, takes a new one named after the video, made and opened when the download is in', async () => {
    connectLinks();
    expect(await startDownload()).toBe(true);
    expect(downloads).toHaveLength(1);
    heard?.({ ...VIEW, phase: 'done', runId: 'run-1', saved: { folder: '/placeholder', files: ['x.mp4'] } });
    await expect.poll(() => usePlaylists.getState().openId).toBe('made-1');
    expect(made).toEqual(['Placeholder video']);
    expect(remembered).toEqual(['made-1']);
  });

  it('keeps a playlist chosen by its own From a Link… when Another link is pressed (Session 54’s review)', async () => {
    await playlists(node('a', 'Placeholder A'), node('b', 'Placeholder B'));
    keptLast = 'a';
    useLinks.setState({ view: { ...VIEW, lastPlaylist: 'a' } });
    usePlaylists.setState({ openId: 'b' });
    chooseAddTo({ kind: 'playlist', id: 'b' });
    await anotherLink();
    expect(addToNow(useLinks.getState())).toEqual({ kind: 'playlist', id: 'b' });
    // No playlist, or a new one (made by the last download, and now the one chosen last), starts afresh.
    for (const chosen of [{ kind: 'none' as const }, { kind: 'new' as const, name: 'Placeholder video' }]) {
      chooseAddTo(chosen);
      await anotherLink();
      expect(addToNow(useLinks.getState())).toEqual({ kind: 'playlist', id: 'a' });
    }
  });

  it('never starts with a new playlist’s name left empty', async () => {
    useLinks.setState({ addTo: { kind: 'new', name: '  ' } });
    expect(await startDownload()).toBe(false);
    expect(downloads).toEqual([]);
  });
});
