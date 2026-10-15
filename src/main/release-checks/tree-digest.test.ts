import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestLine, stillAsUnpacked, treeDigest } from '../../../scripts/tree-digest.mjs';

/*
 * What the fetch scripts unpacked into vendor/ (Session 30's optional extra): reused only while it is still
 * what was unpacked. A changed byte, a file added, a link moved, all change the digest; SOURCE.txt does not.
 */

describe('what was unpacked, as one digest', () => {
  it('changes with any file, folder or link, and not with SOURCE.txt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-unpacked-'));
    writeFileSync(join(dir, 'ffmpeg'), 'a placeholder program');
    mkdirSync(join(dir, '_internal'));
    writeFileSync(join(dir, '_internal', 'lib'), 'a placeholder library');
    symlinkSync('lib', join(dir, '_internal', 'Current'));
    const first = treeDigest(dir);
    writeFileSync(join(dir, 'SOURCE.txt'), `sha256 of the download abc\n${digestLine(dir)}\n`);
    expect(treeDigest(dir)).toBe(first);
    expect(stillAsUnpacked(`sha256 of the download abc\n${digestLine(dir)}\n`, dir, 'abc')).toBe(true);
    expect(stillAsUnpacked(`sha256 of the download abc\n${digestLine(dir)}\n`, dir, 'other')).toBe(false);
    appendFileSync(join(dir, 'ffmpeg'), 'x');
    const second = treeDigest(dir);
    expect(second).not.toBe(first);
    writeFileSync(join(dir, '_internal', 'extra'), '');
    expect(treeDigest(dir)).not.toBe(second);
    const third = treeDigest(dir);
    rmSync(join(dir, '_internal', 'Current'));
    symlinkSync('extra', join(dir, '_internal', 'Current'));
    expect(treeDigest(dir)).not.toBe(third);
    // A stamp from before (no digest line): not reused.
    expect(stillAsUnpacked('sha256 of the download abc\n', dir, 'abc')).toBe(false);
  });
});
