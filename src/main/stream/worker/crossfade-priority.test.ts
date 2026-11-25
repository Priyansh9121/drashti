import { setPriority } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { StreamPipeline } from './pipeline';

/*
 * QA23-FADE-9, item 3 (the owner: "Try fixes, keep held (Rec.)"; a22-fade-picture's C): the stream's encoder runs at
 * normal priority during a crossfade only. Below normal ("streaming must never slow a slide change"), its input backed
 * up while three pages decoded two 1080p videos each on CI's two-core Windows, and it dropped 212-349 frames a
 * crossfade round, so the stream showed no blend. Outside crossfades it stays below normal, and the connections
 * always do.
 */

vi.mock('node:os', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setPriority: vi.fn(),
}));

afterEach(() => {
  vi.mocked(setPriority).mockClear();
});

function pipeline() {
  const p = new StreamPipeline({ status: vi.fn(), log: vi.fn() });
  return p;
}

it('raises the running encoder to normal priority through a crossfade, and back below normal after it', () => {
  const p = pipeline();
  (p as unknown as { encodeProcess: { pid: number } }).encodeProcess = { pid: 4242 };
  p.setCrossfade(true);
  expect(setPriority).toHaveBeenLastCalledWith(4242, 0);
  p.setCrossfade(false);
  expect(setPriority).toHaveBeenLastCalledWith(4242, 10);
  expect(setPriority).toHaveBeenCalledTimes(2);
});

it('says nothing twice, and with no encoder running remembers it for the next one', () => {
  const p = pipeline();
  p.setCrossfade(true);
  expect(setPriority).not.toHaveBeenCalled();
  expect((p as unknown as { encoderPriority: () => number }).encoderPriority()).toBe(0);
  (p as unknown as { encodeProcess: { pid: number } }).encodeProcess = { pid: 4343 };
  p.setCrossfade(true);
  expect(setPriority).not.toHaveBeenCalled();
  p.setCrossfade(false);
  expect(setPriority).toHaveBeenLastCalledWith(4343, 10);
  expect((p as unknown as { encoderPriority: () => number }).encoderPriority()).toBe(10);
});
