import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGING_SECRETS, failureReport } from '../../../scripts/packaging-failure.mjs';

/*
 * The third signed dry run (45907567743, attempt 3) failed packaging, then lost its job log when the run was
 * cancelled. A failed packaging now also leaves electron-builder's last lines on the run's page (an error
 * annotation and the step summary). Placeholder output only; a sentinel stands for a secret.
 */
const SENTINEL = 'SENTINEL-certificate-password-never-shown';
const OUTPUT = [
  '\u001b[34m  •\u001b[0m electron-builder  version=26.15.3 os=25.7.0',
  '  • packaging       platform=darwin arch=arm64 electron=44.0.0 appOutDir=release/mac-arm64',
  `  • signing         file=release/mac-arm64/Drashti.app identityName=Drashti Code Signing keychain=${SENTINEL}`,
  '  ⨯ Command failed: codesign --sign 0000000000000000000000000000000000000000 --force --timestamp release/mac-arm64/Drashti.app/Contents/Frameworks/x.dylib',
  'release/mac-arm64/Drashti.app/Contents/Frameworks/x.dylib: placeholder codesign error 100% done',
  '',
].join('\n');

describe('a failed packaging’s report on the run page', () => {
  it('keeps the last lines, without colours, in the step summary', () => {
    const { summary } = failureReport(OUTPUT, { status: 1, secrets: [SENTINEL] });
    expect(summary).toContain('### Packaging failed (exit 1)');
    expect(summary).toContain('  • packaging       platform=darwin arch=arm64');
    expect(summary).toContain('placeholder codesign error 100% done');
    expect(summary).not.toContain('\u001b[');
    expect(summary).toMatch(/^````text$/mu);
  });

  it('names the failure in one error annotation, escaped as a workflow command must be', () => {
    const { annotation } = failureReport(OUTPUT, { status: 2, secrets: [SENTINEL] });
    expect(annotation.startsWith('::error title=Packaging failed (exit 2)::')).toBe(true);
    // The last line that says what failed (electron-builder marks errors with ⨯), on one line.
    expect(annotation).toContain('⨯ Command failed: codesign --sign');
    expect(annotation).not.toContain('\n');
    expect(failureReport('50% of it\nError: a\nb', { status: 1 }).annotation).toBe(
      '::error title=Packaging failed (exit 1)::Error: a',
    );
    expect(failureReport('a\r\nwhat 100% failed', { status: 1 }).annotation).toBe(
      '::error title=Packaging failed (exit 1)::what 100%25 failed',
    );
    expect(failureReport('', { status: 1 }).annotation).toBe(
      '::error title=Packaging failed (exit 1)::no output',
    );
  });

  it('never shows a secret’s value, and holds at most `keep` lines', () => {
    const report = failureReport(OUTPUT, { status: 1, secrets: [SENTINEL, undefined, '', 'ab'] });
    expect(`${report.annotation}\n${report.summary}`).not.toContain(SENTINEL);
    expect(report.summary).toContain('keychain=***');
    // Values too short to be secrets are left alone (they would hide ordinary words).
    expect(report.summary).toContain('arch=arm64');
    const many = Array.from({ length: 100 }, (_, i) => `line ${String(i)}`).join('\n');
    const kept = failureReport(many, { status: 1, keep: 5 }).summary;
    expect(kept).toContain('line 95');
    expect(kept).toContain('line 99');
    expect(kept).not.toContain('line 94');
  });

  it('hides each line of a secret with line breaks (a key’s text, base64 in lines), 8 characters or more', () => {
    const lines = ['SENTINEL-KEY-LINE-ONE-abcdefgh', 'SENTINEL-KEY-LINE-TWO-ijklmnop', 'short'];
    const output = [
      `  • first ${lines[0] ?? ''}`,
      `  ⨯ second ${lines[1] ?? ''} and a short word`,
      '  • done',
    ].join('\n');
    for (const secret of [lines.join('\n'), `${lines.join('\r\n')}\r\n`]) {
      const report = failureReport(output, { status: 1, secrets: [secret] });
      const shown = `${report.annotation}\n${report.summary}`;
      expect(shown).not.toContain('SENTINEL');
      expect(report.summary).toContain('  • first ***');
      expect(report.annotation).toContain('⨯ second *** and a short word');
    }
  });

  it('hides every signing secret packaging is given', () => {
    for (const name of [
      'MAC_CERT_PASSWORD',
      'CSC_KEY_PASSWORD',
      'WIN_CERT_PASSWORD',
      'WIN_CSC_KEY_PASSWORD',
      'AZURE_CLIENT_SECRET',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
      'MAC_SIGN_P12_PASSWORD',
    ])
      expect(PACKAGING_SECRETS, name).toContain(name);
  });

  it('is what package-release.mjs gives the run page when electron-builder fails', () => {
    const script = readFileSync(join(__dirname, '../../../scripts/package-release.mjs'), 'utf8');
    expect(script).toContain("from './packaging-failure.mjs'");
    expect(script).toContain('failureReport(');
    expect(script).toContain('GITHUB_STEP_SUMMARY');
    // electron-builder's output still reaches the log as it comes (piped and passed on, never only kept).
    expect(script).toMatch(/process\.stdout\.write\(/u);
    expect(script).toMatch(/process\.stderr\.write\(/u);
  });
});
