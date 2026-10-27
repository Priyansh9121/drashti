import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedPlaylist } from '../../../../shared/phone-files';
import { openViewer, useViewer, type ViewerPage } from '../viewer/viewer-store';
import { useMirror } from './mirror-store';
import { loadShared, lookingAt } from './phone-files-store';

/*
 * A phone as the playlists Drashti shares change (Session 54, D3): the library's Shared from Drashti goes back to
 * Presentations once nothing is shared (and is never chosen again by itself), and D1's viewer opened with a shared
 * playlist's files closes once that playlist is no longer shared, and only then. A stand-in for Drashti's answers;
 * made-up ids and placeholder names.
 */

const drashti = vi.hoisted(() => ({ shared: [] as SharedPlaylist[] }));

vi.mock('../device', () => ({
  api: (path: string) =>
    Promise.resolve(
      path === '/api/v1/shared' ? { ok: true, playlists: drashti.shared } : { ok: true, items: [] },
    ),
}));

const SABHA: SharedPlaylist = { id: 'sabha', name: 'Placeholder Sabha', itemCount: 2, fromFolder: false };
const OTHER: SharedPlaylist = { id: 'other', name: 'Placeholder other', itemCount: 1, fromFolder: false };

const page = (key: string): ViewerPage => ({
  key,
  title: key,
  size: { width: 16, height: 9 },
  draw: () => null,
});

/** Drashti shares these now, and the phone reads them again (as it does when told the playlists changed). */
async function sharing(...playlists: SharedPlaylist[]): Promise<void> {
  drashti.shared = playlists;
  await loadShared();
}

beforeEach(() => {
  useViewer.setState({ pages: [], index: 0, of: null, sizes: {} });
  useMirror.setState({ libraryKind: 'presentations' });
});

describe('a phone as Drashti’s shared playlists change (Session 54, D3)', () => {
  it('takes the library back to Presentations once nothing is shared, and never to Shared again by itself', async () => {
    await sharing(SABHA);
    useMirror.setState({ libraryKind: 'shared' });
    await sharing(SABHA, OTHER);
    expect(useMirror.getState().libraryKind).toBe('shared');
    await sharing();
    expect(useMirror.getState().libraryKind).toBe('presentations');
    await sharing(SABHA);
    expect(useMirror.getState().libraryKind).toBe('presentations');
    // Media chosen stays Media.
    useMirror.setState({ libraryKind: 'media' });
    await sharing();
    expect(useMirror.getState().libraryKind).toBe('media');
  });

  it('closes the viewer opened with a shared playlist’s files once that playlist is no longer shared', async () => {
    await sharing(SABHA, OTHER);
    const pages = [page('picture:backdrop'), page('sound:tone')];
    openViewer(pages, 1, SABHA.name);
    lookingAt(SABHA.id, pages);
    // Another playlist no longer shared: it stays open.
    await sharing(SABHA);
    expect(useViewer.getState().pages).toBe(pages);
    await sharing();
    expect(useViewer.getState().pages).toEqual([]);
  });

  it('leaves open a viewer opened since with something else', async () => {
    await sharing(SABHA);
    const pages = [page('picture:backdrop')];
    openViewer(pages, 0, SABHA.name);
    lookingAt(SABHA.id, pages);
    const screens = [page('screens')];
    openViewer(screens);
    await sharing();
    expect(useViewer.getState().pages).toBe(screens);
  });
});
