import { describe, expect, it } from 'vitest';
import {
  PLAIN_VIDEO_EDIT,
  parseVideoEditTime,
  videoEditNeedsCopy,
  videoEditRecipeSchema,
} from './video-edit';

describe('Edit Video source-time recipes', () => {
  it('parses minutes/hours and milliseconds, rejecting ambiguous or impossible time fields', () => {
    expect(parseVideoEditTime('1:02.125')).toBe(62125);
    expect(parseVideoEditTime('1:02:03.040')).toBe(3723040);
    expect(parseVideoEditTime('0:00')).toBe(0);
    for (const text of ['-1', '1:60', '1:02:60', '1e4', 'NaN', 'Infinity', '1:02.1234', ''])
      expect(parseVideoEditTime(text), text).toBeNull();
  });

  it('rejects invalid crops, non-finite rates, inverted trims and unknown fields at the IPC boundary', () => {
    expect(videoEditRecipeSchema.safeParse(PLAIN_VIDEO_EDIT).success).toBe(true);
    for (const value of [
      { ...PLAIN_VIDEO_EDIT, speed: Infinity },
      { ...PLAIN_VIDEO_EDIT, speed: 0.49 },
      { ...PLAIN_VIDEO_EDIT, trim: { startMs: 2000, endMs: 1000 } },
      { ...PLAIN_VIDEO_EDIT, picture: { ...PLAIN_VIDEO_EDIT.picture, crop: { x: 0.8, y: 0, w: 0.5, h: 1 } } },
      { ...PLAIN_VIDEO_EDIT, path: '/not-a-renderer-path' },
    ])
      expect(videoEditRecipeSchema.safeParse(value).success).toBe(false);
  });

  it('a thumbnail alone needs no new playing file; pixel, sound and timing edits do', () => {
    expect(videoEditNeedsCopy({ ...PLAIN_VIDEO_EDIT, thumbnailMs: 1000 })).toBe(false);
    expect(videoEditNeedsCopy({ ...PLAIN_VIDEO_EDIT, speed: 0.5 })).toBe(true);
    expect(videoEditNeedsCopy({ ...PLAIN_VIDEO_EDIT, audioTrack: 1 })).toBe(true);
    expect(
      videoEditNeedsCopy({ ...PLAIN_VIDEO_EDIT, picture: { ...PLAIN_VIDEO_EDIT.picture, zoom: 2 } }),
    ).toBe(true);
  });
});
