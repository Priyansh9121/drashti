import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accessCheck,
  APP_JOBS,
  ciCheck,
  filesCheck,
  mainCheck,
  tagCheck,
} from '../../../scripts/release-gate.mjs';
import { accessConfigReal } from '../../shared/access-config';

/*
 * The release gate (Session 30 step 5), on canned answers from git and GitHub: the tag new, the commit
 * main, a push CI run of that commit green on every app job (the Mac's, Windows', and since Session 41 Windows' in
 * Black), every file as its checksums say.
 */

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const green = APP_JOBS.map((name) => ({ name, conclusion: 'success' }));

describe('the release gate', () => {
  it('the tag must be new', () => {
    expect(tagCheck('', '1.0.0-alpha.5')).toEqual({ ok: true, line: 'The tag v1.0.0-alpha.5 is new.' });
    expect(tagCheck(`${OTHER}\trefs/tags/v1.0.0-alpha.4\n`, '1.0.0-alpha.4')).toEqual({
      ok: false,
      line: 'The tag v1.0.0-alpha.4 exists already: bump the version before releasing.',
    });
  });

  it('the commit must be main', () => {
    expect(mainCheck(`${SHA}\trefs/heads/main\n`, SHA)).toEqual({ ok: true, line: 'aaaaaaa is main.' });
    expect(mainCheck(`${OTHER}\trefs/heads/main\n`, SHA)).toEqual({
      ok: false,
      line: 'aaaaaaa is not main (main is bbbbbbb): a release is made from main only.',
    });
  });

  it('a push CI run of this very commit must have passed every app job; a run by hand never counts', () => {
    const push = { id: 7, event: 'push', head_sha: SHA, run_attempt: 1 };
    expect(ciCheck([push], { 7: green }, SHA)).toMatchObject({ ok: true });
    expect(ciCheck([], {}, SHA)).toMatchObject({
      ok: false,
      line: 'No CI run from a push of aaaaaaa: push it and wait for CI (a run started by hand never counts).',
    });
    const byHand = { ...push, event: 'workflow_dispatch' };
    expect(ciCheck([byHand], { 7: green }, SHA)).toMatchObject({ ok: false });
    const red = [
      { name: APP_JOBS[0] ?? '', conclusion: 'success' },
      { name: APP_JOBS[1] ?? '', conclusion: 'failure' },
      { name: APP_JOBS[2] ?? '', conclusion: 'success' },
    ];
    expect(ciCheck([push], { 7: red }, SHA)).toEqual({
      ok: false,
      line: 'No CI run from a push of aaaaaaa passed every app job (run 7: macOS success, Windows failure, Windows in Black success).',
    });
    // The Black job counts too (Session 41): the two in White green is not enough, nor a run from before it.
    expect(APP_JOBS).toEqual([
      'End-to-end and installers (macos-latest)',
      'End-to-end and installers (windows-latest)',
      'End-to-end in Black (windows-latest)',
    ]);
    const white = green.filter((j) => j.name !== 'End-to-end in Black (windows-latest)');
    expect(ciCheck([push], { 7: white }, SHA)).toEqual({
      ok: false,
      line: 'No CI run from a push of aaaaaaa passed every app job (run 7: macOS success, Windows success, Windows in Black missing).',
    });
    // Passed on a re-run: it counts, and says so.
    expect(ciCheck([{ ...push, run_attempt: 2 }], { 7: green }, SHA)).toEqual({
      ok: true,
      line: 'CI run 7, from a push of aaaaaaa, passed every app job (on attempt 2: a re-run counts).',
    });
  });

  it('every file must match SHA256SUMS.txt and the update manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-gate-'));
    const installer = Buffer.from('a placeholder installer, not a real one');
    writeFileSync(join(dir, 'Drashti-windows-setup.exe'), installer);
    const manifest = {
      files: [
        {
          name: 'Drashti-windows-setup.exe',
          size: installer.length,
          sha512: createHash('sha512').update(installer).digest('base64'),
        },
      ],
    };
    writeFileSync(join(dir, 'drashti-update.json'), JSON.stringify(manifest));
    const sum = (name: string, bytes: Buffer | string) =>
      `${createHash('sha256').update(bytes).digest('hex')}  ${name}`;
    writeFileSync(
      join(dir, 'SHA256SUMS.txt'),
      `${sum('Drashti-windows-setup.exe', installer)}\n${sum('drashti-update.json', JSON.stringify(manifest))}\n`,
    );
    expect(await filesCheck(dir)).toEqual([
      { ok: true, line: 'Every file (2) matches SHA256SUMS.txt and the update manifest.' },
    ]);
    // A changed file.
    appendFileSync(join(dir, 'Drashti-windows-setup.exe'), 'x');
    expect(await filesCheck(dir)).toEqual([
      { ok: false, line: 'Drashti-windows-setup.exe does not match its SHA-256 in SHA256SUMS.txt.' },
      { ok: false, line: "Drashti-windows-setup.exe does not match the update manifest's size and SHA-512." },
    ]);
    // A file the sums leave out.
    writeFileSync(join(dir, 'extra.txt'), 'not listed');
    expect((await filesCheck(dir)).map((r) => r.line)).toContain('extra.txt is not in SHA256SUMS.txt.');
    // A manifest changed into something that is not JSON: said, never thrown (a dry run carries on).
    appendFileSync(join(dir, 'drashti-update.json'), 'x');
    const lines = (await filesCheck(dir)).map((r) => r.line);
    expect(lines).toContain('drashti-update.json does not match its SHA-256 in SHA256SUMS.txt.');
    expect(lines).toContain('drashti-update.json cannot be read (not JSON).');
  });
});

describe('the release gate and the access list (Session 54)', () => {
  // Shaped as Set up… makes them, never a real list's: a made-up address and a key of one letter.
  const url = 'https://script.google.com/macros/s/PretendWebAppAddress_0123456789/exec';
  const key = `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA${'A'.repeat(342)}IDAQAB`;
  const config = (u: string, k: string) =>
    `export const ACCESS_LIST_URL = '${u}';\nexport const ACCESS_LIST_PUBLIC_KEY = '${k}';\n`;

  it('refuses the placeholders the repository holds until the owner sends the line', () => {
    const today = readFileSync(join(__dirname, '../../shared/access-config.ts'), 'utf8');
    expect(accessCheck(today)).toMatchObject({ ok: accessConfigReal() });
    expect(
      accessCheck(config('https://script.google.com/macros/s/PLACEHOLDER-WEB-APP-ADDRESS/exec', 'x')),
    ).toEqual({
      ok: false,
      line: 'The access list’s address and public key are not built in (src/shared/access-config.ts): put in the line the owner’s Set up… shows.',
    });
  });

  it('passes a real-shaped address and key, and names the one that is missing', () => {
    expect(accessCheck(config(url, key))).toEqual({
      ok: true,
      line: 'The access list’s address and public key are built in.',
    });
    expect(accessCheck(config(url, 'PLACEHOLDER-PUBLIC-KEY')).line).toContain('public key is not built in');
    expect(accessCheck(config('https://example.com/exec', key)).line).toContain('address is not built in');
  });

  it('agrees with accessConfigReal, which Drashti itself asks', () => {
    const urls = [
      url,
      'https://script.google.com/a/macros/example.org/s/PretendWebAppAddress_0123456789/exec',
      'http://script.google.com/macros/s/PretendWebAppAddress_0123456789/exec',
      'https://script.google.com/macros/s/short/exec',
      'https://script.google.com/macros/s/PLACEHOLDER-WEB-APP-ADDRESS/exec',
    ];
    const keys = [key, key.slice(1), `${key.slice(0, -6)}IDAQAC`, 'PLACEHOLDER-PUBLIC-KEY'];
    for (const u of urls)
      for (const k of keys) expect(accessCheck(config(u, k)).ok).toBe(accessConfigReal(u, k));
  });
});
