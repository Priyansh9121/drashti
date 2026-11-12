import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { frameAtOrBefore } from './frame-at';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

it('gives FFmpeg an end time so a frame read cannot outlive its part of the video', async () => {
  const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

  const frame = frameAtOrBefore('ffmpeg', 'placeholder.mp4', 1250);
  child.emit('close', 0);

  expect(await frame).toBeNull();
  const args = vi.mocked(spawn).mock.calls[0]?.[1] ?? [];
  expect(args).toContain('-to');
  expect(args[args.indexOf('-to') + 1]).toBe('2.250');
});
