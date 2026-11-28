import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { relayArgs } from './relay-args';
import { startRelay } from './relay-process';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

it('SECNET-03: starts FFmpeg only with a local checked input and restricted demuxers/protocols', async () => {
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
    pid: undefined,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const args = relayArgs({
    url: 'http://127.0.0.1:9/live.m3u8',
    authority: { origin: 'http://127.0.0.1:9', addresses: [{ address: '127.0.0.1', family: 4 }] },
    guard: true,
    program: null,
    dir: '/placeholder',
    again: false,
  });
  const run = startRelay('/placeholder/ffmpeg', args, { started: () => undefined, ended: () => undefined });
  if (!run) throw new Error('Missing checked relay');
  try {
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const got = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    const input = got[got.indexOf('-i') + 1] ?? '';
    expect(input).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//u);
    expect(input).not.toBe('http://127.0.0.1:9/live.m3u8');
    expect(got[got.indexOf('-protocol_whitelist') + 1]).toBe('http,tcp,crypto');
    expect(got[got.indexOf('-format_whitelist') + 1]).toBe('hls,mpegts,mov,aac,mp3,webvtt');
    expect(got.indexOf('-format_whitelist')).toBeLessThan(got.indexOf('-i'));
  } finally {
    child.emit('close', 0);
    await run.done;
  }
});
it('SECNET-03: refuses a relay without the playlist reader’s authorization', () => {
  const before = vi.mocked(spawn).mock.calls.length;
  expect(
    startRelay('/placeholder/ffmpeg', ['-i', 'http://127.0.0.1/private'], {
      started: () => undefined,
      ended: () => undefined,
    }),
  ).toBeNull();
  expect(spawn).toHaveBeenCalledTimes(before);
});
