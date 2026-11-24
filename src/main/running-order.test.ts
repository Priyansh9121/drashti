import { describe, expect, it } from 'vitest';
import type { PlaylistItemInfo } from '../shared/playlists';
import { runningOrderLines } from './running-order';

/*
 * A playlist's running order (alpha.22, from PLAN §7's "Print": seen, not added; the owner's "Yes, build them"):
 * copied as plain lines for the sabha team's group chat. Placeholder names only.
 */

/** A placeholder playlist's rows, one of each kind, in its order. */
const ITEMS: PlaylistItemInfo[] = [
  { id: 'h1', kind: 'header', label: 'Placeholder Dhun', color: null },
  {
    id: 'p1',
    kind: 'presentation',
    label: 'Placeholder kirtan',
    presentationId: 'pr1',
    presentationName: 'Placeholder kirtan',
    order: { mode: 'presentation' },
    arrangementName: null,
    timers: [],
    slideCount: 4,
  },
  {
    id: 'm1',
    kind: 'media',
    label: 'Placeholder video',
    mediaId: 'md1',
    media: 'video',
    missing: false,
    unplayable: null,
    timers: [],
    durationMs: 190_000,
    playingMs: 185_000,
  },
  { id: 's1', kind: 'placeholder', label: 'Placeholder slot', hint: null, category: 'Kirtan' },
  {
    id: 'm2',
    kind: 'media',
    label: 'Placeholder sound',
    mediaId: 'md2',
    media: 'audio',
    missing: false,
    unplayable: null,
    timers: [],
    durationMs: null,
    playingMs: null,
  },
  { id: 'h2', kind: 'header', label: 'Placeholder Pravachan', color: '#ff0000' },
  {
    id: 'm3',
    kind: 'media',
    label: 'Placeholder picture',
    mediaId: 'md3',
    media: 'image',
    missing: false,
    unplayable: null,
    timers: [],
  },
  { id: 'b1', kind: 'shastra', label: 'Placeholder passage 1.1', passageId: 'x', missing: false, timers: [] },
  { id: 'i1', kind: 'input', label: 'Input 1', name: 'Input 1', missing: false, timers: [] },
  { id: 's2', kind: 'placeholder', label: 'Placeholder lost file', hint: 'lost.pptx', category: null },
];

describe('Copy running order', () => {
  it('is plain lines: the name, headers as section lines, every other row numbered with its length, then the total', () => {
    expect(runningOrderLines({ name: 'Placeholder sabha', items: ITEMS }).split('\n')).toEqual([
      'Placeholder sabha',
      '— Placeholder Dhun —',
      '1. Placeholder kirtan',
      '2. Placeholder video, 3:05',
      '3. Slot to fill: Placeholder slot (Kirtan)',
      '4. Placeholder sound, length not known yet',
      '— Placeholder Pravachan —',
      '5. Placeholder picture',
      '6. Placeholder passage 1.1',
      '7. Input 1',
      '8. Not found at import: Placeholder lost file',
      'Videos and sounds in all: 3:05 (1 length not known yet)',
    ]);
  });

  it('numbers from 1 with no header, says a playlist is empty, and leaves the total out when nothing has a length', () => {
    const picture = ITEMS[6] as PlaylistItemInfo;
    expect(runningOrderLines({ name: 'Placeholder list', items: [picture, picture] })).toBe(
      'Placeholder list\n1. Placeholder picture\n2. Placeholder picture',
    );
    expect(runningOrderLines({ name: 'Placeholder list', items: [] })).toBe(
      'Placeholder list\nThis playlist is empty.',
    );
  });

  it('keeps each row on one line and says a Books slot as Books', () => {
    const lines = runningOrderLines({
      name: 'Placeholder\nsabha',
      items: [
        { id: 'h', kind: 'header', label: 'Placeholder\r\n  Dhun', color: null },
        { id: 's', kind: 'placeholder', label: 'Placeholder reading', hint: null, category: 'Shastra' },
      ],
    });
    expect(lines.split('\n')).toEqual([
      'Placeholder sabha',
      '— Placeholder Dhun —',
      '1. Slot to fill: Placeholder reading (Books)',
    ]);
  });
});
