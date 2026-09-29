import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { join } from 'node:path';
import type { AudioOutputStatus } from '../shared/audio';
import type { DisplayInfo, ScreensSnapshot } from '../shared/screens';
import type { Db } from './db/database';
import { ImportRepo } from './db/imports';
import { scrub } from './log';

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
  logFiles: readonly string[];
  now: Date;
}

/** At most this much of the log (the newest part). */
const LOG_BYTES = 1_500_000;
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

/** The whole file, before names are blanked out. */
export function diagnosticsText(input: DiagnosticsInput): string {
  const { app, db } = input;
  const cpu = cpus();
  const parts: string[] = [];
  parts.push(
    section('Drashti diagnostics', [
      `Saved: ${input.now.toISOString()}`,
      `Drashti ${app.version}; Electron ${app.electron}, Chrome ${app.chrome}, Node ${app.node}`,
      `System: ${app.platform} ${release()} ${app.arch}; ${cpu.length} × ${cpu[0]?.model ?? 'CPU'}; ${Math.round(totalmem() / 1024 ** 3)} GB memory`,
    ]),
  );
  parts.push(
    section(
      'Displays',
      input.displays.map(
        (d) =>
          `${d.label || `Display ${d.id}`}: ${d.pixelWidth}×${d.pixelHeight} at ${d.refreshHz} Hz, scale ${d.scaleFactor}${d.rotation ? `, rotated ${d.rotation}°` : ''}${d.primary ? ', main' : ''}${d.internal ? ', built in' : ''}`,
      ),
    ),
  );
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
  parts.push(
    section(
      'Watchdog (this run)',
      input.watchdog.map((e) => `${e.at} ${e.window} ${e.kind}${e.reason ? ` (${e.reason})` : ''}`),
    ),
  );
  // The log, oldest file first, keeping the newest part.
  let logText = '';
  for (const file of [...input.logFiles].reverse()) {
    try {
      logText += readFileSync(file, 'utf8');
    } catch {
      // A file rotated away meanwhile.
    }
  }
  if (logText.length > LOG_BYTES) logText = `…\n${logText.slice(-LOG_BYTES)}`;
  parts.push(
    section(
      'Log',
      logText
        .trimEnd()
        .split('\n')
        .filter((l) => l !== ''),
    ),
  );
  return parts.join('\n');
}

/** Write the file to `dir` (the Desktop), names blanked out; returns its path. */
export function saveDiagnostics(dir: string, input: DiagnosticsInput): string {
  const stamp = input.now.toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
  const file = join(dir, `Drashti diagnostics ${stamp}.txt`);
  const text = scrub(redactNames(diagnosticsText(input), libraryNames(input.db)));
  writeFileSync(file, text, 'utf8');
  return file;
}
