import { describe, expect, it } from 'vitest';
import {
  CLIP_PARTS_MOST,
  JOINED_PARTS_ORIGINAL,
  TRIM_TIME_WORDS,
  checkClipParts,
  clipPartsInOrder,
  clipPartsLength,
  clipPartsSummary,
  parseTrimTime,
  trimSeconds,
} from './clip-parts';
import { clipExportRequestSchema } from './video-copies';

/*
 * Parts of one video joined into one clip (alpha.24; the owner, 27 Nov 2026: "one video can be cut in 2 parts and
 * merged, for example a 30 minute video, i want from 0 to 10 and 20 to 30 but in 1 video").
 */
const MIN = 60_000;

describe('a time typed in Edit Video’s Trim fields', () => {
  it('reads seconds exactly as the number fields did, so every seconds entry keeps its meaning', () => {
    // As the number field read them: valueAsNumber, then Math.round(seconds × 1000).
    for (const typed of ['0', '2', '0.350', '1.750', '0.35', '600', '1800', '.5', '5.', '12.3456', '1e3', '0.0004'])
      expect(parseTrimTime(typed), typed).toBe(Math.round(Number(typed) * 1000));
    expect(parseTrimTime('0.350')).toBe(350);
    expect(parseTrimTime(' 2 ')).toBe(2000);
  });
  it('reads minutes and seconds, or hours, minutes and seconds, with thousandths if typed', () => {
    expect(parseTrimTime('10:00')).toBe(10 * MIN);
    expect(parseTrimTime('20:00')).toBe(20 * MIN);
    expect(parseTrimTime('30:00')).toBe(30 * MIN);
    expect(parseTrimTime('1:20:00')).toBe(80 * MIN);
    expect(parseTrimTime('0:03.500')).toBe(3500);
    expect(parseTrimTime('90:00')).toBe(90 * MIN);
  });
  it('is not a time when it is empty, words, negative or a broken clock time', () => {
    for (const typed of ['', ' ', 'abc', '-1', '-0.5', '1:5', '10:0', '1:60', '1:2:3:4', '1:75:00', '10:00:', '1..2', 'e3'])
      expect(parseTrimTime(typed), JSON.stringify(typed)).toBeNull();
  });
  it('shows a time as the number field showed it: seconds', () => {
    expect(trimSeconds(0)).toBe('0');
    expect(trimSeconds(2000)).toBe('2');
    expect(trimSeconds(350)).toBe('0.35');
    expect(trimSeconds(600_000)).toBe('600');
    for (const ms of [0, 1, 350, 1750, 2000, 600_000, 4_800_123]) expect(parseTrimTime(trimSeconds(ms))).toBe(ms);
  });
  it('says what to type in plain words', () => {
    expect(TRIM_TIME_WORDS).toMatch(/600/u);
    expect(TRIM_TIME_WORDS).toMatch(/10:00/u);
  });
});

describe('the parts kept for one exported clip', () => {
  it('keeps the owner’s example: 0 to 10 and 20 to 30 minutes of a 30-minute video, 20 minutes in all', () => {
    const checked = checkClipParts(
      [
        { startMs: 0, endMs: 10 * MIN },
        { startMs: 20 * MIN, endMs: 30 * MIN },
      ],
      30 * MIN,
    );
    expect(checked).toEqual({
      ok: true,
      parts: [
        { startMs: 0, endMs: 10 * MIN },
        { startMs: 20 * MIN, endMs: 30 * MIN },
      ],
    });
    if (checked.ok) expect(clipPartsLength(checked.parts)).toBe(20 * MIN);
  });
  it('joins them in time order, whatever order they were typed in', () => {
    expect(
      checkClipParts(
        [
          { startMs: 20 * MIN, endMs: 30 * MIN },
          { startMs: 0, endMs: 10 * MIN },
          { startMs: 12 * MIN, endMs: 15 * MIN },
        ],
        30 * MIN,
      ),
    ).toEqual({
      ok: true,
      parts: [
        { startMs: 0, endMs: 10 * MIN },
        { startMs: 12 * MIN, endMs: 15 * MIN },
        { startMs: 20 * MIN, endMs: 30 * MIN },
      ],
    });
  });
  it('allows parts that only touch: one ends where the next starts', () => {
    expect(
      checkClipParts(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 1000, endMs: 2000 },
        ],
        2000,
      ).ok,
    ).toBe(true);
  });
  it('refuses an overlap in plain words, naming both parts, and never shortens either', () => {
    const checked = checkClipParts(
      [
        { startMs: 0, endMs: 12 * MIN },
        { startMs: 10 * MIN, endMs: 20 * MIN },
      ],
      30 * MIN,
    );
    expect(checked).toEqual({
      ok: false,
      message: 'Parts 1 and 2 overlap. Make each part end before the next one starts.',
    });
  });
  it('names the parts by the numbers shown, even when an overlap is found after putting them in time order', () => {
    const checked = checkClipParts(
      [
        { startMs: 20 * MIN, endMs: 30 * MIN },
        { startMs: 0, endMs: 5 * MIN },
        { startMs: 25 * MIN, endMs: 28 * MIN },
      ],
      30 * MIN,
    );
    expect(checked).toEqual({
      ok: false,
      message: 'Parts 1 and 3 overlap. Make each part end before the next one starts.',
    });
  });
  it('refuses an empty part, one ending before its start, a part past the video’s end, and a time not typed', () => {
    expect(
      checkClipParts(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 1500, endMs: 1500 },
        ],
        2000,
      ),
    ).toEqual({ ok: false, message: 'Part 2 ends at or before its start. Give it an end after its start.' });
    expect(
      checkClipParts(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 1800, endMs: 1200 },
        ],
        2000,
      ),
    ).toEqual({ ok: false, message: 'Part 2 ends at or before its start. Give it an end after its start.' });
    expect(
      checkClipParts(
        [
          { startMs: 0, endMs: 10 * MIN },
          { startMs: 20 * MIN, endMs: 31 * MIN },
        ],
        30 * MIN,
      ),
    ).toEqual({
      ok: false,
      message: 'Part 2 goes past the end of the video (30:00). Choose an end inside it.',
    });
    expect(
      checkClipParts(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: null, endMs: 2000 },
        ],
        2000,
      ),
    ).toEqual({
      ok: false,
      message: 'Part 2: type its start and end as seconds, such as 600, or as a time, such as 10:00.',
    });
  });
  it('waits for the video’s length before it can check an end', () => {
    expect(
      checkClipParts(
        [
          { startMs: 0, endMs: null },
          { startMs: 1000, endMs: 2000 },
        ],
        null,
      ),
    ).toEqual({
      ok: false,
      message: 'Part 1: type its start and end as seconds, such as 600, or as a time, such as 10:00.',
    });
    expect(
      checkClipParts(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 1000, endMs: 2000 },
        ],
        null,
      ).ok,
    ).toBe(true);
  });
  it(`joins at most ${String(CLIP_PARTS_MOST)} parts`, () => {
    const parts = Array.from({ length: CLIP_PARTS_MOST + 1 }, (_, k) => ({ startMs: k * 1000, endMs: k * 1000 + 500 }));
    expect(checkClipParts(parts.slice(0, CLIP_PARTS_MOST), 60_000).ok).toBe(true);
    expect(checkClipParts(parts, 60_000)).toEqual({
      ok: false,
      message: `An export joins at most ${String(CLIP_PARTS_MOST)} parts. Remove a part, then export again.`,
    });
  });
  it('says what the joined clip holds, in time order, and how long it is', () => {
    expect(
      clipPartsSummary([
        { startMs: 0, endMs: 10 * MIN },
        { startMs: 20 * MIN, endMs: 30 * MIN },
      ]),
    ).toBe('Export clip… joins 2 parts, in time order: 0:00 to 10:00, then 20:00 to 30:00. The new video is 20:00 long.');
    expect(
      clipPartsSummary([
        { startMs: 350, endMs: 1000 },
        { startMs: 1500, endMs: 1750 },
        { startMs: 2000, endMs: 3000 },
      ]),
    ).toBe(
      'Export clip… joins 3 parts, in time order: 0:00.350 to 0:01, then 0:01.500 to 0:01.750, then 0:02 to 0:03. The new video is 0:01.900 long.',
    );
  });
  it('says joined parts use the original picture and sound', () => {
    expect(JOINED_PARTS_ORIGINAL).toBe(
      'Joined parts use the original picture and sound. Choose Original under Picture and sound.',
    );
  });
});

describe('a joined clip’s export request', () => {
  const one = {
    mediaId: 'video',
    startMs: 0,
    endMs: 10 * MIN,
    frame: 'original' as const,
    shape: 'source' as const,
    container: 'mp4' as const,
    addToLibrary: true,
    revision: null,
  };
  const parts = [
    { startMs: 0, endMs: 10 * MIN },
    { startMs: 20 * MIN, endMs: 30 * MIN },
  ];
  it('is today’s request, unchanged, for one part', () => {
    expect(clipExportRequestSchema.safeParse(one).success).toBe(true);
  });
  it('takes two or more parts in time order, its start the first one’s and its end the last one’s', () => {
    expect(clipExportRequestSchema.safeParse({ ...one, endMs: 30 * MIN, parts }).success).toBe(true);
    expect(clipPartsInOrder(parts)).toBe(true);
  });
  it('refuses parts out of order, overlapping, empty, alone, too many, or not matching its start and end', () => {
    const refused = [
      { ...one, endMs: 30 * MIN, parts: [...parts].reverse() },
      {
        ...one,
        endMs: 30 * MIN,
        parts: [
          { startMs: 0, endMs: 21 * MIN },
          { startMs: 20 * MIN, endMs: 30 * MIN },
        ],
      },
      {
        ...one,
        endMs: 30 * MIN,
        parts: [
          { startMs: 0, endMs: 0 },
          { startMs: 20 * MIN, endMs: 30 * MIN },
        ],
      },
      { ...one, parts: [{ startMs: 0, endMs: 10 * MIN }] },
      { ...one, endMs: 29 * MIN, parts },
      { ...one, startMs: 1000, endMs: 30 * MIN, parts },
      {
        ...one,
        endMs: 11_000,
        parts: Array.from({ length: CLIP_PARTS_MOST + 1 }, (_, k) => ({ startMs: k * 1000, endMs: k * 1000 + 500 })).map(
          (p, k, all) => (k === all.length - 1 ? { ...p, endMs: 11_000 } : p),
        ),
      },
      { ...one, endMs: 30 * MIN, parts: [{ ...parts[0], extra: 1 }, parts[1]] },
    ];
    for (const request of refused)
      expect(clipExportRequestSchema.safeParse(request).success, JSON.stringify(request.parts)).toBe(false);
    expect(clipPartsInOrder([...parts].reverse())).toBe(false);
  });
});
