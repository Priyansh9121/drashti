import { spawn } from 'node:child_process';
import { STREAM_PRESETS } from '../../shared/stream';
import { encoderCandidates, tryEncoder } from './worker/encoders';

/*
 * DRASHTI_SELFTEST=ffmpeg: on a built or packaged app, check that Drashti
 * finds its own FFmpeg and can run it: its version, RTMPS, and which H.264
 * encoders work on this computer (a one-second test encode each). Used by
 * scripts/check-ffmpeg.mjs on every CI build, and by hand on the mandir's
 * machines.
 */

export interface FfmpegSelfTestResult {
  passed: boolean;
  path: string | null;
  version: string | null;
  rtmps: boolean;
  encoders: { name: string; label: string; works: boolean }[];
  chosen: string | null;
}

function run(path: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(path, args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => {
      resolve('');
    });
    child.on('exit', () => {
      resolve(out);
    });
  });
}

export async function ffmpegSelfTest(path: string | null, platform: NodeJS.Platform): Promise<FfmpegSelfTestResult> {
  if (!path) return { passed: false, path, version: null, rtmps: false, encoders: [], chosen: null };
  const version = (await run(path, ['-hide_banner', '-version'])).split('\n')[0]?.trim() || null;
  const protocols = await run(path, ['-hide_banner', '-protocols']);
  const rtmps = /^\s*rtmps\s*$/mu.test(protocols);
  const encoders = [];
  for (const c of encoderCandidates(platform))
    encoders.push({ name: c.name, label: c.label, works: await tryEncoder(path, c.name, STREAM_PRESETS.weak) });
  const chosen = encoders.find((e) => e.works)?.label ?? null;
  return { passed: version !== null && rtmps && chosen !== null, path, version, rtmps, encoders, chosen };
}
