import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_COUNTS } from '../shared/import';
import { openDatabase } from './db/database';
import { ImportRepo } from './db/imports';
import { PresentationRepo } from './db/presentations';
import type { DiagnosticsInput } from './diagnostics';
import { diagnosticsText, libraryNames, redactNames, saveDiagnostics } from './diagnostics';

/* Placeholder names and words only. */

function setup() {
  const db = openDatabase(':memory:');
  const repo = new PresentationRepo(db);
  repo.insert({
    libraryId: repo.ensureLibrary('Kirtans'),
    name: 'Placeholder Secret Kirtan',
    groups: [{ name: 'Verse', slides: [{ elements: [] }] }],
  });
  const imports = new ImportRepo(db);
  imports.startRun('run-1', ['/Users/someone/Kirtans/Placeholder Secret Kirtan.pro6'], {});
  imports.finishRun(
    'run-1',
    'done',
    {
      ...NO_COUNTS,
      presentations: 1,
      files: 1,
      imported: 1,
      replaced: 0,
      keptBoth: 0,
      skipped: 0,
      conflicts: 0,
      failed: 0,
      unsupported: 0,
      issues: 0,
    },
    'Imported Placeholder Secret Kirtan',
  );
  const dir = mkdtempSync(join(tmpdir(), 'drashti-diag-'));
  const logFile = join(dir, 'drashti.log');
  writeFileSync(logFile, '2026-09-29T10:00:00.000Z [info] Opened Placeholder Secret Kirtan by mistake\n');
  const input: DiagnosticsInput = {
    app: { version: '1.0.0', electron: '44', chrome: '152', node: '24', platform: 'darwin', arch: 'arm64' },
    displays: [],
    screens: { displays: [], groups: [], status: [] },
    sound: { chosen: null, devices: [], state: 'default', checked: true },
    db,
    watchdog: [
      { at: '2026-09-29T10:00:01.000Z', window: 'output "Main Hall"', kind: 'crashed', reason: 'oom' },
    ],
    logFiles: [logFile],
    now: new Date(2026, 8, 29, 10, 5),
  };
  return { db, dir, input };
}

describe('diagnostics', () => {
  it('holds versions, counts, imports as counts and codes, and the watchdog history', () => {
    const { input } = setup();
    const text = diagnosticsText(input);
    expect(text).toContain('Drashti 1.0.0; Electron 44, Chrome 152, Node 24');
    expect(text).toContain('Presentations: 1');
    expect(text).toContain('"presentations":1');
    expect(text).toContain('output "Main Hall" crashed (oom)');
    // An import's paths and message are not in it.
    expect(text).not.toContain('/Users/someone');
    expect(text).not.toContain('Imported Placeholder');
  });

  it('blanks out every library name, wherever it is', () => {
    const { db, input, dir } = setup();
    expect(libraryNames(db)).toContain('Placeholder Secret Kirtan');
    expect(redactNames('Log: placeholder secret kirtan opened', ['Placeholder Secret Kirtan'])).toBe(
      'Log: [library name] opened',
    );
    const file = saveDiagnostics(dir, input);
    // Named in local time (the date was made from local parts), like the backup folders.
    expect(file).toBe(join(dir, 'Drashti diagnostics 2026-09-29 10-05.txt'));
    const saved = readFileSync(file, 'utf8');
    expect(saved).not.toContain('Secret Kirtan');
    expect(saved).toContain('Opened [library name] by mistake');
  });
});
