import { describe, expect, it } from 'vitest';
import { parsePlain } from './plain-parse';
import { pacificMidnightAfter } from './youtube';
import { googleClientIdSchema, googleClientSecretSchema, youtubeScheduleSchema } from './youtube-schema';

/* What the YouTube section sends, as the main process reads it (x31), and when YouTube's day ends. */

describe('the end of YouTube’s quota day', () => {
  it('is the next midnight in California, its summer time included', () => {
    // 19 Nov 2026, 12:00 UTC is 04:00 in California (UTC-8): the day ends at 08:00 UTC on the 20th.
    expect(new Date(pacificMidnightAfter(Date.UTC(2026, 10, 19, 12))).toISOString()).toBe(
      '2026-11-20T08:00:00.000Z',
    );
    // 1 Jul 2026, 06:59 UTC is 23:59 on 30 Jun in California (UTC-7): one minute left.
    expect(new Date(pacificMidnightAfter(Date.UTC(2026, 6, 1, 6, 59))).toISOString()).toBe(
      '2026-07-01T07:00:00.000Z',
    );
  });
});

describe('a broadcast to schedule', () => {
  const base = {
    title: 'Placeholder sabha',
    description: 'Placeholder words.',
    startsAt: Date.UTC(2030, 0, 5, 12),
    privacy: 'unlisted',
    madeForKids: false,
    profileId: null,
  };
  const read = (input: unknown) => parsePlain(youtubeScheduleSchema, input, 'Check it.');

  it('keeps a title on one line, a description’s lines, and refuses what YouTube refuses', () => {
    expect(
      read({ ...base, title: '  Placeholder\tsabha\n', description: 'Line one\r\nLine two\u200e' }),
    ).toEqual({
      success: true,
      data: { ...base, title: 'Placeholder sabha', description: 'Line one\nLine two' },
    });
    expect(read({ ...base, title: ' ' })).toMatchObject({
      success: false,
      message: 'Give the broadcast a title.',
    });
    expect(read({ ...base, title: 'x'.repeat(101) })).toMatchObject({
      success: false,
      message: 'A title on YouTube is at most 100 characters.',
    });
    expect(read({ ...base, title: 'A <b> title' })).toMatchObject({
      success: false,
      message: 'A title on YouTube cannot hold < or >.',
    });
    expect(read({ ...base, description: 'x'.repeat(5001) })).toMatchObject({
      success: false,
      message: 'A description on YouTube is at most 5,000 characters.',
    });
    expect(read({ ...base, privacy: 'secret' })).toMatchObject({ success: false });
  });

  it('takes a Client ID only as Google writes one, and a secret only of its own letters', () => {
    expect(googleClientIdSchema.safeParse(' 000000000000-abc.apps.googleusercontent.com ').success).toBe(
      true,
    );
    expect(googleClientIdSchema.safeParse('test-made-up-client-secret-0000').success).toBe(false);
    expect(googleClientSecretSchema.safeParse('test-made-up-client-secret-0000').success).toBe(true);
    expect(googleClientSecretSchema.safeParse('has spaces in it').success).toBe(false);
  });
});
