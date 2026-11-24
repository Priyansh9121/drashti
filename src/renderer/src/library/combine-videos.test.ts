import { describe, expect, it } from 'vitest';
import type { FileTarget } from '../files/file-menu';
import { fileMenuEntries } from '../files/file-menu';
import type { MediaSummary } from '../../../shared/playlists';
import { addCombineToMenu, combineItems, combineJobWords, moved, type CombineVideo } from './combine-videos';
import type { CombineJob } from '../../../shared/video-copies';
import { useMedia } from './library-store';

const video = (id: string, more: Partial<MediaSummary> = {}): MediaSummary => ({
  id,
  name: `Placeholder ${id}.mp4`,
  kind: 'video',
  missing: false,
  unplayable: null,
  format: 'H.264 video (MP4)',
  convertedTo: null,
  ...more,
});
const media = [video('a'), video('b'), video('c', { kind: 'image', name: 'Placeholder c.png' }), video('d')];
const target = (id: string, place: FileTarget['place'] = 'media'): FileTarget => ({
  kind: 'video',
  place,
  mediaId: id,
  name: `Placeholder ${id}.mp4`,
});

describe('Combine videos… in Media’s right-click menu', () => {
  it('is there only on a video chosen with one or more other videos, in Media, and opens them in Media’s order', () => {
    let opened: CombineVideo[] = [];
    const items = combineItems(target('d'), media, ['d', 'a', 'c'], (videos) => {
      opened = videos;
    });
    expect(items.map((i) => i.label)).toEqual(['Combine videos…']);
    items[0]?.onSelect();
    expect(opened).toEqual([
      { id: 'a', name: 'Placeholder a.mp4' },
      { id: 'd', name: 'Placeholder d.mp4' },
    ]);
    // One video alone; a picture with a video; one not chosen; outside Media; a missing or unplayable one.
    expect(combineItems(target('a'), media, ['a'])).toEqual([]);
    expect(combineItems(target('a'), media, ['a', 'c'])).toEqual([]);
    expect(combineItems(target('b'), media, ['a', 'd'])).toEqual([]);
    expect(combineItems(target('a', 'playlist'), media, ['a', 'b'])).toEqual([]);
    expect(combineItems(target('a'), [video('a'), video('b', { missing: true })], ['a', 'b'])).toEqual([]);
    expect(combineItems(target('a'), [video('a'), video('b', { unplayable: 'HEVC' })], ['a', 'b'])).toEqual(
      [],
    );
  });

  it('is in Pro Mode’s menu only, never Simple Mode’s', () => {
    const remove = addCombineToMenu();
    try {
      useMedia.setState({ media, marked: ['a', 'b'] });
      const labels = (simple: boolean) =>
        fileMenuEntries(target('a'), 'darwin', { simple }).map((entry) => entry.label);
      expect(labels(false)).toContain('Combine videos…');
      expect(labels(true)).not.toContain('Combine videos…');
    } finally {
      remove();
      useMedia.setState({ media: [], marked: [] });
    }
  });

  it('moves a video one place up or down, and never past either end', () => {
    expect(moved(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moved(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('a combine’s words in its window', () => {
  const job = (more: Partial<CombineJob>): CombineJob => ({
    id: 'job',
    name: 'Placeholder a + Placeholder b.mp4',
    mediaIds: ['a', 'b'],
    transition: 'dissolve',
    transitionMs: 1000,
    short: [],
    state: 'waiting',
    progress: null,
    note: null,
    message: null,
    mediaId: null,
    savedTo: null,
    ...more,
  });
  it('says how it is going, what it made, where a copy was saved, and a video joined with a cut', () => {
    expect(
      combineJobWords(
        job({ note: 'Waits while the stream is on air or recording, then carries on by itself.' }),
      ),
    ).toEqual(['Waits while the stream is on air or recording, then carries on by itself.']);
    expect(combineJobWords(job({ state: 'preparing', progress: 0.42 }))).toEqual([
      'Combining “Placeholder a + Placeholder b.mp4”… 42%',
    ]);
    expect(
      combineJobWords(
        job({
          state: 'done',
          mediaId: 'made',
          savedTo: '/Users/placeholder/Downloads/Placeholder a + Placeholder b.mp4',
        }),
      ),
    ).toEqual([
      'Added “Placeholder a + Placeholder b.mp4” to Media.',
      'A copy was saved as “Placeholder a + Placeholder b.mp4”.',
    ]);
    expect(combineJobWords(job({ short: ['Placeholder b.mp4'] }))[1]).toBe(
      '“Placeholder b.mp4” is too short for the 1 s transition: it is joined with a plain cut.',
    );
    expect(combineJobWords(job({ state: 'failed', message: 'Placeholder reason.' }))).toEqual([
      'Placeholder reason.',
    ]);
  });
});
