import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTES_MAX, newestVersion, releaseNotes } from '../../../scripts/release-notes.mjs';
import { updateManifestSchema } from '../../shared/updates';

/*
 * A release's notes come from its section of CHANGELOG.md (scripts/release-notes.mjs): the Release
 * workflow puts them in drashti-update.json, which the Updates dialog shows, and on the release page.
 * Placeholder changelogs only.
 */

const app = join(__dirname, '..', '..', '..');
const script = join(app, 'scripts', 'release-notes.mjs');

const CHANGELOG = `# What changed

Newest first.

## 9.9.10

Placeholder notes for 9.9.10.

## 9.9.1 (1 Jan 2000)

Placeholder notes for 9.9.1, the first line.

- A first placeholder change.
- A second placeholder change.

## 9.9.0 (1 Dec 1999)

- The oldest.
`;

describe('this version’s notes from CHANGELOG.md', () => {
  it('are its section, from its heading to the next, whether or not a date follows the version', () => {
    expect(releaseNotes(CHANGELOG, '9.9.1')).toBe(
      'Placeholder notes for 9.9.1, the first line.\n\n- A first placeholder change.\n- A second placeholder change.',
    );
    expect(releaseNotes(CHANGELOG, '9.9.10')).toBe('Placeholder notes for 9.9.10.');
    expect(releaseNotes(CHANGELOG, '9.9.0')).toBe('- The oldest.');
    expect(releaseNotes(CHANGELOG.replace(/\n/gu, '\r\n'), '9.9.1')).toBe(releaseNotes(CHANGELOG, '9.9.1'));
  });

  it('know the newest version: the first numbered heading, under any "## Unreleased"', () => {
    expect(newestVersion(CHANGELOG)).toBe('9.9.10');
    expect(
      newestVersion(`## Unreleased\n\n- Not yet.\n\n${CHANGELOG.slice(CHANGELOG.indexOf('## 9.9.1 '))}`),
    ).toBe('9.9.1');
    expect(newestVersion('# What changed\n\n## Unreleased\n\n- Not yet.\n')).toBeNull();
  });

  it('fail, saying what to do, for a version with no section or an empty one', () => {
    expect(() => releaseNotes(CHANGELOG, '9.9.2')).toThrow(
      'CHANGELOG.md has no section for 9.9.2, the version in package.json. Add one headed "## 9.9.2" that says what changed, then release.',
    );
    // A version is never matched by the start of another's (9.9.1 is not 9.9.10).
    expect(() => releaseNotes('## 9.9.10\n\nNotes.\n', '9.9.1')).toThrow('no section for 9.9.1');
    expect(() => releaseNotes('## 9.9.2\n\n\n## 9.9.1\n\nNotes.\n', '9.9.2')).toThrow(
      'CHANGELOG.md’s section for 9.9.2 is empty: say what changed under "## 9.9.2".',
    );
  });

  it('fail when longer than Drashti’s update check reads, the same limit as the app’s own', () => {
    const at = `## 9.9.1\n\n${'x'.repeat(NOTES_MAX)}\n`;
    expect(releaseNotes(at, '9.9.1')).toHaveLength(NOTES_MAX);
    expect(() => releaseNotes(`## 9.9.1\n\n${'x'.repeat(NOTES_MAX + 1)}\n`, '9.9.1')).toThrow(
      `CHANGELOG.md’s section for 9.9.1 is ${String(NOTES_MAX + 1)} characters long`,
    );
    const manifest = (notes: string) => ({
      app: 'drashti',
      version: '9.9.1',
      releasedAt: '2000-01-01T00:00:00Z',
      notes,
      source: 'https://example.invalid/',
      files: [],
    });
    expect(updateManifestSchema.safeParse(manifest('x'.repeat(NOTES_MAX))).success).toBe(true);
    expect(updateManifestSchema.safeParse(manifest('x'.repeat(NOTES_MAX + 1))).success).toBe(false);
  });

  it('exist in this repository’s CHANGELOG.md for package.json’s version', () => {
    const { version } = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as { version: string };
    const changelog = readFileSync(join(app, 'CHANGELOG.md'), 'utf8');
    const notes = releaseNotes(changelog, version);
    expect(notes.length).toBeGreaterThan(0);
    // It is the newest version there: only "## Unreleased" may come before it.
    expect(newestVersion(changelog)).toBe(version);
    // The Updates dialog shows them as plain text: no Markdown beyond "- " lists.
    expect(notes).not.toMatch(/^#|\*\*|__|`|\]\(/mu);
  });

  it('as the Release workflow runs it: written to a file, or a plain message and a failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-release-notes-'));
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env } });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.9.10' }));
    writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG);
    const ok = run('--out', 'notes.md');
    expect(ok.status).toBe(0);
    expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe(`${releaseNotes(CHANGELOG, '9.9.10')}\n`);

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.9.2' }));
    const missing = run('--out', 'notes-2.md');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('CHANGELOG.md has no section for 9.9.2');
    expect(existsSync(join(dir, 'notes-2.md'))).toBe(false);
  });

  it('as the Release workflow runs it: only for the newest version, with an "## Unreleased" section allowed above it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-release-notes-'));
    const run = () =>
      spawnSync(process.execPath, [script, '--out', 'notes.md'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env },
      });
    // package.json still says 9.9.1, but 9.9.10's section is the newest: a version bump was forgotten.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.9.1' }));
    writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG);
    const older = run();
    expect(older.status).toBe(1);
    expect(older.stderr).toContain(
      'CHANGELOG.md’s newest version is 9.9.10, but package.json says 9.9.1. Release the newest: set package.json’s version to 9.9.10, or move 9.9.1’s section to the top (only "## Unreleased" may sit above it).',
    );
    expect(existsSync(join(dir, 'notes.md'))).toBe(false);

    // Changes waiting for the next version sit above, under "## Unreleased": this version is still the newest.
    const unreleased = CHANGELOG.replace(
      '## 9.9.10',
      '## Unreleased\n\n- A placeholder change, not released yet.\n\n## 9.9.10',
    );
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.9.10' }));
    writeFileSync(join(dir, 'CHANGELOG.md'), unreleased);
    const ok = run();
    expect(ok.status).toBe(0);
    expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe('Placeholder notes for 9.9.10.\n');
  });
});
