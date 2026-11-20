import { describe, expect, it } from 'vitest';
import type { FileTarget } from '../files/file-menu';
import { mediaInfoItems } from './media-info';

/* Media information… in the one right-click menu (alpha.20, Q60-34 item 1): on every video and sound, nothing else. */

const target = (more: Partial<FileTarget>): FileTarget => ({
  kind: 'video',
  name: 'Placeholder clip.mp4',
  place: 'media',
  ...more,
});

describe('Media information in the right-click menu', () => {
  it('is on a video and a sound wherever they show, and opens that file', () => {
    for (const place of ['media', 'playlist', 'music'] as const)
      for (const kind of ['video', 'sound'] as const) {
        const opened: { id: string; name: string }[] = [];
        const items = mediaInfoItems(target({ kind, place, mediaId: 'm1' }), (m) => opened.push(m));
        expect(items.map((i) => i.label)).toEqual(['Media information…']);
        items[0]?.onSelect();
        expect(opened).toEqual([{ id: 'm1', name: 'Placeholder clip.mp4' }]);
      }
  });

  it('is on nothing else: a picture, a presentation, a header, or a row with no file', () => {
    expect(mediaInfoItems(target({ kind: 'picture', mediaId: 'p1' }))).toEqual([]);
    expect(mediaInfoItems(target({ kind: 'presentation', presentationId: 'x' }))).toEqual([]);
    expect(mediaInfoItems(target({ kind: 'header', place: 'playlist' }))).toEqual([]);
    expect(mediaInfoItems(target({ kind: 'video' }))).toEqual([]);
  });
});
