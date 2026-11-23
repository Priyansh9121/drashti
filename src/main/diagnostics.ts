import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { join } from 'node:path';
import type { AudioOutputStatus } from '../shared/audio';
import { fileStamp, formatBytes } from '../shared/format';
import type { LinkState, NodeClock, NodeMediaStatus } from '../shared/nodes';
import type { DisplayInfo, ScreensSnapshot } from '../shared/screens';
import { cutText } from '../shared/text';
import type { Db } from './db/database';
import { ImportRepo } from './db/imports';
import { type CrashFile, copyCrashFiles, crashFilesLines, KEEP_CRASH_FILES } from './crash-files';
import { type CrashEntry, JOURNAL_ENTRIES } from './crash-journal';
import { scrub } from './log';
import { type DiagnosticsWho, whoLines } from './log-who';

/*
 * Help > Save diagnostics: one plain-text file an operator can send after a
 * problem. It holds the app and system versions, the display, screen and
 * sound setup, library counts, recent imports as counts and issue codes,
 * the watchdog's history and the log. Never library content: no
 * presentation names, slide text or file paths. As a safety net, every name
 * in the library is blanked out of the whole file before it is written.
 */

export interface DiagnosticsInput {
  app: { version: string; electron: string; chrome: string; node: string; platform: string; arch: string };
  displays: readonly DisplayInfo[];
  screens: ScreensSnapshot;
  sound: AudioOutputStatus;
  db: Db;
  watchdog: readonly { at: string; window: string; kind: string; reason: string | null }[];
  /** The crash journal (Sessions 31–36, ROB-6). */
  crashJournal: readonly CrashEntry[];
  /** The crash files kept on this computer, and whether they go with the file (ticked as it was saved). */
  crashFiles: CrashFilesChoice;
  logFiles: readonly string[];
  now: Date;
  /** How Chromium draws here (Session 60, the owner's Q60-37); absent where nothing was read. */
  graphics?: GraphicsInfo;
  /** Who and what made the file (alpha.21, logs (b)): its computer, access-list entry and role, install, period. */
  who: DiagnosticsWho;
}

/**
 * The graphics, as Chromium reports them (Session 60, the owner's Q60-37: a video that played on one Mac and not on
 * another, with nothing saved to tell why): how each feature draws (app.getGPUFeatureStatus()), and its GPU details
 * (app.getGPUInfo('complete')): each GPU with its driver, and the video decoding it offers. No names or paths in it.
 */
export interface GraphicsInfo {
  featureStatus: Record<string, string>;
  /** Chromium's GPU details as it gave them (their shape differs by system), or null when they could not be read. */
  info: unknown;
  /** Why info is null, when it is. */
  problem?: string;
}

/** The crash files kept, and whether the person saving Diagnostics ticked Include crash files. */
export interface CrashFilesChoice {
  files: readonly CrashFile[];
  included: boolean;
  /** False when this run keeps no crash files (Drashti running translated): Diagnostics says why. */
  kept?: boolean;
}

/**
 * At most this much of the log (the newest part): since alpha.21 a chosen period's (logs (c)), up to 7 days; a report
 * keeps its own smaller part of it (report-files.ts, fitDiagnostics).
 */
const LOG_BYTES = 16_000_000;
const HIDDEN = '[library name]';

const count = (db: Db, sql: string) => (db.prepare(sql).get() as { n: number }).n;

/** Names the library holds, to blank out wherever they appear. */
export function libraryNames(db: Db): string[] {
  const rows = db
    .prepare(
      `SELECT name AS n FROM presentations UNION SELECT name FROM playlists UNION SELECT name FROM media
       UNION SELECT name FROM props UNION SELECT name FROM messages UNION SELECT template FROM messages
       UNION SELECT name FROM timers UNION SELECT name FROM slide_groups UNION SELECT label FROM playlist_items`,
    )
    .pluck()
    .all() as (string | null)[];
  // Short names ("A", "Hi") would blank out ordinary words; they are left.
  return [...new Set(rows.filter((n): n is string => typeof n === 'string').map((n) => n.trim()))].filter(
    (n) => n.length >= 3,
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The text with every one of these names blanked out, longest first. */
export function redactNames(text: string, names: readonly string[]): string {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  let out = text;
  for (let i = 0; i < sorted.length; i += 400) {
    const pattern = new RegExp(
      sorted
        .slice(i, i + 400)
        .map(escape)
        .join('|'),
      'giu',
    );
    out = out.replace(pattern, HIDDEN);
  }
  return out;
}

function section(title: string, lines: readonly string[]): string {
  return `== ${title} ==\n${lines.length > 0 ? lines.join('\n') : '(none)'}\n`;
}

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const hex = (v: unknown) => (typeof v === 'number' ? `0x${v.toString(16).padStart(4, '0')}` : String(v));

/** Every list under a key that names video decoding, wherever Chromium put it (a few levels down at most). */
function videoDecodeLists(v: unknown, depth = 0): unknown[] {
  const r = record(v);
  if (!r || depth > 4) return [];
  return Object.entries(r).flatMap(([key, value]) =>
    /video.?decod/iu.test(key) && Array.isArray(value)
      ? (value as unknown[])
      : videoDecodeLists(value, depth + 1),
  );
}

/** The Graphics section: how each feature draws, each GPU with its driver, the video decoding offered. */
function graphicsSection(graphics: GraphicsInfo | undefined): string {
  if (!graphics) return section('Graphics', ['Not read']);
  const lines = Object.entries(graphics.featureStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([feature, state]) => `${feature}: ${state}`);
  const info = record(graphics.info);
  if (!info) {
    lines.push(`GPU details: could not be read (${graphics.problem ?? 'nothing given'})`);
    return section('Graphics', lines);
  }
  const devices = Array.isArray(info['gpuDevice']) ? info['gpuDevice'] : [];
  devices.forEach((device, i) => {
    const d = record(device) ?? {};
    const driver = [d['driverVendor'], d['driverVersion']]
      .filter((x) => typeof x === 'string' && x !== '')
      .join(' ');
    lines.push(
      `GPU ${String(i + 1)}${d['active'] === true ? ' (in use)' : ''}: vendor ${hex(d['vendorId'])}, device ${hex(d['deviceId'])}${driver ? `, driver ${driver}` : ''}`,
    );
  });
  for (const key of ['machineModelName', 'machineModelVersion']) {
    const value = info[key];
    if (typeof value === 'string' && value !== '') lines.push(`${key}: ${value}`);
  }
  const decoding = videoDecodeLists(info);
  lines.push(decoding.length > 0 ? 'Video decoding offered:' : 'Video decoding offered: none listed');
  for (const item of decoding.slice(0, 60)) lines.push(`  ${cutText(JSON.stringify(item), 200)}`);
  return section('Graphics', lines);
}

/**
 * The first section of either file: when it was saved, the versions and the system, then who and what made it
 * (alpha.21, logs (b): its computer, its ids by their start, its install, role, where made, time zone, the log's period).
 */
function aboutSection(title: string, app: DiagnosticsInput['app'], now: Date, who: DiagnosticsWho): string {
  const cpu = cpus();
  return section(title, [
    `Saved: ${now.toISOString()}`,
    `Drashti ${app.version}; Electron ${app.electron}, Chrome ${app.chrome}, Node ${app.node}`,
    `System: ${app.platform} ${release()} ${app.arch}; ${cpu.length} × ${cpu[0]?.model ?? 'CPU'}; ${Math.round(totalmem() / 1024 ** 3)} GB memory`,
    ...whoLines(who, now),
  ]);
}

function displaysSection(displays: readonly DisplayInfo[]): string {
  return section(
    'Displays',
    displays.map(
      (d) =>
        `${d.label || `Display ${d.id}`}: ${d.pixelWidth}×${d.pixelHeight} at ${d.refreshHz} Hz, scale ${d.scaleFactor}${d.rotation ? `, rotated ${d.rotation}°` : ''}${d.primary ? ', main' : ''}${d.internal ? ', built in' : ''}`,
    ),
  );
}

function watchdogSection(watchdog: DiagnosticsInput['watchdog']): string {
  return section(
    'Watchdog (this run)',
    watchdog.map((e) => `${e.at} ${e.window} ${e.kind}${e.reason ? ` (${e.reason})` : ''}`),
  );
}

/** The crash journal and the crash files (Sessions 31–36, ROB-6): the files by name, size and time only. */
function crashSections(journal: readonly CrashEntry[], crash: CrashFilesChoice): string[] {
  return [
    section(
      `Crash journal (the last ${String(JOURNAL_ENTRIES)}, kept over restarts)`,
      journal.map((e) => `${e.at} ${e.what}`),
    ),
    section(
      `Crash files (kept on this computer, the newest ${String(KEEP_CRASH_FILES)})`,
      crashFilesLines(crash.files, crash.included, crash.kept ?? true),
    ),
  ];
}

/**
 * The file on the Desktop; with crash files ticked, a folder holding the file and the crash files.
 * Returns the file's path, or the folder's. (alpha.21: Save Diagnostics' text is made in the report worker, then
 * written here by Main.)
 */
export function writeDiagnosticsFile(dir: string, now: Date, text: string, crash: CrashFilesChoice): string {
  const name = `Drashti diagnostics ${fileStamp(now)}`;
  if (!crash.included || crash.files.length === 0) {
    const file = join(dir, `${name}.txt`);
    writeFileSync(file, text, 'utf8');
    return file;
  }
  const folder = join(dir, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${name}.txt`), text, 'utf8');
  copyCrashFiles(crash.files, folder);
  return folder;
}

/** The log, oldest file first, keeping the newest part (read newest first, so a long period reads no more than it keeps). */
function logSection(logFiles: readonly string[]): string {
  const parts: string[] = [];
  let bytes = 0;
  for (const file of [...logFiles].reverse()) {
    if (bytes > LOG_BYTES) break;
    try {
      const text = readFileSync(file, 'utf8');
      parts.unshift(text);
      bytes += text.length;
    } catch {
      // A file removed meanwhile (its day gone).
    }
  }
  let logText = parts.join('');
  if (logText.length > LOG_BYTES) logText = `…\n${logText.slice(-LOG_BYTES)}`;
  return section(
    'Log',
    logText
      .trimEnd()
      .split('\n')
      .filter((l) => l !== ''),
  );
}

/** The whole file, before names are blanked out. */
export function diagnosticsText(input: DiagnosticsInput): string {
  const { app, db } = input;
  const parts: string[] = [];
  parts.push(aboutSection('Drashti diagnostics', app, input.now, input.who));
  parts.push(displaysSection(input.displays));
  parts.push(graphicsSection(input.graphics));
  const states = new Map(input.screens.status.map((s) => [s.screenId, s.state]));
  parts.push(
    section(
      'Screens',
      input.screens.groups.flatMap((g) => [
        `Group "${g.name}" (${g.role}):`,
        ...g.screens.map(
          (s) =>
            `  "${s.name}": canvas ${s.canvasWidth}×${s.canvasHeight} ${s.scaling}, ${s.enabled ? 'on' : 'off'}, ${states.get(s.id) ?? 'unknown'}`,
        ),
      ]),
    ),
  );
  const sound = input.sound;
  parts.push(
    section('Sound', [
      `Chosen output: ${sound.chosen ? sound.chosen.label : 'the system default'} (${sound.state}${sound.checked ? '' : ', not checked yet'})`,
      `Outputs the audio player can see: ${sound.devices.length > 0 ? sound.devices.map((d) => d.label || '(unnamed)').join(', ') : 'none yet'}`,
    ]),
  );
  parts.push(
    section('Library (counts only)', [
      `Presentations: ${count(db, 'SELECT COUNT(*) AS n FROM presentations WHERE deleted_at IS NULL')}`,
      `Slides: ${count(db, 'SELECT COUNT(*) AS n FROM slides')}`,
      `Media files: ${count(db, 'SELECT COUNT(*) AS n FROM media')} (${count(db, 'SELECT COUNT(*) AS n FROM media WHERE missing = 1')} missing, ${count(db, 'SELECT COUNT(*) AS n FROM media WHERE playable = 0')} cannot play)`,
      `Playlists: ${count(db, 'SELECT COUNT(*) AS n FROM playlists WHERE deleted_at IS NULL AND is_folder = 0')}`,
      `Themes: ${count(db, 'SELECT COUNT(*) AS n FROM themes')}; props: ${count(db, 'SELECT COUNT(*) AS n FROM props')}; timers: ${count(db, 'SELECT COUNT(*) AS n FROM timers')}; messages: ${count(db, 'SELECT COUNT(*) AS n FROM messages')}`,
    ]),
  );
  const imports = new ImportRepo(db);
  parts.push(
    section(
      'Recent imports (counts and issue codes only)',
      imports.listRuns(20).map((run) => {
        const codes = new Map<string, number>();
        for (const item of imports.items(run.id))
          for (const issue of item.issues) codes.set(issue.code, (codes.get(issue.code) ?? 0) + 1);
        const issues = [...codes].map(([code, n]) => `${code} ×${n}`).join(', ');
        return `${run.startedAt} → ${run.finishedAt ?? 'not finished'}: ${run.status}; ${JSON.stringify(run.totals)}${issues ? `; issues: ${issues}` : ''}`;
      }),
    ),
  );
  parts.push(watchdogSection(input.watchdog));
  parts.push(...crashSections(input.crashJournal, input.crashFiles));
  parts.push(logSection(input.logFiles));
  return parts.join('\n');
}

/**
 * Write the file to `dir` (the Desktop), names blanked out; returns its path (a folder's, with the crash
 * files in it, when they were ticked).
 */
export function saveDiagnostics(dir: string, input: DiagnosticsInput): string {
  const text = scrub(redactNames(diagnosticsText(input), libraryNames(input.db)));
  return writeDiagnosticsFile(dir, input.now, text, input.crashFiles);
}

/** A node's screen, as Main gave it, and how it stands on the node. */
export interface NodeScreenDiagnostics {
  name: string;
  groupName: string;
  role: string;
  canvasWidth: number;
  canvasHeight: number;
  scaling: string;
  enabled: boolean;
  state: string;
  /** The display it is on (its label), or null. */
  display: string | null;
  droppedFrames: number;
  paintedRev: number;
}

/**
 * A node's diagnostics (Session 17): Main's file without the parts a node
 * has not got (no library, imports or sound), and with what a node has: the
 * Main it follows and the link, its clock against Main's, the screens Main
 * gave it, and its copies of Main's pictures and videos (counts only).
 * Never the node's token or a pairing code.
 */
export interface NodeDiagnosticsInput {
  app: DiagnosticsInput['app'];
  displays: readonly DisplayInfo[];
  screens: readonly NodeScreenDiagnostics[];
  main: { name: string; addresses: readonly string[]; port: number; pairedAt: string } | null;
  link: { state: LinkState; why: string | null; since: number };
  clock: NodeClock | null;
  /** The show's revision as the node has it, and whether it is the last one kept from before. */
  rev: number;
  fromSaved: boolean;
  media: NodeMediaStatus;
  watchdog: DiagnosticsInput['watchdog'];
  crashJournal: DiagnosticsInput['crashJournal'];
  crashFiles: CrashFilesChoice;
  logFiles: readonly string[];
  now: Date;
  /** Who and what made the file (alpha.21, logs (b)). */
  who: DiagnosticsWho;
}

/** The node's whole file. */
export function nodeDiagnosticsText(input: NodeDiagnosticsInput): string {
  const parts: string[] = [];
  parts.push(aboutSection('Drashti diagnostics (node)', input.app, input.now, input.who));
  parts.push(displaysSection(input.displays));
  const main = input.main;
  const clock = input.clock;
  parts.push(
    section('Main and the link', [
      main
        ? `Follows Main "${main.name}" at ${main.addresses.join(', ') || '(no address)'} port ${main.port}, paired ${main.pairedAt}`
        : 'Not paired with a Main',
      `Link: ${input.link.state} since ${new Date(input.link.since).toISOString()}${input.link.why ? ` (${input.link.why})` : ''}`,
      clock
        ? `Clock: Main’s is ${clock.offsetMs >= 0 ? '+' : ''}${String(Math.round(clock.offsetMs))} ms from this computer’s, from a round trip of ${String(Math.round(clock.rttMs))} ms at ${new Date(clock.at).toISOString()}`
        : 'Clock: not measured yet',
      `Show: revision ${String(input.rev)}${input.fromSaved ? ', the last picture kept (Main not reached since this node started)' : ''}`,
    ]),
  );
  const groups = [...new Set(input.screens.map((s) => s.groupName))];
  parts.push(
    section(
      'Screens (from Main)',
      groups.flatMap((g) => {
        const screens = input.screens.filter((s) => s.groupName === g);
        return [
          `Group "${g}" (${screens[0]?.role ?? '?'}):`,
          ...screens.map(
            (s) =>
              `  "${s.name}": canvas ${String(s.canvasWidth)}×${String(s.canvasHeight)} ${s.scaling}, ${s.enabled ? 'on' : 'off'}, ${s.state}${s.display ? ` on ${s.display}` : ''}; late frames ${String(s.droppedFrames)} in the last minute, painted revision ${String(s.paintedRev)}`,
          ),
        ];
      }),
    ),
  );
  const m = input.media;
  parts.push(
    section('Pictures and videos (copies of Main’s, counts only)', [
      `${String(m.ready)} of ${String(m.wanted)} files ready (${formatBytes(m.bytesReady)} of ${formatBytes(m.bytesWanted)})`,
      ...(m.copying
        ? [`Copying one: ${formatBytes(m.copying.done)} of ${formatBytes(m.copying.bytes)}`]
        : []),
      `On the screens or up next, not here yet: ${String(m.missingNow)}`,
      ...(m.problem ? [`Stopped: ${m.problem}`] : []),
    ]),
  );
  parts.push(watchdogSection(input.watchdog));
  parts.push(...crashSections(input.crashJournal, input.crashFiles));
  parts.push(logSection(input.logFiles));
  return parts.join('\n');
}

/** Write the node's file to `dir` (the Desktop); returns its path (a folder's, with crash files ticked). */
export function saveNodeDiagnostics(dir: string, input: NodeDiagnosticsInput): string {
  return writeDiagnosticsFile(dir, input.now, scrub(nodeDiagnosticsText(input)), input.crashFiles);
}
