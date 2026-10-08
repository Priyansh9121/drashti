import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_COUNTS } from '../shared/import';
import { openDatabase } from './db/database';
import { ImportRepo } from './db/imports';
import { PresentationRepo } from './db/presentations';
import type { DiagnosticsInput, NodeDiagnosticsInput } from './diagnostics';
import {
  diagnosticsText,
  libraryNames,
  nodeDiagnosticsText,
  redactNames,
  saveDiagnostics,
  saveNodeDiagnostics,
} from './diagnostics';

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
    screens: { displays: [], groups: [], status: [], nodes: [] },
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

describe("a node's diagnostics (Session 17)", () => {
  function nodeInput(): { dir: string; input: NodeDiagnosticsInput } {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-node-diag-'));
    const logFile = join(dir, 'drashti.log');
    writeFileSync(logFile, '2026-10-08T10:00:00.000Z [info] Node: link online\n');
    return {
      dir,
      input: {
        app: { version: '1.0.0', electron: '44', chrome: '152', node: '24', platform: 'win32', arch: 'x64' },
        displays: [],
        screens: [
          {
            name: 'Placeholder lobby screen',
            groupName: 'Lobby',
            role: 'audience',
            canvasWidth: 1920,
            canvasHeight: 1080,
            scaling: 'fit',
            enabled: true,
            state: 'showing',
            display: 'Display 2',
            droppedFrames: 3,
            paintedRev: 41,
          },
        ],
        main: {
          name: 'Placeholder Main',
          addresses: ['192.0.2.10'],
          port: 8741,
          pairedAt: '2026-10-08T09:00:00.000Z',
        },
        link: { state: 'online', why: null, since: Date.UTC(2026, 9, 8, 9, 1) },
        clock: { offsetMs: -3.6, rttMs: 1.2, at: Date.UTC(2026, 9, 8, 10, 4) },
        rev: 41,
        fromSaved: false,
        media: {
          wanted: 14,
          ready: 13,
          bytesWanted: 30 * 1024 ** 2,
          bytesReady: 28 * 1024 ** 2,
          copying: null,
          missingNow: 1,
          problem: null,
        },
        watchdog: [{ at: '2026-10-08T10:02:00.000Z', window: 'node window', kind: 'reloaded', reason: null }],
        logFiles: [logFile],
        now: new Date(2026, 9, 8, 10, 5),
      },
    };
  }

  it('holds the link, the clock, the screens, the copies, the watchdog and the log, and no library part', () => {
    const { input } = nodeInput();
    const text = nodeDiagnosticsText(input);
    expect(text).toContain('== Drashti diagnostics (node) ==');
    expect(text).toContain('Drashti 1.0.0; Electron 44');
    expect(text).toContain('Follows Main "Placeholder Main" at 192.0.2.10 port 8741');
    expect(text).toContain('Link: online since 2026-10-08T09:01:00.000Z');
    expect(text).toContain("Clock: Main's is -4 ms from this computer's, from a round trip of 1 ms");
    expect(text).toContain('Show: revision 41');
    expect(text).toContain('Group "Lobby" (audience):');
    expect(text).toContain('"Placeholder lobby screen": canvas 1920×1080 fit, on, showing on Display 2');
    expect(text).toContain('late frames 3 in the last minute, painted revision 41');
    expect(text).toContain('13 of 14 files ready');
    expect(text).toContain('On the screens or up next, not here yet: 1');
    expect(text).toContain('node window reloaded');
    expect(text).toContain('Node: link online');
    // A node has no library, imports or sound.
    expect(text).not.toContain('== Library');
    expect(text).not.toContain('== Recent imports');
    expect(text).not.toContain('== Sound ==');
  });

  it('says so when the node is not paired, or shows the last picture kept', () => {
    const { input } = nodeInput();
    const text = nodeDiagnosticsText({ ...input, main: null, clock: null, fromSaved: true, screens: [] });
    expect(text).toContain('Not paired with a Main');
    expect(text).toContain('Clock: not measured yet');
    expect(text).toContain('the last picture kept (Main not reached since this node started)');
    expect(text).toContain('== Screens (from Main) ==\n(none)');
  });

  it('writes one file to the folder given, named as Main names its own', () => {
    const { dir, input } = nodeInput();
    const file = saveNodeDiagnostics(dir, input);
    expect(file).toBe(join(dir, 'Drashti diagnostics 2026-10-08 10-05.txt'));
    expect(readFileSync(file, 'utf8')).toContain('== Main and the link ==');
  });
});
