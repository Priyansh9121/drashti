import { describe, expect, it } from 'vitest';
import { placeName, STREAM_PRESETS, uploadNeededMbps, YOUTUBE_RTMPS_URL } from './stream';
import { streamKeySchema, streamProfileInputSchema, streamUrlSchema } from './stream-schema';

describe('stream settings', () => {
  it('take an rtmps:// or rtmp:// address with no key, query or login in it', () => {
    expect(streamUrlSchema.safeParse(YOUTUBE_RTMPS_URL).success).toBe(true);
    expect(streamUrlSchema.safeParse('rtmp://127.0.0.1:1935/live2').success).toBe(true);
    for (const bad of [
      'https://youtube.com',
      'rtmps://a.rtmps.youtube.com/live2?key=x',
      'rtmps://u:p@host/x',
      'nonsense',
    ])
      expect(streamUrlSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('take a key that cannot change the address it goes on', () => {
    expect(streamKeySchema.safeParse('abcd-efgh-ijkl-mnop-qrst').success).toBe(true);
    for (const bad of ['short', 'has space-in-it-0000', 'slash/in/the/key0000', 'q?uery=key000000'])
      expect(streamKeySchema.safeParse(bad).success, bad).toBe(false);
  });

  it('take a profile with a preset, inputs and a delay up to a second', () => {
    const profile = {
      name: 'YouTube',
      url: YOUTUBE_RTMPS_URL,
      preset: 'weak',
      camera: { id: 'cam', label: 'Camera' },
      sound: null,
      soundDelayMs: 250,
      mixOwnSound: true,
    };
    expect(streamProfileInputSchema.safeParse(profile).success).toBe(true);
    expect(streamProfileInputSchema.safeParse({ ...profile, soundDelayMs: 1500 }).success).toBe(false);
    expect(streamProfileInputSchema.safeParse({ ...profile, preset: 'best' }).success).toBe(false);
  });

  it('several platforms (Session 28): two more places at most, each an address with no key in it', () => {
    const profile = {
      name: 'Several',
      url: YOUTUBE_RTMPS_URL,
      preset: 'several',
      camera: null,
      sound: null,
      soundDelayMs: 0,
      mixOwnSound: false,
    };
    const facebook = { url: 'rtmps://live-api-s.facebook.com:443/rtmp' };
    const other = { id: 'kept-place', url: 'rtmp://127.0.0.1:1935/live' };
    expect(streamProfileInputSchema.safeParse({ ...profile, more: [facebook, other] }).success).toBe(true);
    expect(streamProfileInputSchema.safeParse({ ...profile, more: [facebook, other, other] }).success).toBe(
      false,
    );
    expect(
      streamProfileInputSchema.safeParse({ ...profile, more: [{ url: 'rtmps://a.example/live?key=x' }] })
        .success,
    ).toBe(false);
    expect(STREAM_PRESETS.several).toMatchObject({ width: 1920, height: 1080, fps: 30, videoKbps: 5000 });
    // The upload each needs, with a third to spare: no speed test.
    expect(uploadNeededMbps(STREAM_PRESETS.several, 1)).toBe(7);
    expect(uploadNeededMbps(STREAM_PRESETS.several, 3)).toBe(20);
    expect(uploadNeededMbps(STREAM_PRESETS.good, 1)).toBe(8);
  });

  it('Facebook (decision 19, widen nothing): a made-up key of its shape and length is taken as it is; its address must be secure', () => {
    // Letters, digits, dashes and underscores, about as long as Facebook's own: made up.
    const madeUp = 'FB-1234567890123456-0-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv_Wx-Yz1Ab2Cd3Ef4Gh5Ij6Kl7';
    expect(madeUp.length).toBeGreaterThan(60);
    expect(streamKeySchema.safeParse(madeUp)).toEqual({ success: true, data: madeUp });
    expect(streamUrlSchema.safeParse('rtmps://live-api-s.facebook.com:443/rtmp').success).toBe(true);
    expect(streamUrlSchema.safeParse('rtmp://live-api-s.facebook.com:80/rtmp').success).toBe(false);
    expect(placeName('rtmps://live-api-s.facebook.com:443/rtmp')).toBe('Facebook');
    expect(placeName('rtmps://a.rtmps.youtube.com/live2')).toBe('YouTube');
    expect(placeName('rtmp://127.0.0.1:1935/live')).toBe('the stream server');
  });

  it('presets follow YouTube’s minimums: 1080p30 at 6 Mbps, 720p30 at 3, AAC 128 kbps, a keyframe every 2 s', () => {
    expect(STREAM_PRESETS.good).toMatchObject({ width: 1920, height: 1080, fps: 30, videoKbps: 6000 });
    expect(STREAM_PRESETS.weak).toMatchObject({ width: 1280, height: 720, fps: 30, videoKbps: 3000 });
    for (const p of Object.values(STREAM_PRESETS))
      expect(p).toMatchObject({ audioKbps: 128, keyframeSeconds: 2, sampleRate: 48_000 });
  });
});
