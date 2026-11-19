import { describe, expect, it } from 'vitest';
import { VIDEO_OUT_DEFAULTS, videoOutSettingsFrom, videoOutSettingsSchema } from './video-out';

describe('video out’s setting (x30)', () => {
  it('is off, named Drashti, unless someone turned it on', () => {
    expect(VIDEO_OUT_DEFAULTS).toEqual({ on: false, name: 'Drashti' });
    expect(videoOutSettingsFrom(undefined)).toEqual({ on: false, name: 'Drashti' });
    expect(videoOutSettingsFrom({ on: true })).toEqual({ on: false, name: 'Drashti' });
    expect(videoOutSettingsFrom({ on: true, name: 'Hall 2' })).toEqual({ on: true, name: 'Hall 2' });
  });

  it('takes a name of letters (any script, with vowel signs), digits, spaces and . _ ( ) -, up to 40', () => {
    const ok = (name: string) => videoOutSettingsSchema.safeParse({ on: false, name }).success;
    expect(ok('Drashti')).toBe(true);
    expect(ok('Sabha hall (main) 2')).toBe(true);
    expect(ok('દ્રષ્ટિ')).toBe(true);
    expect(ok('द्रष्टि')).toBe(true);
    expect(ok('x'.repeat(40))).toBe(true);
    expect(ok('x'.repeat(41))).toBe(false);
    expect(ok('')).toBe(false);
    expect(ok('a/b')).toBe(false);
    expect(ok('(hall)')).toBe(false);
    expect(ok('hall\n2')).toBe(false);
  });
});
