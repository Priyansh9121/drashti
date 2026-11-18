import { describe, expect, it } from 'vitest';
import { startCountdownFields } from './audience-timer';
import { CALENDAR_FORMAT, readCalendarFile } from './calendar';
import { kirtanCategorySchema } from './kirtans';
import { mediaMarkersInputSchema, mediaMarkersSchema } from './markers';
import { messageTemplateSchema } from './messages';
import { nodeNameFrom, nodeNameSchema } from './nodes-schema';
import { newItemsSchema, slotSchema, templateRequestSchema } from './playlists';
import { stageLayoutNameSchema } from './stage-layouts';
import { YOUTUBE_RTMPS_URL } from './stream';
import { streamProfileInputSchema } from './stream-schema';
import { timerFieldsSchema } from './timers';
import { rowTrimRequestSchema } from './trim';
import { videoInputNameSchema } from './video-inputs';

/*
 * The names still only trimmed before C15 (Session 58, FT-1; X3's "Not changed" list) get X3's cleaning, on input only:
 * a tab or a line break becomes a space, hidden text-direction marks are left out, and a name with nothing visible in
 * it is refused like an empty one (shared/rename-name.ts).
 */

/** A zero-width space, a word joiner and a soft hyphen: nothing a person sees. */
const NOTHING = '\u200B\u2060\u00AD';
/** A name with a hidden direction mark (copied words can bring one), and one with a tab. */
const MARKED = 'Placeholder\u200E hall';
const TABBED = 'Placeholder\thall';
const KEPT = 'Placeholder hall';

describe('names given to Drashti, cleaned as Rename… cleans one (C15, FT-1)', () => {
  it('a node’s name, renamed or as it pairs', () => {
    expect(nodeNameSchema.safeParse(NOTHING).success).toBe(false);
    expect(nodeNameSchema.parse(MARKED)).toBe(KEPT);
    expect(nodeNameSchema.parse(TABBED)).toBe(KEPT);
    // Its computer's name as it pairs: nothing visible left is "Node", as an empty one is.
    expect(nodeNameFrom(`${NOTHING}.local`)).toBe('Node');
    expect(nodeNameFrom('Placeholder\u202E-Mac.local')).toBe('Placeholder-Mac');
  });

  it('a stage layout’s', () => {
    expect(stageLayoutNameSchema.safeParse(NOTHING).success).toBe(false);
    expect(stageLayoutNameSchema.parse(MARKED)).toBe(KEPT);
  });

  it('a template’s, a slot’s label and category, and a header’s as it is added', () => {
    expect(templateRequestSchema.safeParse({ name: NOTHING, slots: [] }).success).toBe(false);
    expect(templateRequestSchema.parse({ name: MARKED, slots: [] }).name).toBe(KEPT);
    expect(slotSchema.safeParse({ label: NOTHING, category: null }).success).toBe(false);
    expect(slotSchema.safeParse({ label: KEPT, category: NOTHING }).success).toBe(false);
    expect(slotSchema.parse({ label: TABBED, category: MARKED })).toEqual({ label: KEPT, category: KEPT });
    expect(newItemsSchema.safeParse([{ kind: 'header', label: NOTHING }]).success).toBe(false);
    expect(newItemsSchema.parse([{ kind: 'header', label: MARKED }])).toEqual([
      { kind: 'header', label: KEPT },
    ]);
  });
});

/*
 * The names still only trimmed after C15 (Session 59, X14; C15's "Left over"): a timer's, a message's, a marker's, a
 * stream profile's, a calendar file's, a phone's video input's and a kirtans' category's, as each is given (never as
 * kept: a name kept before is never cleaned again).
 */
describe('the other names given to Drashti, cleaned the same way (X14)', () => {
  it('a timer’s', () => {
    const fields = startCountdownFields('19:30');
    expect(timerFieldsSchema.safeParse({ ...fields, name: NOTHING }).success).toBe(false);
    expect(timerFieldsSchema.parse({ ...fields, name: MARKED }).name).toBe(KEPT);
    expect(timerFieldsSchema.parse({ ...fields, name: TABBED }).name).toBe(KEPT);
  });

  it('a message template’s (its words stay as typed)', () => {
    const given = { name: MARKED, template: 'Placeholder {plate} please move', fields: {} };
    expect(messageTemplateSchema.safeParse({ ...given, name: NOTHING }).success).toBe(false);
    expect(messageTemplateSchema.parse(given).name).toBe(KEPT);
  });

  it('a marker’s, set in Markers and in a playlist row’s trim', () => {
    const points = (name: string) => ({
      startMs: null,
      endMs: null,
      markers: [{ id: 'm1', name, atMs: 1000 }],
    });
    expect(mediaMarkersInputSchema.safeParse(points(NOTHING)).success).toBe(false);
    expect(mediaMarkersInputSchema.parse(points(TABBED)).markers[0]?.name).toBe(KEPT);
    expect(rowTrimRequestSchema.safeParse({ mediaId: 'placeholder', points: points(NOTHING) }).success).toBe(
      false,
    );
    expect(
      rowTrimRequestSchema.parse({ mediaId: 'placeholder', points: points(MARKED) }).points.markers[0]?.name,
    ).toBe(KEPT);
    // As kept: read as it was.
    expect(mediaMarkersSchema.parse(points(MARKED)).markers[0]?.name).toBe(MARKED);
  });

  it('a stream profile’s', () => {
    const profile = {
      name: MARKED,
      url: YOUTUBE_RTMPS_URL,
      preset: 'weak',
      camera: null,
      sound: null,
      soundDelayMs: 250,
      mixOwnSound: true,
    };
    expect(streamProfileInputSchema.safeParse({ ...profile, name: NOTHING }).success).toBe(false);
    expect(streamProfileInputSchema.parse(profile).name).toBe(KEPT);
  });

  it('a calendar file’s, as it is imported', () => {
    const file = (name: string) => ({
      format: CALENDAR_FORMAT,
      version: 1,
      name,
      days: [
        {
          date: '2026-11-18',
          samvat: 1001,
          month: { en: 'Placeholder month' },
          paksha: { en: 'First half' },
          tithi: { en: 'Placeholder tithi 3' },
        },
      ],
    });
    expect(readCalendarFile(file(NOTHING)).ok).toBe(false);
    const read = readCalendarFile(file(TABBED));
    expect(read.ok ? read.calendar.name : read.message).toBe(KEPT);
  });

  it('a phone’s video input’s, and a kirtans’ category’s', () => {
    expect(videoInputNameSchema.safeParse(NOTHING).success).toBe(false);
    expect(videoInputNameSchema.parse(MARKED)).toBe(KEPT);
    expect(kirtanCategorySchema.safeParse(NOTHING).success).toBe(false);
    expect(kirtanCategorySchema.parse(TABBED)).toBe(KEPT);
  });
});
