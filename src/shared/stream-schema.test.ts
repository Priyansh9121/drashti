import { describe, expect, it } from 'vitest';
import { STREAM_PRESETS, YOUTUBE_RTMPS_URL } from './stream';
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

  it('presets follow YouTube’s minimums: 1080p30 at 6 Mbps, 720p30 at 3, AAC 128 kbps, a keyframe every 2 s', () => {
    expect(STREAM_PRESETS.good).toMatchObject({ width: 1920, height: 1080, fps: 30, videoKbps: 6000 });
    expect(STREAM_PRESETS.weak).toMatchObject({ width: 1280, height: 720, fps: 30, videoKbps: 3000 });
    for (const p of Object.values(STREAM_PRESETS))
      expect(p).toMatchObject({ audioKbps: 128, keyframeSeconds: 2, sampleRate: 48_000 });
  });
});
