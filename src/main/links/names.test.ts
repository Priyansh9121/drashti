import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimFile, claimFolder, nameFromDisposition, safeName } from './names';

const tmp = () => mkdtempSync(join(tmpdir(), 'drashti-names-'));

describe('safe file names for both systems', () => {
  it('keeps an ordinary name as it is, in any script', () => {
    expect(safeName('Placeholder clip.mp4', 'Download')).toBe('Placeholder clip.mp4');
    expect(safeName('નમૂનો.pptx', 'Download')).toBe('નમૂનો.pptx');
  });

  it('replaces the characters Windows refuses, and control characters', () => {
    expect(safeName('a<b>c:d"e|f?g*h.mp4', 'Download')).toBe('a_b_c_d_e_f_g_h.mp4');
    expect(safeName('line\none\u0007.mp4', 'Download')).toBe('line_one_.mp4');
  });

  it('never keeps a folder part: only the last name', () => {
    expect(safeName('../../escape.mp4', 'Download')).toBe('escape.mp4');
    expect(safeName('C:\\Windows\\evil.mp4', 'Download')).toBe('evil.mp4');
    expect(safeName('/etc/passwd', 'Download')).toBe('passwd');
  });

  it('drops dots and spaces Windows cannot end a name with, and leading dots (hidden on a Mac)', () => {
    expect(safeName('clip.mp4. . ', 'Download')).toBe('clip.mp4');
    expect(safeName('...hidden.mp4', 'Download')).toBe('hidden.mp4');
  });

  it("does not use Windows' reserved device names", () => {
    expect(safeName('CON.mp4', 'Download')).toBe('_CON.mp4');
    expect(safeName('lpt1', 'Download')).toBe('_lpt1');
    expect(safeName('Console.mp4', 'Download')).toBe('Console.mp4');
  });

  it('keeps names short enough for both systems, with their extension', () => {
    const long = `${'ક'.repeat(400)}.mp4`;
    const safe = safeName(long, 'Download');
    expect(safe.endsWith('.mp4')).toBe(true);
    expect(Buffer.byteLength(safe)).toBeLessThanOrEqual(200);
  });

  it('falls back when nothing is left', () => {
    expect(safeName('', 'Download')).toBe('Download');
    expect(safeName('...', 'Download')).toBe('Download');
    expect(safeName('/', 'Download')).toBe('Download');
  });
});

describe('the name Dropbox gives a download', () => {
  it('reads filename* (UTF-8) before filename', () => {
    expect(
      nameFromDisposition(
        `attachment; filename="Placeholder clip.mp4"; filename*=UTF-8''%E0%AA%A8%E0%AA%AE%E0%AB%82%E0%AA%A8%E0%AB%8B.mp4`,
      ),
    ).toBe('નમૂનો.mp4');
    expect(nameFromDisposition('attachment; filename="Placeholder clip.mp4"')).toBe('Placeholder clip.mp4');
    expect(nameFromDisposition('attachment; filename=plain.pptx')).toBe('plain.pptx');
    expect(nameFromDisposition(null)).toBeNull();
    expect(nameFromDisposition('attachment')).toBeNull();
  });
});

describe('never writing over a file', () => {
  it('claims the name, or the next free one with (2), (3)…', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'clip.mp4'), 'already here');
    writeFileSync(join(dir, 'clip (2).mp4'), 'and this');
    const claimed = await claimFile(dir, 'clip.mp4');
    expect(claimed).toBe(join(dir, 'clip (3).mp4'));
    // The ones already there are untouched.
    expect(readFileSync(join(dir, 'clip.mp4'), 'utf8')).toBe('already here');
    expect(readFileSync(join(dir, 'clip (2).mp4'), 'utf8')).toBe('and this');
    expect(await claimFile(dir, 'other.pptx')).toBe(join(dir, 'other.pptx'));
  });

  it('claims a folder the same way', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'Placeholder folder'));
    expect(await claimFolder(dir, 'Placeholder folder')).toBe(join(dir, 'Placeholder folder (2)'));
    expect(readdirSync(dir).sort()).toEqual(['Placeholder folder', 'Placeholder folder (2)']);
  });
});
