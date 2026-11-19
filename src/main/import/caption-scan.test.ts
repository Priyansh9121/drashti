import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';
import { scanPaths } from './scan';

it('treats caption sidecars as part of their video in a folder or a multiple-file drop, without unsupported-file notices', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-caption-scan-'));
  try {
    const video = join(dir, 'Sample.mp4');
    const caption = join(dir, 'Sample.gu.auto.srt');
    const other = join(dir, 'Other.srt');
    writeFileSync(video, 'generated video placeholder');
    writeFileSync(caption, 'placeholder SRT');
    writeFileSync(other, 'unattached placeholder SRT');
    expect((await scanPaths([dir])).files.map((f) => basename(f.path))).toEqual(['Other.srt', 'Sample.mp4']);
    expect((await scanPaths([caption, video])).files.map((f) => basename(f.path))).toEqual(['Sample.mp4']);
    expect((await scanPaths([other])).files.map((f) => basename(f.path))).toEqual(['Other.srt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
