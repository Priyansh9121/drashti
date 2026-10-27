import { describe, expect, it } from 'vitest';
import type { PresentationDoc } from '../../../../shared/library';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { itemWord, type PageMakers, sharedPages, slidesToRead, viewable } from './shared-files';

/*
 * A shared playlist's files as a phone looks through them in D1's viewer (Session 54, D3): in the playlist's order,
 * a picture, a video and a sound a page each, a presentation's slides one by one in the order its item plays them,
 * and the viewer opened at the file tapped. Made-up ids and placeholder names only.
 */

const slide = (id: string, index: number) => ({
  id,
  index,
  label: '',
  notes: '',
  cues: [],
  slide: { id, width: 1920, height: 1080, background: null, elements: [] },
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
});

/** A kirtan: a verse and a chorus, its chosen order the chorus, the verse, the chorus. */
const KIRTAN: PresentationDoc = {
  id: 'kirtan',
  name: 'Placeholder Kirtan',
  width: 1920,
  height: 1080,
  groups: [
    { id: 'verse', name: 'Verse', color: null, slides: [slide('v1', 0), slide('v2', 1)] },
    { id: 'chorus', name: 'Chorus', color: null, slides: [slide('c1', 2)] },
  ],
  arrangements: [
    { id: 'usual', name: 'Usual', groupIds: ['chorus', 'verse', 'chorus'] },
    { id: 'short', name: 'Short', groupIds: ['chorus'] },
  ],
  selectedArrangementId: 'usual',
  transition: null,
  loop: false,
  kirtan: null,
  source: null,
};

const media = (id: string, kind: 'image' | 'video' | 'audio', missing = false): PlaylistItemInfo => ({
  id: `item-${id}`,
  kind: 'media',
  label: `Placeholder ${id}`,
  mediaId: id,
  media: kind,
  missing,
  unplayable: null,
  timers: [],
});

type PresentationItem = Extract<PlaylistItemInfo, { kind: 'presentation' }>;

const presentation = (
  id: string,
  order: PresentationItem['order'],
  presentationId = 'kirtan',
): PresentationItem => ({
  id: `item-${id}`,
  kind: 'presentation',
  label: 'Placeholder Kirtan',
  presentationId,
  presentationName: 'Placeholder Kirtan',
  order,
  arrangementName: null,
  timers: [],
});

/** Each page in words. */
const WORDS: PageMakers<string> = {
  picture: (id, name) => `picture ${id} ${name}`,
  video: (id, name) => `video ${id} ${name}`,
  sound: (id, name) => `sound ${id} ${name}`,
  slide: (id, name, s) => [`slide ${id} ${name} ${String(s.position)} ${s.slide.id}`],
};

const docs = (id: string) => (id === 'kirtan' ? KIRTAN : null);

describe('a shared playlist looked through on a phone (Session 54, D3)', () => {
  it('turns its files into pages in its order, a presentation’s slides one by one as its item plays them', () => {
    const files = [
      media('backdrop', 'image'),
      presentation('kirtan', { mode: 'presentation' }),
      media('clip', 'video'),
      media('tone', 'audio'),
    ];
    expect(sharedPages(files, 0, docs, WORDS)).toEqual({
      pages: [
        'picture backdrop Placeholder backdrop',
        // Its chosen order: the chorus, the verse's two slides, the chorus again.
        'slide kirtan Placeholder Kirtan 0 c1',
        'slide kirtan Placeholder Kirtan 1 v1',
        'slide kirtan Placeholder Kirtan 2 v2',
        'slide kirtan Placeholder Kirtan 3 c1',
        'video clip Placeholder clip',
        'sound tone Placeholder tone',
      ],
      start: 0,
    });
    // Opened at the file tapped: a presentation at its first slide, a sound at its page.
    expect(sharedPages(files, 1, docs, WORDS)?.start).toBe(1);
    expect(sharedPages(files, 2, docs, WORDS)?.start).toBe(5);
    expect(sharedPages(files, 3, docs, WORDS)?.start).toBe(6);
  });

  it('plays an item’s own arrangement, or every slide, as the playlist says', () => {
    const slides = (order: PresentationItem['order']) =>
      sharedPages([presentation('kirtan', order)], 0, docs, WORDS)?.pages;
    expect(slides({ mode: 'arrangement', arrangementId: 'short' })).toEqual([
      'slide kirtan Placeholder Kirtan 0 c1',
    ]);
    expect(slides({ mode: 'all' })).toEqual([
      'slide kirtan Placeholder Kirtan 0 v1',
      'slide kirtan Placeholder Kirtan 1 v2',
      'slide kirtan Placeholder Kirtan 2 c1',
    ]);
  });

  it('leaves out a presentation Drashti could not give, and opens nothing when it is the one tapped', () => {
    const files = [presentation('gone', { mode: 'all' }, 'gone'), media('backdrop', 'image')];
    expect(sharedPages(files, 1, docs, WORDS)).toEqual({
      pages: ['picture backdrop Placeholder backdrop'],
      start: 0,
    });
    expect(sharedPages(files, 0, docs, WORDS)).toBeNull();
    expect(sharedPages(files, 5, docs, WORDS)).toBeNull();
  });

  it('reads each presentation and passage the files show once, and only those', () => {
    const passage: PlaylistItemInfo = {
      id: 'item-passage',
      kind: 'shastra',
      label: 'Placeholder Granth 14',
      passageId: 'shastra:pg#14',
      missing: false,
      timers: [],
    };
    expect(
      slidesToRead([
        presentation('a', { mode: 'all' }),
        media('backdrop', 'image'),
        passage,
        presentation('b', { mode: 'presentation' }),
      ]),
    ).toEqual(['kirtan', 'shastra:pg#14']);
  });

  it('can look at a file that is there, a presentation still in the library and a passage of a loaded text', () => {
    const removed: PlaylistItemInfo = { ...presentation('x', { mode: 'all' }), presentationName: null };
    const header: PlaylistItemInfo = { id: 'h', kind: 'header', label: 'Placeholder header', color: null };
    expect(viewable(media('backdrop', 'image'))).toBe(true);
    expect(viewable(media('tone', 'audio'))).toBe(true);
    expect(viewable(media('gone', 'video', true))).toBe(false);
    expect(viewable(presentation('k', { mode: 'all' }))).toBe(true);
    expect(viewable(removed)).toBe(false);
    expect(viewable(header)).toBe(false);
    expect([media('a', 'image'), media('b', 'video'), media('c', 'audio')].map(itemWord)).toEqual([
      'Picture',
      'Video',
      'Sound',
    ]);
  });
});
