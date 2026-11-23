import { finished } from 'node:stream/promises';
import { mkdtempSync, readFileSync, rmSync, type WriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StreamPipeline } from './pipeline';
import type { WorkerStatus } from './protocol';

// Delayed allocation can report a full disk at fdatasync rather than write. Exercise that syscall's callback,
// without filling this shared computer's disk or launching a real camera, encoder or network connection.
interface RecordingInternals {
  keepOnDisk(now: number): void;
  writeRecording(parts: Buffer[]): void;
  recordFile: WriteStream | null;
}

describe('H6 recording durability failures', () => {
  for (const code of ['ENOSPC', 'EIO']) {
    it(`${code} from the disk flush stops recording and reports the failure to the operator`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'drashti-x71-sync-'));
      const file = join(dir, 'Placeholder recording.mkv');
      const reports: WorkerStatus[] = [];
      let complete: ((error: NodeJS.ErrnoException | null) => void) | null = null;
      const pipeline = new StreamPipeline({
        status: (s) => {
          reports.push(s);
        },
        log: () => undefined,
        freeBytes: () => 10 * 1024 ** 3,
        datasync: (_fd, done) => {
          complete = done;
        },
      });
      const internals = pipeline as unknown as RecordingInternals;
      pipeline.record(file, 2 * 1024 ** 3);
      const out = internals.recordFile;
      if (!out) throw new Error('The recording file did not open');
      try {
        const content = Buffer.from('generated recording bytes already written');
        internals.writeRecording([content]);
        internals.keepOnDisk(Date.now() + 8000);
        expect(complete, 'the periodic disk flush was requested').not.toBeNull();
        const fail = complete as unknown as (error: NodeJS.ErrnoException) => void;
        fail(Object.assign(new Error('Generated disk failure'), { code }));
        console.log(
          `HUNT-x71 disk-sync code=${code} recording=${pipeline.status().recording.state} message=${String(pipeline.status().recording.message)}`,
        );
        expect(
          pipeline.status().recording.state,
          'never claims recording after the disk cannot keep its bytes',
        ).toBe('off');
        expect(pipeline.status().recording.message).toContain('disk');
        expect(reports.at(-1)?.recording.state, 'the operator receives the failure immediately').toBe('off');
        expect(reports.at(-1)?.recording.message).toContain('disk');
        await finished(out);
        expect(readFileSync(file)).toEqual(content);
      } finally {
        pipeline.stop();
        await finished(out);
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
