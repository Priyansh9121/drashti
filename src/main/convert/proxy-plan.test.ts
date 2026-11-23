import { describe, expect, it } from 'vitest';
import type { MediaInfo } from './plan';
import { proxyArgs, proxyPlan } from './proxy-plan';
const picture = { codec: 'h264', pixFmt: 'yuv420p', width: 3840, height: 2160, still: false };
const source: MediaInfo = {
  durationMs: 4000,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  video: picture,
  audio: { codec: 'aac' },
};
const slow = { logicalCores: 2, softwareVideo: false };
describe('automatic lighter video copies', () => {
  it('queues an oversized source on two cores or software decoding, with an aspect-correct 1080p bound', () => {
    expect(proxyPlan(source, slow)).toEqual({ width: 1920, height: 1080, target: 'mp4' });
    expect(proxyPlan(source, { logicalCores: 8, softwareVideo: true })).toEqual({
      width: 1920,
      height: 1080,
      target: 'mp4',
    });
    expect(proxyPlan({ ...source, video: { ...picture, width: 2160, height: 3840 } }, slow)).toEqual({
      width: 1080,
      height: 1920,
      target: 'mp4',
    });
  });
  it('leaves fast computers and already-small or absent pictures alone, never upscales', () => {
    expect(proxyPlan(source, { logicalCores: 8, softwareVideo: false })).toBeNull();
    expect(proxyPlan({ ...source, video: { ...picture, width: 1280, height: 720 } }, slow)).toBeNull();
    expect(proxyPlan({ ...source, video: null }, slow)).toBeNull();
  });
  it('keeps transparency, re-encodes a playable 4K picture rather than stream-copying it, and bounds work', () => {
    const alpha = { ...source, video: { ...picture, codec: 'vp9', pixFmt: 'yuva420p' } };
    expect(proxyPlan(alpha, slow)?.target).toBe('webm-alpha');
    const args = proxyArgs('placeholder original.mp4', 'placeholder proxy.mp4', source, slow);
    expect(args).toContain('libx264');
    expect(args).not.toContain('copy');
    expect(args.slice(args.indexOf('-threads'), args.indexOf('-threads') + 2)).toEqual(['-threads', '1']);
    expect(args.slice(-1)).toEqual(['placeholder proxy.mp4']);
  });
});
