import { describe, expect, it } from 'vitest';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { itemLine } from './item-line';

/* A playlist item's line on the phone (Session 54, D5): what it is and its slide count or length, as its card in
 * the operator window says (OpenPlaylist.tsx). Placeholder names. */

const presentation = (
  more: Partial<Extract<PlaylistItemInfo, { kind: 'presentation' }>> = {},
): PlaylistItemInfo => ({
  id: 'i1',
  kind: 'presentation',
  label: 'Placeholder Kirtan',
  presentationId: 'p1',
  presentationName: 'Placeholder Kirtan',
  order: { mode: 'presentation' },
  arrangementName: null,
  timers: [],
  ...more,
});

describe('a playlist item’s line on the phone', () => {
  it('says what it is and how many slides, as its card does', () => {
    expect(itemLine(presentation({ slideCount: 5 }))).toBe('Presentation · 5 slides');
    expect(itemLine(presentation({ slideCount: 1, deck: true }))).toBe('Deck · 1 slide');
    expect(itemLine(presentation())).toBe('Presentation');
  });

  it('gives a video’s or sound’s length once known, and a picture’s kind', () => {
    const media = (m: 'image' | 'video' | 'audio', durationMs?: number | null): PlaylistItemInfo => ({
      id: 'i2',
      kind: 'media',
      label: 'Placeholder clip',
      mediaId: 'm1',
      media: m,
      missing: false,
      unplayable: null,
      timers: [],
      durationMs,
    });
    expect(itemLine(media('video', 83_000))).toBe('Video · 1:23');
    expect(itemLine(media('audio', null))).toBe('Sound');
    expect(itemLine(media('image'))).toBe('Picture');
  });

  it('names a Shastra passage, a slot and a video input, and says nothing for a header', () => {
    expect(
      itemLine({
        id: 's',
        kind: 'shastra',
        label: 'PG 14',
        passageId: 'shastra:pg#14',
        missing: false,
        timers: [],
      }),
    ).toBe('Shastra passage');
    expect(itemLine({ id: 'x', kind: 'placeholder', label: 'Kirtan', hint: null, category: null })).toBe(
      'Slot',
    );
    expect(
      itemLine({ id: 'x', kind: 'placeholder', label: 'Old file', hint: 'old.pro', category: null }),
    ).toBe('Not found');
    expect(
      itemLine({ id: 'v', kind: 'input', label: 'Input 1', name: 'Input 1', missing: false, timers: [] }),
    ).toBe('Video input');
    expect(itemLine({ id: 'h', kind: 'header', label: 'Welcome', color: null })).toBeNull();
  });
});
