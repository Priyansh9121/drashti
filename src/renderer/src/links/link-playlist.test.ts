import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../../shared/engine/commands';
import type { LinkResult, LinkView } from '../../../shared/links';
import type { NewItem, PlaylistItemInfo, PlaylistNode } from '../../../shared/playlists';
import { useLibrary } from '../library/library-store';
import { useMode } from '../operator/mode-store';
import { usePlaylists } from '../playlists/playlist-store';
import { landInPlaylist, linkPlaylistId, useLanded } from './link-playlist';
import { importLink, newPlaylistName, useLinks } from './link-store';

let tree: PlaylistNode[] = [];
let itemsOf: Record<string, PlaylistItemInfo[]> = {};
let refuseAdding = false;
const made: string[] = [];
const downloads: [url: string, audio: boolean, intoOpenPlaylist: boolean][] = [];
const commands: EngineCommand[] = [];
let heard: ((view: LinkView) => void) | null = null;

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
        start: (url: string, audio: boolean, intoOpenPlaylist: boolean) => {
          downloads.push([url, audio, intoOpenPlaylist]);
          return answer({ ...VIEW, link: url, phase: 'looking' });
        },
      },
      library: {
        getImportReport: (runId: string) =>
          Promise.resolve({
            id: runId,
            message: null,
            paths: ['/placeholder/Placeholder video.mp4'],
            items: [
              {
                sourcePath: '/placeholder/Placeholder video.mp4',
                outcome: 'imported',
                issues: [],
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
  useLinks.setState({ view: VIEW, open: true, audio: null, request: null });
});

/** The playlists, as the window last read them. */
async function playlists(...nodes: PlaylistNode[]): Promise<void> {
  tree = nodes;
  usePlaylists.setState({ tree: nodes });
  await Promise.resolve();
}

describe('where a download from a link goes', () => {
  it('uses the playlist open when the link is pasted, even after another playlist received a link', async () => {
    await playlists(node('sunday', 'Placeholder Sunday'), node('youth', 'Placeholder Youth'));
    usePlaylists.setState({ openId: 'sunday' });
    useLinks.setState({ view: { ...VIEW, lastPlaylist: 'youth' } });
    expect(linkPlaylistId()).toBe('sunday');
  });

  it('uses no open destination if a playlist is closed, missing or a folder', async () => {
    await playlists(node('sunday', 'Placeholder Sunday'), node('folder', 'Placeholder Folder', true));
    expect(linkPlaylistId()).toBeNull();
    usePlaylists.setState({ openId: 'folder' });
    expect(linkPlaylistId()).toBeNull();
    usePlaylists.setState({ openId: 'gone' });
    expect(linkPlaylistId()).toBeNull();
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
  it('lands in the playlist chosen, which opens with the new item chosen, never up by itself', async () => {
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

  it('with no playlist, makes one named after the download and opens it', async () => {
    const name = await landInPlaylist({ kind: 'new', name: 'Placeholder Downloads' }, [
      { kind: 'media', mediaId: 'media-new' },
    ]);
    expect(made).toEqual(['Placeholder Downloads']);
    expect(name).toBe('Placeholder Downloads');
    expect(usePlaylists.getState().openId).toBe('made-1');
    expect(usePlaylists.getState().marked).toEqual([itemsOf['made-1']?.[0]?.id]);
  });

  it('opens nothing when nothing went in', async () => {
    await playlists(node('youth', 'Placeholder Youth'));
    refuseAdding = true;
    expect(await landInPlaylist({ kind: 'playlist', id: 'youth' }, [{ kind: 'media', mediaId: 'm' }])).toBe(
      null,
    );
    expect(await landInPlaylist({ kind: 'none' }, [{ kind: 'media', mediaId: 'm' }])).toBe(null);
    expect(usePlaylists.getState().openId).toBeNull();
  });

  it('in Simple Mode too since Session 56 (its window opens any playlist, as Pro Mode’s does): the playlist it went into opens with the new item chosen, never up by itself', async () => {
    await playlists(node('sunday', 'Placeholder Sunday'), node('youth', 'Placeholder Youth'));
    usePlaylists.setState({ openId: 'sunday' });
    useMode.setState({ mode: 'simple' });
    await landInPlaylist({ kind: 'playlist', id: 'youth' }, [{ kind: 'media', mediaId: 'media-new' }]);
    const state = usePlaylists.getState();
    expect(state.openId).toBe('youth');
    const [first] = itemsOf['youth'] ?? [];
    expect(state.marked).toEqual([first?.id]);
    expect(useLanded.getState().itemId).toBe(first?.id);
    expect(commands).toEqual([]);
  });
});

describe('pasting a link', () => {
  it('starts automatically and makes a playlist named after the video if none is open', async () => {
    expect(await importLink('https://youtu.be/AAAAAAAAAAA')).toBe(true);
    expect(downloads).toEqual([['https://www.youtube.com/watch?v=AAAAAAAAAAA', false, false]]);
    heard?.({ ...VIEW, phase: 'done', runId: 'run-1', saved: { folder: '/placeholder', files: ['x.mp4'] } });
    await expect.poll(() => usePlaylists.getState().openId).toBe('made-1');
    expect(made).toEqual(['Placeholder video']);
  });

  it('adds to the playlist open at paste time even if another opens before the download finishes', async () => {
    await playlists(node('a', 'Placeholder A'), node('b', 'Placeholder B'));
    usePlaylists.setState({ openId: 'b' });
    useLinks.setState({ view: { ...VIEW, lastPlaylist: 'a' } });
    expect(await importLink('https://youtu.be/AAAAAAAAAAA')).toBe(true);
    expect(downloads).toEqual([['https://www.youtube.com/watch?v=AAAAAAAAAAA', false, true]]);
    usePlaylists.setState({ openId: 'a' });
    heard?.({ ...VIEW, phase: 'done', runId: 'run-2', saved: { folder: '/placeholder', files: ['x.mp4'] } });
    await expect.poll(() => itemsOf['b']?.map((item) => item.label)).toEqual(['Placeholder video.mp4']);
    expect(itemsOf['a']).toBeUndefined();
  });
});
