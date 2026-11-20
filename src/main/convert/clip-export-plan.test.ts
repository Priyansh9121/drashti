import { describe, expect, it } from 'vitest';
import type { MediaInfo } from './plan';
import { clipExportArgs } from './clip-export-plan';
const picture = { codec: 'h264', pixFmt: 'yuv420p', width: 1920, height: 1080, still: false };
const info: MediaInfo = {
  durationMs: 4000,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  video: picture,
  audio: { codec: 'aac' },
};
describe('frame-exact clip exports', () => {
  it('accurately decodes a non-keyframe range into a new fast-start MP4 and selects the requested audio', () => {
    const args = clipExportArgs(
      { source: 'placeholder source.mp4', startMs: 350, endMs: 1750, shape: 'source', info, audioTrack: 1 },
      'placeholder clip.mp4',
    );
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 6)).toEqual([
      '-ss',
      '0.350',
      '-i',
      'placeholder source.mp4',
      '-t',
      '1.400',
    ]);
    expect(args).toContain('libx264');
    expect(args).toContain('0:a:1');
    expect(args).toContain('+faststart');
    expect(args).not.toContain('copy');
    expect(args.at(-1)).toBe('placeholder clip.mp4');
  });
  it('makes a central 9:16 crop without stretching or touching the original', () => {
    const args = clipExportArgs(
      { source: 'placeholder source.mp4', startMs: 0, endMs: 1000, shape: 'vertical', info },
      'placeholder vertical.mp4',
    );
    expect(args[args.indexOf('-vf') + 1]).toContain('crop=');
    expect(args[args.indexOf('-vf') + 1]).toContain('9/16');
    expect(args[args.indexOf('-vf') + 1]).toContain('setsar=1');
  });
  it('rejects out-of-range or reversed intervals before any output is queued', () => {
    for (const [startMs, endMs] of [
      [-1, 1000],
      [3000, 2000],
      [0, 4500],
    ])
      expect(() =>
        clipExportArgs(
          { source: 'placeholder.mp4', startMs: startMs ?? 0, endMs: endMs ?? 0, shape: 'source', info },
          'clip.mp4',
        ),
      ).toThrow();
  });
  it('retains alpha and a source without sound, and normalizes its pixel shape', () => {
    const args = clipExportArgs(
      {
        source: 'placeholder.webm',
        startMs: 0,
        endMs: 1000,
        shape: 'vertical',
        info: { ...info, video: { ...picture, codec: 'vp9', pixFmt: 'yuva420p' }, audio: null },
      },
      'clip.webm',
    );
    expect(args).toContain('libvpx-vp9');
    expect(args).toContain('yuva420p');
    expect(args).not.toContain('0:a:0');
  });
});
