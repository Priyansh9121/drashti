import { describe, expect, it } from 'vitest';
import type { PresentationDoc, SlideInfo } from '../../../shared/library';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import type { RenderSlide } from '../../../shared/model';
import { firstLine, playlistRows, presentationRows, rowNumbers, slideName } from './rows';

/*
 * Session 55, Part 4: the playlist is where things go live. Its rows, as the middle shows them: a presentation (a PDF,
 * a deck or Drashti's own) is a name that folds, with one row a slide under it, "<name>_1" to "<name>_N" (a text
 * slide's row says its first line too); a picture, a video, a sound and a video input are a row each; a header and a
 * slot are rows that never go up. Every row that goes up has a number, for jumping to it (folded ones too, so the
 * numbers never move). With no playlist open, the library's chosen presentation shows the same way. Placeholder
 * names only.
 */

const words = (id: string, text: string): RenderSlide => ({
  id,
  width: 1920,
  height: 1080,
  background: '#000000',
  elements: [
    {
      id: `${id}-t`,
      kind: 'text',
      frame: { x: 0, y: 0, width: 1920, height: 1080 },
      text,
      lang: 'en',
      style: {
        fontFamily: null,
        fontSize: 72,
        fontWeight: 400,
        color: '#ffffff',
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: 1.2,
        shadow: false,
      },
    },
  ],
});
const page = (id: string): RenderSlide => ({
  id,
  width: 1920,
  height: 1080,
  background: '#000000',
  elements: [
    {
      id: `${id}-p`,
      kind: 'image',
      mediaId: `page-${id}`,
      frame: { x: 0, y: 0, width: 1920, height: 1080 },
      fit: 'fit',
    },
  ],
});
const info = (slide: RenderSlide, index: number): SlideInfo => ({
  id: slide.id,
  index,
  label: '',
  notes: '',
  slide,
  cues: [],
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
});

const doc = (
  id: string,
  name: string,
  slides: RenderSlide[],
  over: Partial<PresentationDoc> = {},
): PresentationDoc => ({
  id,
  name,
  width: 1920,
  height: 1080,
  groups: [{ id: `${id}-g`, name: '', color: null, slides: slides.map(info) }],
  arrangements: [],
  selectedArrangementId: null,
  transition: null,
  loop: false,
  kirtan: null,
  source: null,
  ...over,
});

const KATHA = doc('katha', 'Placeholder katha', [page('k1'), page('k2'), page('k3')]);
const WORDS = doc('words', 'Placeholder words', [
  words('w1', 'Placeholder first line\nPlaceholder second line'),
  words('w2', '\n  Placeholder after a blank line'),
]);

const presentation = (id: string, presentationId: string, name: string | null): PlaylistItemInfo => ({
  id,
  kind: 'presentation',
  label: name ?? 'Placeholder gone',
  presentationId,
  presentationName: name,
  order: { mode: 'presentation' },
  arrangementName: null,
  timers: [],
});
const media = (id: string, kind: 'image' | 'video' | 'audio'): PlaylistItemInfo => ({
  id,
  kind: 'media',
  label: `Placeholder ${id}`,
  mediaId: `m-${id}`,
  media: kind,
  missing: false,
  unplayable: null,
  timers: [],
});
const ITEMS: PlaylistItemInfo[] = [
  { id: 'h', kind: 'header', label: 'Placeholder part', color: null },
  presentation('i-katha', 'katha', 'Placeholder katha'),
  media('video', 'video'),
  presentation('i-words', 'words', 'Placeholder words'),
  {
    id: 'input',
    kind: 'input',
    label: 'Placeholder camera',
    name: 'Placeholder camera',
    missing: false,
    timers: [],
  },
  { id: 'slot', kind: 'placeholder', label: 'Placeholder slot', hint: null, category: null },
  presentation('i-gone', 'gone', null),
  media('sound', 'audio'),
];
const DOCS = new Map<string, PresentationDoc | null>([
  ['katha', KATHA],
  ['words', WORDS],
]);

describe('the rows of a playlist', () => {
  it('names a slide "<name>_N", and a text slide’s first line', () => {
    expect(slideName('Placeholder katha', 0)).toBe('Placeholder katha_1');
    expect(slideName('Placeholder katha', 11)).toBe('Placeholder katha_12');
    expect(firstLine(words('a', 'Placeholder first line\nPlaceholder second line'))).toBe(
      'Placeholder first line',
    );
    expect(firstLine(words('b', '\n  Placeholder after a blank line'))).toBe(
      'Placeholder after a blank line',
    );
    expect(firstLine(page('c'))).toBe('');
  });

  it('shows a presentation as its name, then a row a slide; a file, an input, a header and a slot a row each', () => {
    const rows = playlistRows(ITEMS, DOCS, new Set());
    expect(rows.map((r) => `${r.kind} ${r.kind === 'slide' ? r.label : r.item.id}`)).toEqual([
      'item h',
      'group i-katha',
      'slide Placeholder katha_1',
      'slide Placeholder katha_2',
      'slide Placeholder katha_3',
      'item video',
      'group i-words',
      'slide Placeholder words_1',
      'slide Placeholder words_2',
      'item input',
      'item slot',
      'group i-gone',
      'item sound',
    ]);
    const second = rows.find((r) => r.kind === 'slide' && r.label === 'Placeholder words_2');
    expect(second?.kind === 'slide' ? second.line : null).toBe('Placeholder after a blank line');
  });

  it('numbers every row that goes up, in order, folded ones too, so a number never moves', () => {
    const open = rowNumbers(playlistRows(ITEMS, DOCS, new Set()));
    const folded = rowNumbers(playlistRows(ITEMS, DOCS, new Set(['i-katha'])));
    expect(open).toEqual([
      { number: 1, key: 'i-katha/0' },
      { number: 2, key: 'i-katha/1' },
      { number: 3, key: 'i-katha/2' },
      { number: 4, key: 'video' },
      { number: 5, key: 'i-words/0' },
      { number: 6, key: 'i-words/1' },
      { number: 7, key: 'input' },
      { number: 8, key: 'sound' },
    ]);
    expect(folded).toEqual(open);
    // Folded: its slides are still there, hidden under its name.
    const rows = playlistRows(ITEMS, DOCS, new Set(['i-katha']));
    const group = rows.find((r) => r.kind === 'group' && r.item.id === 'i-katha');
    expect(group?.kind === 'group' ? group.folded : null).toBe(true);
    expect(
      rows
        .filter((r) => r.kind === 'slide' && r.item?.id === 'i-katha')
        .every((r) => r.kind === 'slide' && r.hidden),
    ).toBe(true);
  });

  it('a presentation still being read has its name row only, said as loading; one that could not be read says so', () => {
    const rows = playlistRows(ITEMS, new Map([['katha', null]]), new Set());
    const katha = rows.find((r) => r.kind === 'group' && r.item.id === 'i-katha');
    const words2 = rows.find((r) => r.kind === 'group' && r.item.id === 'i-words');
    expect(katha?.kind === 'group' ? katha.read : null).toBe('unread');
    expect(words2?.kind === 'group' ? words2.read : null).toBe('loading');
    expect(rows.some((r) => r.kind === 'slide')).toBe(false);
  });

  it('plays a slide in the item’s own order: an arrangement the item names', () => {
    const song = doc('song', 'Placeholder song', [], {
      groups: [
        { id: 'v', name: 'Verse', color: null, slides: [info(words('v1', 'Placeholder verse'), 0)] },
        { id: 'c', name: 'Chorus', color: '#ff0000', slides: [info(words('c1', 'Placeholder chorus'), 1)] },
      ],
      arrangements: [{ id: 'a', name: 'Placeholder order', groupIds: ['c', 'v', 'c'] }],
    });
    const item: PlaylistItemInfo = {
      ...presentation('i-song', 'song', 'Placeholder song'),
      ...{ order: { mode: 'arrangement', arrangementId: 'a' } },
    };
    const rows = playlistRows([item], new Map([['song', song]]), new Set()).flatMap((r) =>
      r.kind === 'slide' ? [r] : [],
    );
    expect(rows.map((r) => `${r.label} ${r.line} ${String(r.arrangementId)}`)).toEqual([
      'Placeholder song_1 Placeholder chorus a',
      'Placeholder song_2 Placeholder verse a',
      'Placeholder song_3 Placeholder chorus a',
    ]);
    // The group's name on the first slide of each run.
    expect(rows.map((r) => r.firstOfRun)).toEqual([true, true, true]);
  });
});

describe('an item’s own order of slides (Session 55, Part 4b)', () => {
  it('shows its slides’ rows in that order, each named by its own place in the presentation, played as "item:<id>"', () => {
    const deck: PlaylistItemInfo = {
      ...presentation('i-katha', 'katha', 'Placeholder katha'),
      ...{ order: { mode: 'slides', slideIds: ['k3', 'k1'], known: ['k1', 'k2', 'k3'] } },
    };
    // The second page, dragged out of the deck into an item of its own.
    const alone: PlaylistItemInfo = {
      ...presentation('i-k2', 'katha', 'Placeholder katha'),
      ...{ order: { mode: 'slides', slideIds: ['k2'] } },
    };
    const rows = playlistRows([deck, alone], DOCS, new Set()).flatMap((r) => (r.kind === 'slide' ? [r] : []));
    expect(
      rows.map(
        (r) =>
          `${String(r.number)} ${r.label} ${String(r.arrangementId)} ${String(r.at.position)} ${r.item?.id ?? ''}`,
      ),
    ).toEqual([
      '1 Placeholder katha_3 item:i-katha 0 i-katha',
      '2 Placeholder katha_1 item:i-katha 1 i-katha',
      '3 Placeholder katha_2 item:i-k2 0 i-k2',
    ]);
  });
});

describe('the library’s chosen presentation, with no playlist open', () => {
  it('shows the same rows: its name, then a slide a row, numbered from 1', () => {
    const rows = presentationRows(WORDS, null);
    expect(
      rows.map((r) => (r.kind === 'slide' ? `${String(r.number)} ${r.label} ${r.line}` : r.kind)),
    ).toEqual([
      '1 Placeholder words_1 Placeholder first line',
      '2 Placeholder words_2 Placeholder after a blank line',
    ]);
  });
});
