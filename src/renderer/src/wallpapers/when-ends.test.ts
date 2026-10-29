import { describe, expect, it } from 'vitest';
import type { EngineState } from '../../../shared/engine/state';
import { initialEngineState } from '../../../shared/engine/state';
import type { FileTarget } from '../files/file-menu';
import { fileMenuEntries } from '../files/file-menu';
import { usePlaylists } from '../playlists/playlist-store';
import { wrapWords } from './quote-pictures';
import { addWhenEndsToMenu, lastSecondsOf, whenEndsEntries } from './when-ends';

/*
 * Session 55, Part 6 in the operator window: a video row's menu (the one right-click menu) offers When it ends, the
 * row's own ticked; a video's last 10 seconds are known from the engine's state and its clock alone; and a quote's
 * words are broken into lines at spaces for its picture. Placeholder names only.
 */

const video = (whenEnds?: 'next' | 'loop' | 'freeze') => ({
  id: 'i-clip',
  kind: 'media' as const,
  label: 'Placeholder clip',
  mediaId: 'clip',
  media: 'video' as const,
  missing: false,
  unplayable: null,
  timers: [],
  ...(whenEnds ? { whenEnds } : {}),
});

const target = (over: Partial<FileTarget> = {}): FileTarget => ({
  kind: 'video',
  name: 'Placeholder clip',
  place: 'playlist',
  playlistId: 'pl',
  itemId: 'i-clip',
  ...over,
});

describe('When it ends in a video row’s menu', () => {
  it('offers the four, the row’s own ticked (Wallpaper when it has none)', () => {
    usePlaylists.setState({ items: [video()] });
    const entries = whenEndsEntries(target());
    expect(entries.map((e) => [e.label, e.checked])).toEqual([
      ['When it ends: Wallpaper', true],
      ['When it ends: Next item', false],
      ['When it ends: Loop', false],
      ['When it ends: Freeze', false],
    ]);
    usePlaylists.setState({ items: [video('loop')] });
    expect(whenEndsEntries(target()).find((e) => e.checked)?.label).toBe('When it ends: Loop');
  });

  it('offers nothing for a picture, a video in the library or Media, or a row not in the open playlist', () => {
    usePlaylists.setState({ items: [video()] });
    expect(whenEndsEntries(target({ kind: 'picture' }))).toEqual([]);
    expect(whenEndsEntries(target({ place: 'media' }))).toEqual([]);
    expect(whenEndsEntries(target({ itemId: 'no-such' }))).toEqual([]);
  });

  it('is in the one menu, after Trim and before Rename', () => {
    usePlaylists.setState({ items: [video()] });
    addWhenEndsToMenu();
    const labels = fileMenuEntries(
      target({
        trim: () => undefined,
        rename: () => undefined,
        remove: { label: 'Remove from playlist', run: () => undefined },
      }),
      'darwin',
    ).map((e) => e.label);
    expect(labels).toEqual([
      'Trim (start, end and markers)…',
      'When it ends: Wallpaper',
      'When it ends: Next item',
      'When it ends: Loop',
      'When it ends: Freeze',
      'Rename…',
      'Remove from playlist',
    ]);
  });
});

describe('a video’s last 10 seconds', () => {
  const up = (over: Record<string, unknown> = {}): EngineState => {
    const state = initialEngineState();
    return {
      ...state,
      live: { ...state.live, playlist: { playlistId: 'pl', itemId: 'i-clip' } },
      layers: {
        ...state.layers,
        background: {
          kind: 'media',
          mediaId: 'clip',
          media: 'video',
          fit: 'fit',
          loop: false,
          startedAt: 1_000_000,
          durationMs: 30_000,
          ...over,
        },
      },
    };
  };

  it('are from 10 s before its end until it ends, with the row it came from', () => {
    expect(lastSecondsOf(up(), 1_000_000 + 19_000)).toBeNull();
    expect(lastSecondsOf(up(), 1_000_000 + 21_000)).toEqual({ leftMs: 9_000, itemId: 'i-clip' });
    expect(lastSecondsOf(up(), 1_000_000 + 30_000)).toBeNull();
  });

  it('never come for a video going round, one not yet known how long, or a picture', () => {
    expect(lastSecondsOf(up({ loop: true }), 1_000_000 + 25_000)).toBeNull();
    expect(lastSecondsOf(up({ durationMs: undefined }), 1_000_000 + 25_000)).toBeNull();
    expect(lastSecondsOf(up({ media: 'image' }), 1_000_000 + 25_000)).toBeNull();
    expect(lastSecondsOf(null, 0)).toBeNull();
  });
});

describe('a quote’s words, in lines for its picture', () => {
  const width = (s: string) => s.length * 10;
  it('breaks at spaces, keeps its own lines, and gives a word longer than a line a line of its own', () => {
    expect(wrapWords('one two three four', 100, width)).toEqual(['one two', 'three four']);
    expect(wrapWords('first line\nsecond', 1000, width)).toEqual(['first line', 'second']);
    expect(wrapWords('averyveryverylongword short', 50, width)).toEqual(['averyveryverylongword', 'short']);
  });
});
