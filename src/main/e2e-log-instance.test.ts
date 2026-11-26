import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logLines, logText } from '../../tests/e2e/log-lines';

describe('the current app instance across midnight UTC', () => {
  it('keeps its start and both days, excluding earlier starts in the same dated file', () => {
    const userData = mkdtempSync(join(tmpdir(), 'drashti-log-instance-'));
    const dir = join(userData, 'logs');
    mkdirSync(dir);
    const start = '2026-11-23T23:59:59.800Z [info] Start: the main process running at 120 ms';
    const before = '2026-11-23T23:59:59.826Z [warn] placeholder before midnight';
    const after = '2026-11-24T00:00:00.503Z [info] placeholder after midnight';
    writeFileSync(
      join(dir, 'drashti-2026-11-23.log'),
      [
        '2026-11-23T22:00:00.000Z [info] Start: the main process running at 100 ms',
        '2026-11-23T22:00:01.000Z [warn] placeholder from a previous instance',
        start,
        before,
        '',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'drashti.log'), `${after}\n`);
    const lines = logLines(userData).filter(Boolean);
    expect(lines).toEqual([start, before, after]);
    expect(logText(userData)).not.toContain('previous instance');
    // A later start in today's file becomes the current instance, even within the same millisecond.
    const next = '2026-11-24T00:00:00.503Z [info] Start: the main process running at 90 ms';
    writeFileSync(join(dir, 'drashti.log'), `${after}\n${next}\n`);
    expect(logLines(userData).filter(Boolean)).toEqual([next]);
  });
});
