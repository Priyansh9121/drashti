import { app, type WebContents } from 'electron';
import { execFileSync } from 'node:child_process';
import { STREAM_PRESETS } from '../../shared/stream';
import type { StreamService } from './stream-service';

/*
 * For the hand-run performance check (DRASHTI_SELFTEST=performance with
 * DRASHTI_PERF_STREAM=<rtmp address>): stream and record while the slide
 * changes are measured, so streaming can be seen not to slow the hall's
 * screens, and say how much of the computer the whole of Drashti and its
 * FFmpeg used meanwhile. Only ever to an address on this computer, with a
 * made-up key.
 */

const PERF_KEY = 'test-made-up-key-perf-0000';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** CPU seconds used so far by FFmpeg processes started by this app (macOS and Linux; null elsewhere). */
function ffmpegCpuSeconds(): number | null {
  if (process.platform === 'win32') return null;
  try {
    const rows = execFileSync('ps', ['-A', '-o', 'ppid=,time=,comm=']).toString().trim().split('\n');
    const ours = new Set(app.getAppMetrics().map((m) => m.pid));
    let total = 0;
    for (const row of rows) {
      const [ppid = '', time = '', ...comm] = row.trim().split(/\s+/u);
      if (!ours.has(Number(ppid)) || !comm.join(' ').includes('ffmpeg')) continue;
      const parts = time.split(':').map(Number);
      total += parts.reduce((s, p) => s * 60 + p, 0);
    }
    return total;
  } catch {
    return null;
  }
}

const appCpuSeconds = () => app.getAppMetrics().reduce((s, m) => s + (m.cpu.cumulativeCPUUsage ?? 0), 0);

export interface PerfStream {
  /** What it was like while measured. */
  summary(): string;
  stop(): Promise<void>;
}

export async function startPerfStream(
  stream: StreamService,
  operator: WebContents,
  url: string,
  folder: string,
): Promise<PerfStream> {
  stream.watchPreview(operator, true);
  for (let i = 0; i < 100; i++) {
    const s = stream.status();
    if (s.inputs.cameras.length > 0 && s.inputs.microphones.length > 0) break;
    await sleep(100);
  }
  const inputs = stream.status().inputs;
  const profile = stream.activeProfile();
  const saved = stream.saveProfile(profile.id, {
    name: 'Performance check',
    url,
    preset: 'good',
    camera: inputs.cameras[0] ?? null,
    sound: inputs.microphones[0] ?? null,
    soundDelayMs: 0,
    mixOwnSound: true,
  });
  if (!saved.ok) throw new Error(saved.message);
  const key = stream.setKey(profile.id, PERF_KEY);
  if (!key.ok) throw new Error(key.message);
  stream.setRecordingFolder(folder);
  const rec = stream.startRecording();
  const live = stream.goLive();
  if (!rec.ok || !live.ok) throw new Error(`${rec.ok ? '' : rec.message} ${live.ok ? '' : live.message}`);
  for (let i = 0; i < 300 && stream.status().live.state !== 'live'; i++) await sleep(100);
  // Settle, then measure CPU for a while with only the stream and the recording going on (the
  // slide changes and the import come after, and would be counted too).
  await sleep(3000);
  const start = { at: performance.now(), app: appCpuSeconds(), ffmpeg: ffmpegCpuSeconds() };
  await sleep(15_000);
  const end = { at: performance.now(), app: appCpuSeconds(), ffmpeg: ffmpegCpuSeconds() };
  const ms = end.at - start.at;
  const cores = (seconds: number) => `${Math.round((seconds / (ms / 1000)) * 100)}%`;
  const cpu = `CPU over ${Math.round(ms / 1000)} s of streaming and recording alone, as a share of one core: Drashti's processes ${cores(end.app - start.app)}, FFmpeg ${end.ffmpeg !== null && start.ffmpeg !== null ? cores(end.ffmpeg - start.ffmpeg) : 'not measured here'}`;
  return {
    summary: () => {
      const s = stream.status();
      return `streaming ${STREAM_PRESETS.good.label} (${s.encoder ?? 'no encoder'}) and recording through the slide changes: ${s.live.state}, ${s.live.fps?.toFixed(1) ?? '—'} fps, ${s.live.droppedFrames} frames dropped, ${s.live.reconnects} reconnections; ${cpu}`;
    },
    stop: async () => {
      stream.end();
      stream.stopRecording();
      stream.watchPreview(operator, false);
      await sleep(1000);
    },
  };
}
