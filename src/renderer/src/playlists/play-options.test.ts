import { expect, it, vi } from 'vitest';
import type { PlaylistPlayOptions } from '../../../shared/playlist-playback';
import type { PlaylistResult } from '../../../shared/playlists';
import { playlistOptionChanges } from './play-options';

it('keeps both quick ticks when an import holds the first write, reading the next value only after that write', async () => {
  let options: PlaylistPlayOptions = { shuffle: false, repeatAll: false };
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const read = vi.fn(() => Promise.resolve({ ...options }));
  let calls = 0;
  const write = vi.fn(async (_id: string, next: PlaylistPlayOptions): Promise<PlaylistResult> => {
    calls++;
    if (calls === 1) {
      firstStarted();
      await held;
    }
    options = next;
    return { ok: true, ids: ['list'] };
  });
  const change = playlistOptionChanges({ read, write });
  const shuffle = change('list', 'shuffle');
  await started;
  const repeat = change('list', 'repeatAll');
  release();
  await Promise.all([shuffle, repeat]);
  expect(options).toEqual({ shuffle: true, repeatAll: true });
  expect(write.mock.calls.map((call) => call[1])).toEqual([
    { shuffle: true, repeatAll: false },
    { shuffle: true, repeatAll: true },
  ]);
});
