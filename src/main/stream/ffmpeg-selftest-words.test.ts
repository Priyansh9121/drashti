import type * as ChildProcesses from 'node:child_process';
import { type ChildProcess, spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { ffmpegHere, testFfmpeg } from '../testing/ffmpeg-here';
import { ffmpegSelfTest } from './ffmpeg-selftest';

/*
 * FFmpeg's own check (DRASHTI_SELFTEST=ffmpeg: scripts/check-ffmpeg.mjs on every CI build, and by hand on the mandir's
 * machines) on a busy computer (a21, after x58): every FFmpeg started here tells of its exit before anything it wrote
 * has been read (testing/words-after-exit.ts), as a busy computer may. Its version line and its protocols list are
 * read whole all the same.
 */

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcesses>();
  const { wordsAfterExit } = await import('../testing/words-after-exit');
  const spawn = ((...args: unknown[]) =>
    wordsAfterExit((actual.spawn as (...a: unknown[]) => ChildProcess)(...args))) as typeof actual.spawn;
  return { ...actual, spawn, default: { ...actual, spawn } };
});

const ffmpeg = testFfmpeg({ linux: true });

describe.skipIf(!ffmpegHere(ffmpeg))('FFmpeg’s own check', () => {
  it('reads its version and protocols whole even when its exit is told before its words are read', async () => {
    // What this FFmpeg says, read here without the busy computer's order.
    const said = (args: string[]) => spawnSync(ffmpeg, ['-hide_banner', ...args]).stdout.toString();
    const version = said(['-version']).split('\n')[0]?.trim() ?? '';
    const rtmps = /^\s*rtmps\s*$/mu.test(said(['-protocols']));
    expect(version).toMatch(/^ffmpeg version /u);
    // Its encoders as on Linux: libx264 alone, which every FFmpeg Drashti runs has.
    const checked = await ffmpegSelfTest(ffmpeg, 'linux');
    expect(checked).toMatchObject({ version, rtmps });
    expect(checked.encoders).toEqual([{ name: 'libx264', label: 'x264 (software)', works: true }]);
  });
});
