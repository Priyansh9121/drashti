import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_COUNTS } from '../shared/import';
import { openDatabase } from './db/database';
import { ImportRepo } from './db/imports';
import { PresentationRepo } from './db/presentations';
import type { CrashFile } from './crash-files';
import type { DiagnosticsWho } from './log-who';
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

/** Who made Main's file (alpha.21, logs (b)): made-up ids. */
const MAIN_WHO: DiagnosticsWho = {
  computer: 'Placeholder Hall Mac',
  computerId: 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
  installId: '7K3P-Q2XM-4H9A',
  grantId: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
  role: { mode: 'pro', owner: false },
  made: 'pro',
  period: 'Today, 2026-09-29',
};

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
    screens: { displays: [], groups: [], status: [], nodes: [], uses: [] },
    sound: { chosen: null, devices: [], state: 'default', checked: true },
    db,
    watchdog: [
      { at: '2026-09-29T10:00:01.000Z', window: 'output "Main Hall"', kind: 'crashed', reason: 'oom' },
    ],
    crashJournal: [
      {
        n: 1,
        at: '2026-09-29T09:58:00.000Z',
        what: 'an error in the main process that nothing caught: Error: Placeholder Secret Kirtan',
      },
      { n: 2, at: '2026-09-29T09:59:00.000Z', what: 'the GPU process crashed (code 11)' },
    ],
    crashFiles: { files: [], included: false },
    logFiles: [logFile],
    now: new Date(2026, 8, 29, 10, 5),
    who: MAIN_WHO,
  };
  return { db, dir, input };
}

/** A pretend crash file (a dump): placeholder bytes. */
function pretendDump(dir: string): CrashFile {
  const path = join(dir, 'placeholder-dump.dmp');
  writeFileSync(path, Buffer.alloc(2048));
  return { path, name: 'placeholder-dump.dmp', bytes: 2048, at: new Date(Date.UTC(2026, 8, 29, 9, 59)) };
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
    // The crash journal too (Sessions 31–36, ROB-6).
    expect(saved).toContain('nothing caught: Error: [library name]');
  });

  it('blanks a library name only where it is the name, never inside other words (QA24-DIAG-1)', () => {
    const { db, input, dir } = setup();
    const repo = new PresentationRepo(db);
    repo.insert({
      libraryId: repo.ensureLibrary('Kirtans'),
      name: 'New',
      groups: [{ name: 'Verse', slides: [{ elements: [] }] }],
    });
    const logFile = join(dir, 'drashti-quit.log');
    writeFileSync(
      logFile,
      '2026-09-29T10:01:00.000Z [info] Quit: placeholder windows renewed, the newest kept; New closed\n',
    );
    const saved = readFileSync(
      saveDiagnostics(dir, {
        ...input,
        logFiles: [logFile],
        crashJournal: [
          {
            n: 1,
            at: '2026-09-29T09:58:00.000Z',
            what: 'a promise in the main process failed and nothing caught it: Error: newest New',
          },
        ],
      }),
      'utf8',
    );
    // The crash files' heading, a Quit line and a crash note keep their own words; the name alone is blanked.
    expect(saved).toContain('== Crash files (kept on this computer, the newest 5) ==');
    expect(saved).toContain('Quit: placeholder windows renewed, the newest kept; [library name] closed');
    expect(saved).toContain('nothing caught it: Error: newest [library name]');
    expect(saved).not.toMatch(/\[library name\]\p{L}|\p{L}\[library name\]/u);
  });

  it('holds the crash journal, and lists crash files by name and size, the files only when ticked (ROB-6)', () => {
    const { input, dir } = setup();
    const dump = pretendDump(mkdtempSync(join(tmpdir(), 'drashti-crashpad-')));
    const text = diagnosticsText({ ...input, crashFiles: { files: [dump], included: false } });
    expect(text).toContain('== Crash journal (the last 20, kept over restarts) ==');
    expect(text).toContain('2026-09-29T09:59:00.000Z the GPU process crashed (code 11)');
    expect(text).toContain('== Crash files (kept on this computer, the newest 5) ==');
    expect(text).toContain('placeholder-dump.dmp: 2.0 KB, written 2026-09-29T09:59:00.000Z');
    expect(text).toContain('Not included: they can hold words from slides.');
    // Left out: the file alone, as before.
    const unticked = saveDiagnostics(dir, { ...input, crashFiles: { files: [dump], included: false } });
    expect(unticked).toBe(join(dir, 'Drashti diagnostics 2026-09-29 10-05.txt'));
    expect(readdirSync(dir).filter((f) => f.endsWith('.dmp'))).toEqual([]);
    // Ticked: a folder with the file and the crash file.
    const into = mkdtempSync(join(tmpdir(), 'drashti-desktop-'));
    const ticked = saveDiagnostics(into, { ...input, crashFiles: { files: [dump], included: true } });
    expect(ticked).toBe(join(into, 'Drashti diagnostics 2026-09-29 10-05'));
    expect(readdirSync(ticked).sort()).toEqual([
      'Drashti diagnostics 2026-09-29 10-05.txt',
      'placeholder-dump.dmp',
    ]);
    expect(readFileSync(join(ticked, 'Drashti diagnostics 2026-09-29 10-05.txt'), 'utf8')).toContain(
      'Included: in the folder with this file.',
    );
  });
});

describe('who and what (alpha.21, logs for 100+ installs (b))', () => {
  /** The file's first section. */
  const about = (text: string) => text.slice(0, text.indexOf('\n== ', 1));

  it('Main’s file names its computer, its access-list entry and role, the install id, the version, the system and the log’s period', () => {
    const { input } = setup();
    const head = about(diagnosticsText(input));
    expect(head).toContain('== Drashti diagnostics ==');
    expect(head).toContain('Drashti 1.0.0; Electron 44, Chrome 152, Node 24');
    expect(head).toMatch(/^System: darwin \S+ arm64; /mu);
    expect(head).toContain('Computer: Placeholder Hall Mac');
    expect(head).toContain('Computer id: c0ffee00c0ff…');
    expect(head).toContain('Install id: 7K3P-Q2XM-4H9A');
    expect(head).toContain('Access-list entry: grant 0a1b2c3d…');
    expect(head).toContain('Role: Pro');
    expect(head).toContain('Made in: Pro Mode');
    expect(head).toMatch(/^Time zone: /mu);
    expect(head).toContain('Log: Today, 2026-09-29');
  });

  it('so does a node’s, with the Main it follows', () => {
    const head = about(nodeDiagnosticsText(nodeInputForWho()));
    expect(head).toContain('== Drashti diagnostics (node) ==');
    expect(head).toContain('Computer: Placeholder Lobby PC');
    expect(head).toContain('Install id: Q2XM-4H9A-7K3P');
    expect(head).toContain('Access-list entry: none: a node, following Main “Placeholder Main”');
    expect(head).toContain('Made in: the node');
    expect(head).toContain('Log: Yesterday, 2026-10-07');
  });

  it('never holds a Gmail address or a private value, wherever one was written (the scrubber)', () => {
    const { input, dir } = setup();
    writeFileSync(
      input.logFiles[0] ?? '',
      '2026-09-29T10:00:00.000Z [warn] placeholder.person@gmail.com could not be let in\n',
    );
    const saved = readFileSync(saveDiagnostics(dir, input), 'utf8');
    expect(saved).not.toMatch(/@gmail\.com/u);
    expect(saved).toContain('[email] could not be let in');
    expect(saved).not.toContain(MAIN_WHO.grantId ?? '');
    expect(saved).not.toContain(MAIN_WHO.computerId ?? '');
  });
});

describe('the graphics in diagnostics (Session 60, the owner\u2019s Q60-37)', () => {
  it('holds how each feature draws, each GPU with its driver, and the video decoding Chromium offers', () => {
    const { input } = setup();
    const text = diagnosticsText({
      ...input,
      graphics: {
        featureStatus: { gpu_compositing: 'enabled', video_decode: 'enabled', rasterization: 'enabled' },
        info: {
          gpuDevice: [
            {
              active: true,
              vendorId: 0x8086,
              deviceId: 0x9a49,
              driverVendor: 'Placeholder Vendor',
              driverVersion: '31.0.101',
            },
            { active: false, vendorId: 0x10de, deviceId: 0x1f95 },
          ],
          auxAttributes: {
            videoDecodeAcceleratorSupportedProfile: [
              { profile: 'h264 main', maxResolutionWidth: 4096, maxResolutionHeight: 2304 },
            ],
          },
        },
      },
    });
    expect(text).toContain('== Graphics ==');
    expect(text).toContain('gpu_compositing: enabled');
    expect(text).toContain('video_decode: enabled');
    expect(text).toContain(
      'GPU 1 (in use): vendor 0x8086, device 0x9a49, driver Placeholder Vendor 31.0.101',
    );
    expect(text).toContain('GPU 2: vendor 0x10de, device 0x1f95');
    expect(text).toContain('h264 main');
  });

  it('says plainly when the GPU details could not be read, and keeps the rest', () => {
    const { input } = setup();
    const text = diagnosticsText({
      ...input,
      graphics: {
        featureStatus: { gpu_compositing: 'disabled_software' },
        info: null,
        problem: 'not answered within 3 s',
      },
    });
    expect(text).toContain('gpu_compositing: disabled_software');
    expect(text).toContain('GPU details: could not be read (not answered within 3 s)');
    expect(text).toContain('Drashti 1.0.0; Electron 44, Chrome 152, Node 24');
  });
});

/** A node's input, for the who-and-what tests. */
function nodeInputForWho(): NodeDiagnosticsInput {
  return nodeInput().input;
}

/** A node's diagnostics input: placeholder names. */
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
      crashJournal: [{ n: 1, at: '2026-10-08T10:01:00.000Z', what: 'the GPU process crashed (code 11)' }],
      crashFiles: { files: [], included: false },
      logFiles: [logFile],
      now: new Date(2026, 9, 8, 10, 5),
      who: {
        computer: 'Placeholder Lobby PC',
        computerId: null,
        installId: 'Q2XM-4H9A-7K3P',
        grantId: null,
        role: null,
        made: 'node',
        main: 'Placeholder Main',
        period: 'Yesterday, 2026-10-07',
      },
    },
  };
}

describe("a node's diagnostics (Session 17)", () => {
  it('holds the link, the clock, the screens, the copies, the watchdog and the log, and no library part', () => {
    const { input } = nodeInput();
    const text = nodeDiagnosticsText(input);
    expect(text).toContain('== Drashti diagnostics (node) ==');
    expect(text).toContain('Drashti 1.0.0; Electron 44');
    expect(text).toContain('Follows Main "Placeholder Main" at 192.0.2.10 port 8741');
    expect(text).toContain('Link: online since 2026-10-08T09:01:00.000Z');
    expect(text).toContain('Clock: Main’s is -4 ms from this computer’s, from a round trip of 1 ms');
    expect(text).toContain('Show: revision 41');
    expect(text).toContain('Group "Lobby" (audience):');
    expect(text).toContain('"Placeholder lobby screen": canvas 1920×1080 fit, on, showing on Display 2');
    expect(text).toContain('late frames 3 in the last minute, painted revision 41');
    expect(text).toContain('13 of 14 files ready');
    expect(text).toContain('On the screens or up next, not here yet: 1');
    expect(text).toContain('node window reloaded');
    expect(text).toContain('2026-10-08T10:01:00.000Z the GPU process crashed (code 11)');
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
