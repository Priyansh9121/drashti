import { beforeEach, expect, it, vi } from 'vitest';
import type { PlaylistItemInfo } from '../../../shared/playlists';

/*
 * Rename… from a playlist's row of a picture, video or sound (C18, Session 58: FT-2): the question shows the library
 * file's own name and Undo puts that name back, never a label the row has of its own (that renamed the operator's
 * file to the row's label).
 */

const asked: { what: string; name: string }[] = [];
vi.mock('./rename-in-window', () => ({
  askRenameWithUndo: (what: string, name: string) => {
    asked.push({ what, name });
  },
}));

const { playlistRow } = await import('./targets');

const media = (over: Partial<Extract<PlaylistItemInfo, { kind: 'media' }>>): PlaylistItemInfo => ({
  id: 'item-1',
  kind: 'media',
  label: 'Placeholder row label',
  mediaId: 'media-1',
  media: 'video',
  missing: false,
  unplayable: null,
  timers: [],
  ...over,
});

beforeEach(() => {
  asked.length = 0;
});

it('asks to rename the file by its own name, not the row’s label', () => {
  const target = playlistRow(media({ mediaName: 'Placeholder file name' }), 'playlist-1');
  expect(target.name).toBe('Placeholder row label');
  target.rename?.();
  expect(asked).toEqual([{ what: 'the video', name: 'Placeholder file name' }]);
});

it('a row with no file name given (an older Main’s) renames by its label, as before', () => {
  playlistRow(media({ label: 'Placeholder file name' }), 'playlist-1').rename?.();
  expect(asked).toEqual([{ what: 'the video', name: 'Placeholder file name' }]);
});
