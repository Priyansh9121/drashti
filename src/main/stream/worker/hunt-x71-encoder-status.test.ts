import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, type WriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STREAM_PRESETS } from '../../../shared/stream';
import { MkvWriter, VIDEO_TRACK } from './mkv';
import { StreamPipeline } from './pipeline';
import type { WorkerStatus } from './protocol';

const processes = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: processes.spawn,
}));

class Encoder extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = undefined;
  kill = vi.fn(() => true);
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  processes.spawn.mockReset();
});

describe('H6 encoder fault status', () => {
  for (const fault of ['exit', 'spawn-error'] as const) {
    it(`reports an encoder ${fault} immediately, and keeps that cause until new source frames are encoded`, async () => {
      vi.useFakeTimers();
      const encoders: Encoder[] = [];
      processes.spawn.mockImplementation(() => {
        const child = new Encoder();
        encoders.push(child);
        return child;
      });
      const dir = mkdtempSync(join(tmpdir(), 'drashti-x71-encoder-'));
      const reports: WorkerStatus[] = [];
      const pipeline = new StreamPipeline({
        status: (s) => {
          reports.push(s);
        },
        log: () => undefined,
        freeBytes: () => 10 * 1024 ** 3,
      });
      const format = { width: 16, height: 16, format: 'I420' as const };
      const frame = new Uint8Array((16 * 16 * 3) / 2).fill(96);
      const files: WriteStream[] = [];
      try {
        await pipeline.start({
          ffmpeg: 'generated-encoder',
          platform: process.platform,
          preset: { ...STREAM_PRESETS.weak, width: 16, height: 16 },
          encoder: 'libx264',
          caFile: null,
        });
        pipeline.fromProgram({ kind: 'format', ...format });
        pipeline.fromProgram({ kind: 'video', data: frame.buffer });
        pipeline.record(join(dir, 'Placeholder recording.mkv'), 2 * 1024 ** 3);
        const firstFile = (pipeline as unknown as { recordFile: WriteStream | null }).recordFile;
        if (firstFile) files.push(firstFile);
        expect(encoders).toHaveLength(1);
        if (fault === 'exit') encoders[0]?.emit('exit', 1);
        else
          encoders[0]?.emit(
            'error',
            Object.assign(new Error('Generated encoder start failure'), { code: 'EAGAIN' }),
          );
        console.log(
          `HUNT-x71 encoder-${fault} encoding=${String(pipeline.status().encoding)} recording=${pipeline.status().recording.state} error=${String(pipeline.status().error)}`,
        );
        expect(pipeline.status().encoding).toBe(false);
        expect(pipeline.status().error, 'operator is told that the encoder stopped').toContain('encoder');
        expect(reports.at(-1)?.error, 'failure status is delivered immediately').toContain('encoder');
        await vi.advanceTimersByTimeAsync(1000);
        expect(encoders).toHaveLength(2);
        expect(pipeline.status().error, 'spawning another encoder alone is not recovery').toContain(
          'encoder',
        );
        const writer = new MkvWriter({ ...format, fps: 30 }, { sampleRate: 48000, channels: 2 });
        // A generated OUTPUT cluster: FFmpeg resolves its size; raw MkvWriter input leaves it unknown.
        const cluster = Buffer.concat(writer.block(VIDEO_TRACK, 0, Buffer.from(frame)));
        cluster.fill(0, 4, 12);
        cluster[4] = 1;
        cluster.writeUIntBE(cluster.length - 12, 6, 6);
        pipeline.fromProgram({ kind: 'audio', data: new ArrayBuffer(480 * 2 * 4), frames: 480 });
        encoders[1]?.stdout.write(Buffer.concat([writer.header(), cluster]));
        expect(
          pipeline.status().error,
          'sound and an encoded held picture are not fresh source pictures',
        ).toContain('encoder');
        pipeline.fromProgram({ kind: 'video', data: frame.buffer });
        expect(pipeline.status().error, 'receiving a picture alone is not an encoded recovery').toContain(
          'encoder',
        );
        encoders[1]?.stdout.write(cluster);
        expect(pipeline.status().error, 'newly encoded source frames clear the fault').toBeNull();
        expect(pipeline.status().recording.file).toContain(' part 2.mkv');
        const nextFile = (pipeline as unknown as { recordFile: WriteStream | null }).recordFile;
        if (nextFile) files.push(nextFile);
      } finally {
        pipeline.stop();
        vi.clearAllTimers();
        vi.useRealTimers();
        for (const file of files) await finished(file);
        for (const child of encoders) {
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
        }
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
