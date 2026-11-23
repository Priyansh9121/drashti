import { finished } from 'node:stream/promises';
import { mkdtempSync, rmSync, type WriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StreamPipeline } from './pipeline';
import type { WorkerStatus } from './protocol';

// A recording write can report ENOSPC even after the free-space check succeeded: another program may fill
// the disk first. Raise the native write stream's error event, without filling the shared computer's disk.
describe('H6 full disk during a recording write', () => {
  it('names the full disk to the operator rather than just saying the file could not be written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-x71-write-'));
    const reports: WorkerStatus[] = [];
    const pipeline = new StreamPipeline({
      status: (s) => {
        reports.push(s);
      },
      log: () => undefined,
      freeBytes: () => 10 * 1024 ** 3,
    });
    pipeline.record(join(dir, 'Placeholder recording.mkv'), 2 * 1024 ** 3);
    const out = (pipeline as unknown as { recordFile: WriteStream | null }).recordFile;
    if (!out) throw new Error('The recording file did not open');
    try {
      out.emit('error', Object.assign(new Error('Generated full disk'), { code: 'ENOSPC' }));
      console.log(
        `HUNT-x71 disk-write code=ENOSPC recording=${pipeline.status().recording.state} message=${String(pipeline.status().recording.message)}`,
      );
      expect(pipeline.status().recording.state).toBe('off');
      expect(pipeline.status().recording.message, 'a known full disk is named plainly').toContain(
        'disk is full',
      );
      expect(reports.at(-1)?.recording.message, 'the operator receives the actual cause').toContain(
        'disk is full',
      );
    } finally {
      pipeline.stop();
      await finished(out);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
