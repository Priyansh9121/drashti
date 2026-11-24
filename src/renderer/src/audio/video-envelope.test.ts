import { expect, it, vi } from 'vitest';
import { applyVideoEnvelope } from './video-envelope';
import type { Sound } from './sounds';

function node() {
  const gain = { cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  return { made: { context: { currentTime: 3, state: 'running' }, gain } as unknown as GainNode, gain };
}
const fade = {
  id: 'pair',
  at: 10_000,
  durationMs: 2000,
  from: {
    kind: 'media' as const,
    media: 'video' as const,
    mediaId: 'first',
    startedAt: 0,
    loop: false,
    fit: 'fit' as const,
  },
};
const sound: Sound = {
  key: 'second',
  kind: 'video',
  mediaId: 'second',
  startedAt: 0,
  loop: false,
  volume: 1,
  envelope: { fade, role: 'in' },
};
it('schedules the entire sound fade on the audio clock before its engine moment', () => {
  const { made, gain } = node();
  applyVideoEnvelope(made, sound, 9500);
  expect(gain.setValueAtTime.mock.calls).toEqual([
    [0, 3],
    [0, 3.5],
  ]);
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 5.5);
  applyVideoEnvelope(made, sound, 9600);
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
});
it('holds a paused curve and keeps a private cue completely silent', () => {
  const a = node();
  applyVideoEnvelope(
    a.made,
    { ...sound, envelope: { fade: { ...fade, pausedAt: 10_500 }, role: 'out' } },
    99_000,
  );
  expect(a.gain.setValueAtTime).toHaveBeenCalledWith(0.75, 3);
  expect(a.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
  const b = node();
  applyVideoEnvelope(b.made, { ...sound, prepared: true }, 11_000);
  expect(b.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
  expect(b.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
});
