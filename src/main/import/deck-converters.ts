import { spawn } from 'node:child_process';
import { constants as fsConstants, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import type { PictureSource } from '../../shared/pictures';
import { tidyNotes } from '../../shared/pictures';
import { type PptxDeck, type PptxSlide, readPptx, readPptxDeck } from './pictures';
import { readZipEntries } from './zip';
import { cutText } from '../../shared/text';
import { realPlaceAsync } from '../media/contained';

/*
 * Saving a PowerPoint or Keynote file as PDF with the app installed on this
 * computer (Session 15; made safe in Session 16, after it was first tried on
 * the dev Mac with Keynote 14.4 and PowerPoint 16.97). What that showed:
 *
 * - Both apps answer `open` before the document exists, so the document is
 *   found by the name of a copy made for the purpose (never the operator's
 *   own file, which may be open in the app with unsaved changes).
 * - Shown a damaged file, or on a first start after an update, both apps ask
 *   a question in a window behind Drashti that nobody sees, and from then on
 *   answer nothing. So every step has a time limit, and an app that Drashti
 *   started is quit (or stopped) afterwards; one the operator had open is
 *   left as it was.
 * - Started by Drashti, the app starts hidden, without reopening the
 *   operator's last documents, and quits when it is done.
 *
 * PowerPoint on Windows goes through its automation (COM) with its questions
 * turned off; that cannot be tried on the dev Mac (see docs/setup-day.md).
 */

export type Converter = 'keynote' | 'powerpoint';

/** What can save a PowerPoint or Keynote file as PDF on this computer. */
export interface Converters {
  keynote: boolean;
  powerpoint: boolean;
}

/**
 * The apps to try, in turn. PowerPoint first for its own files (it draws them
 * exactly as the operator made them), then Keynote on a Mac; a Keynote file
 * needs Keynote.
 */
export function convertersFor(
  source: PictureSource,
  platform: NodeJS.Platform,
  has: Converters,
): Converter[] {
  if (source === 'pdf') return [];
  const out: Converter[] = [];
  if (source !== 'key' && (platform === 'darwin' || platform === 'win32') && has.powerpoint)
    out.push('powerpoint');
  if (platform === 'darwin' && has.keynote) out.push('keynote');
  return out;
}

/** What to do when nothing here can save the file as PDF, said plainly. */
export function noConverterMessage(source: PictureSource): string {
  return source === 'key'
    ? 'This computer has no Keynote to turn this Keynote file into pictures. On a Mac, open it in Keynote and choose File > Export To > PDF…, then import the PDF.'
    : 'This computer has no Keynote or PowerPoint to turn this file into pictures. Open it in PowerPoint (File > Save As, PDF) or Keynote (File > Export To > PDF…), then import the PDF.';
}

export const exists = (path: string) => {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
};

/** Whether Windows knows PowerPoint (its automation is registered). */
function windowsHasPowerPoint(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('reg', ['query', 'HKCR\\PowerPoint.Application\\CurVer'], { stdio: 'ignore' });
    child.on('error', () => {
      resolve(false);
    });
    child.on('exit', (code) => {
      resolve(code === 0);
    });
  });
}

/** Keynote and PowerPoint where they are usually installed. */
export async function findConverters(platform: NodeJS.Platform = process.platform): Promise<Converters> {
  if (platform === 'darwin')
    return {
      keynote: exists('/Applications/Keynote.app') || exists(join(homedir(), 'Applications', 'Keynote.app')),
      powerpoint:
        exists('/Applications/Microsoft PowerPoint.app') ||
        exists(join(homedir(), 'Applications', 'Microsoft PowerPoint.app')),
    };
  if (platform === 'win32') return { keynote: false, powerpoint: await windowsHasPowerPoint() };
  return { keynote: false, powerpoint: false };
}

// ---- checking the file first -------------------------------------------------------------------

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Why the file cannot be what its name says, or null when it looks right.
 * An app shown a damaged file asks about it in a window nobody may see, so a
 * file that is plainly damaged never reaches the app. `slides` is a .pptx's
 * own slides when it could be read.
 */
export async function checkDeck(
  source: PictureSource,
  path: string,
): Promise<{ ok: true; slides: PptxSlide[] | null; deck: PptxDeck | null } | { ok: false; message: string }> {
  const damaged = (detail: string) => ({
    ok: false as const,
    message: `This file looks damaged (${detail}). If it opens in ${source === 'key' ? 'Keynote' : 'PowerPoint'}, save it again there (or save it as PDF) and import that.`,
  });
  if (source === 'pptx') {
    try {
      // What each slide does is read too (Session 54, C2), for the deck shown as it was.
      const deck = await readPptxDeck(path);
      return { ok: true, slides: deck.slides, deck };
    } catch (error) {
      return damaged(error instanceof Error ? error.message.replace(/\.$/u, '') : String(error));
    }
  }
  if (source === 'ppt') {
    const head = Buffer.alloc(8);
    try {
      const handle = await open(path, 'r');
      try {
        await handle.read(head, 0, 8, 0);
      } finally {
        await handle.close();
      }
    } catch (error) {
      return damaged(error instanceof Error ? error.message : String(error));
    }
    return head.equals(OLE_SIGNATURE)
      ? { ok: true, slides: null, deck: null }
      : damaged('it is not a PowerPoint 97–2003 file');
  }
  if (source === 'key') {
    try {
      const parts = await readZipEntries(
        path,
        (name) => name === 'Index/Document.iwa' || name === 'index.apxl' || name === 'index.apxl.gz',
      );
      return parts.size > 0
        ? { ok: true, slides: null, deck: null }
        : damaged('it has no Keynote document inside');
    } catch (error) {
      return damaged(error instanceof Error ? error.message.replace(/\.$/u, '') : String(error));
    }
  }
  return { ok: true, slides: null, deck: null };
}

// ---- running things ----------------------------------------------------------------------------

export interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Stopped by its time limit. */
  timedOut: boolean;
  /** Stopped because the import was cancelled. */
  aborted: boolean;
}

/** Run a program, giving up after `timeoutMs` or when `signal` says to stop. */
export function run(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Ran> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: true });
      return;
    }
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const stop = () => {
      aborted = true;
      child.kill();
    };
    signal?.addEventListener('abort', stop);
    const done = (code: number | null, error?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolve({ code, stdout, stderr: stderr || (error?.message ?? ''), timedOut, aborted });
    };
    child.on('error', (error) => {
      done(null, error);
    });
    child.on('exit', (code) => {
      done(code);
    });
  });
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });

export const firstLine = (text: string) =>
  cutText(
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '') ?? '',
    300,
  );

/** Time limits; the tests make them short. */
export interface ConvertLimits {
  /** For the app to start and answer: a first start after an update is slow. */
  startMs: number;
  /**
   * For the document to open while the app answers: this, and `openPerMbMs`
   * for each MB of the file, up to `openMaxMs`. An app that answers but never
   * opens it is showing a question nobody sees (a damaged file).
   */
  openMs: number;
  openPerMbMs: number;
  openMaxMs: number;
  /** An app that has not answered for this long is asking a question nobody sees (or is stuck). */
  silentMs: number;
  /** For saving as PDF: this, and `perSlideMs` for each slide. */
  saveMs: number;
  perSlideMs: number;
  /**
   * For a deck's movie (Session 54, C2): this, and `perMovieSecondMs` for each second of movie planned. PowerPoint
   * for Mac took 16 s for 88 s of movie on a quiet Mac, and 25 times as long with every core busy.
   */
  movieMs: number;
  perMovieSecondMs: number;
}

export const CONVERT_LIMITS: ConvertLimits = {
  startMs: 120_000,
  openMs: 20_000,
  openPerMbMs: 1_000,
  openMaxMs: 180_000,
  silentMs: 45_000,
  saveMs: 60_000,
  perSlideMs: 3_000,
  movieMs: 120_000,
  perMovieSecondMs: 6_000,
};

/** A Keynote file is also saved as PowerPoint to count its builds, unless it is bigger than this. */
const BUILDS_MAX_BYTES = 100 * 1024 * 1024;

export type Converted =
  | {
      ok: true;
      pdf: string;
      /** Each slide, as the app told it (null: the file itself is read for them, or none). */
      slides: PptxSlide[] | null;
      /** The notes are for shown slides only, already in the PDF's order. */
      shownOnly: boolean;
    }
  | {
      ok: false;
      /** What to tell the operator, with what to do. */
      message: string;
      /** In a few words, for a report that goes on to try another app. */
      reason: string;
      /** The operator cancelled the import. */
      cancelled?: boolean;
      /** macOS was told not to let Drashti control the app. */
      notAllowed?: boolean;
    };

export interface ConvertOptions {
  signal?: AbortSignal;
  platform?: NodeJS.Platform;
  limits?: ConvertLimits;
  /** The file's slides, when it is a .pptx that could be read (for the time limit). */
  slideCount?: number;
  /** Each step, for the log. */
  log?: (line: string) => void;
  /**
   * The app put a message in front of the operator while Drashti was in front:
   * Drashti's own window should have the keys back (Session 16).
   */
  refocus?: () => void;
  /**
   * Drashti started the app itself (Session 31, ROB-3): its process, written down until the deck is saved
   * (`ended`), so one left running by a crash is stopped at the next start. Never an app the operator had open.
   */
  started?: (pid: number) => void;
  ended?: (pid: number) => void;
  /** Windows: runs PowerShell (tests give a stand-in: CI has no Office). */
  runPowerShell?: PowerShellRunner;
}

export const appName = (converter: Converter) => (converter === 'keynote' ? 'Keynote' : 'PowerPoint');

/** How to do it by hand, after anything goes wrong. */
const byHand = (converter: Converter) =>
  converter === 'keynote'
    ? 'Open it in Keynote and choose File > Export To > PDF…, then import the PDF.'
    : 'Open it in PowerPoint and choose File > Save As, PDF, then import the PDF.';

const cancelled = (): ConvertFailed => ({
  ok: false,
  message: 'Cancelled.',
  reason: 'cancelled',
  cancelled: true,
});

/** Save a PowerPoint or Keynote file as PDF in `work` (a folder of its own) with the app given. */
export async function convertToPdf(
  converter: Converter,
  input: string,
  work: string,
  options: ConvertOptions = {},
): Promise<Converted> {
  const platform = options.platform ?? process.platform;
  const limits = options.limits ?? CONVERT_LIMITS;
  if (platform === 'darwin') return convertOnMac(converter, input, work, limits, options);
  if (platform === 'win32' && converter === 'powerpoint')
    return convertOnWindows(input, work, limits, options);
  return { ok: false, message: byHand(converter), reason: `no ${appName(converter)} here` };
}

// ---- on a Mac ----------------------------------------------------------------------------------

interface MacApp {
  converter: Converter;
  /** Its bundle id. */
  id: string;
  /** Its process name. */
  process: string;
}

const MAC_APPS: Record<Converter, MacApp> = {
  keynote: { converter: 'keynote', id: 'com.apple.iWork.Keynote', process: 'Keynote' },
  powerpoint: { converter: 'powerpoint', id: 'com.microsoft.Powerpoint', process: 'Microsoft PowerPoint' },
};

/** This user's processes of the app. */
async function pidsOf(app: MacApp): Promise<number[]> {
  const r = await run('pgrep', ['-x', '-U', String(userInfo().uid), app.process], 5000);
  return r.stdout
    .split('\n')
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** The app in front: its bundle id and process id (none when it cannot be told). */
async function frontApp(): Promise<{ id: string; pid: number } | null> {
  const asn = (await run('lsappinfo', ['front'], 5000)).stdout.trim();
  if (asn === '') return null;
  const info = (await run('lsappinfo', ['info', '-only', 'bundleid', '-only', 'pid', asn], 5000)).stdout;
  const id = /"CFBundleIdentifier"="([^"]*)"/u.exec(info)?.[1] ?? '';
  const pid = Number(/"pid"=(\d+)/u.exec(info)?.[1] ?? 0);
  return { id, pid };
}

/** An AppleScript error's number, from what osascript printed ("... (-1712)"). */
function errorNumber(stderr: string): number | null {
  const m = /\((-?\d+)\)\s*$/u.exec(stderr.trim());
  return m ? Number(m[1]) : null;
}

/** macOS was told not to let Drashti control the app. */
const NOT_ALLOWED = -1743;
/** The app did not answer in time. */
const TIMED_OUT = -1712;
/** The app is not running, or quit while asked. */
const GONE = new Set([-600, -609]);

/** Run an AppleScript, its lines given, with `args` as its argv. */
function appleScript(lines: string[], args: string[], timeoutMs: number, signal?: AbortSignal): Promise<Ran> {
  return run('osascript', [...lines.flatMap((l) => ['-e', l]), ...args], timeoutMs, signal);
}

/** A few lines to the app, in `with timeout of`, with `argv`. */
function tellApp(app: MacApp, body: string[], args: string[], seconds: number, signal?: AbortSignal) {
  return appleScript(
    [
      'on run argv',
      `with timeout of ${String(seconds)} seconds`,
      `tell application id "${app.id}"`,
      ...body,
      'end tell',
      'end timeout',
      'end run',
    ],
    args,
    (seconds + 10) * 1000,
    signal,
  );
}

function notAllowedMessage(converter: Converter): string {
  const name = converter === 'keynote' ? 'Keynote' : 'Microsoft PowerPoint';
  return `Drashti is not allowed to use ${appName(converter)}. In System Settings, Privacy & Security, Automation, allow Drashti to control ${name}, then import the file again.`;
}

/** A document Drashti opened in the app (a copy made for the purpose): as the app knows it, and its copy. */
export interface MacDocument {
  /** Keynote's document id, or PowerPoint's presentation name. */
  doc: string;
  /** Its slides, as the app counted them. */
  slides: number;
  /** The copy the app opened. */
  copy: string;
}

/** A conversion that failed, with what to tell the operator. */
export type ConvertFailed = Extract<Converted, { ok: false }>;

/**
 * Keynote or PowerPoint on a Mac, started (or found running) and answering, for one file's work (Session 54, C2:
 * the PDF, and a deck's movie): documents opened and closed in it, and at the end the app left as the operator
 * had it.
 */
export interface MacSession {
  converter: Converter;
  name: string;
  /** Where the app may read and write (PowerPoint for Mac only in its own folders). */
  folder: string;
  log(line: string): void;
  /** Open a copy of `file` in the app, made for the purpose, and wait for it while the app answers. */
  open(file: string): Promise<{ ok: true; document: MacDocument } | { ok: false; failed: ConvertFailed }>;
  /** A few lines to the app, in `with timeout of`, with `argv`; `signal` stops it too (the import's always does). */
  tell(body: string[], args: string[], seconds: number, signal?: AbortSignal): Promise<Ran>;
  /** The app's processes now. */
  pids(): Promise<number[]>;
  /** What to tell the operator when the app stopped answering, or making progress, while `when`. */
  stuck(when: string): ConvertFailed;
  /** What to tell the operator when asking the app failed while `when`, trying to `what` ("save it as PDF"). */
  fromError(r: Ran, when: string, what: string): ConvertFailed;
  /** Close a document Drashti opened, never saving it. */
  close(document: MacDocument): Promise<void>;
  /**
   * A document Drashti saved as `file` (Session 54, C review): PowerPoint calls it by its new name from then on,
   * so it is closed by that name. Keynote's are known by their id.
   */
  savedAs(document: MacDocument, file: string): Promise<void>;
  /**
   * Hide the app (it shows itself when it opens a document), as NSRunningApplication does: no permission is asked
   * for. A Keynote or PowerPoint the operator had open is never hidden.
   */
  hide(): Promise<void>;
  signal: AbortSignal | undefined;
}

/** Hide another app by its bundle id (JavaScript for Automation's bridge to AppKit; no Apple event, no question). */
function hideApp(id: string): Promise<Ran> {
  return run(
    'osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      `ObjC.import('AppKit'); var a = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(${JSON.stringify(id)}); var hidden = a.count > 0 ? a.objectAtIndex(0).hide : false; String(hidden)`,
    ],
    10_000,
  );
}

/** The copy's extension: the file's own kind. */
const copyExt = (file: string) =>
  file.toLowerCase().endsWith('.ppt') ? '.ppt' : file.toLowerCase().endsWith('.key') ? '.key' : '.pptx';

/**
 * Start Keynote or PowerPoint as it should be (hidden, without reopening the operator's last documents) or find it
 * running, give it to `use`, and afterwards close what Drashti opened in it and quit it when Drashti started it
 * and nothing of the operator's is open in it. `label` names the copies (the operator's file's name).
 */
export async function withMacSession<T>(
  converter: Converter,
  label: string,
  work: string,
  limits: ConvertLimits,
  options: ConvertOptions,
  use: (session: MacSession) => Promise<T | ConvertFailed>,
): Promise<T | ConvertFailed> {
  const app = MAC_APPS[converter];
  const { signal } = options;
  const name = appName(converter);
  const started = Date.now();
  const log = (line: string) => options.log?.(`${name} +${String(Date.now() - started)} ms: ${line}`);
  /** The app's processes before: none means Drashti starts it, and quits it afterwards. */
  const before = await pidsOf(app);
  /** The app in front before: an app that comes to the front meanwhile is showing the operator something. */
  const frontBefore = await frontApp();
  /**
   * `answering` is false once the app has stopped answering (it is asking a question nobody sees). `othersSeen`:
   * something not Drashti's copy was seen open in it (Session 54, C review), so it is never quit or stopped.
   */
  const state = { answering: true, tookFront: false, othersSeen: false };
  /**
   * Whether the app has the front, taken from whatever had it (Drashti, as a rule). For Keynote
   * that is a question about the file in front of the operator: given a file as a double-click
   * gives it, it stays behind unless it has something to ask. PowerPoint comes to the front for a
   * moment as it opens a good file too, so for it this only means Drashti takes the front back
   * afterwards.
   */
  const tookFront = async () => {
    if (frontBefore?.id === app.id) return false;
    const now = (await frontApp())?.id === app.id;
    if (now) state.tookFront = true;
    return now;
  };
  /** The documents Drashti opened, still open. */
  const opened: MacDocument[] = [];
  /** The app's processes, when Drashti started it. */
  let ours: number[] = [];
  // PowerPoint for Mac may only read and write in its own folders: work there.
  const folder =
    app.converter === 'powerpoint'
      ? join(homedir(), 'Library', 'Group Containers', 'UBF8T346G9.Office', 'Drashti')
      : work;
  const insides: string[] = [];
  /**
   * The name the copies are opened under: the file's own (the app may show it in a
   * question), and a number no document of the operator's has.
   */
  const stem = `${cutText(basename(label, extname(label)), 60)} (Drashti copy ${String(1000 + Math.floor(Math.random() * 9000))})`;
  let copies = 0;

  const fail = (reason: string, message: string, extra: { notAllowed?: boolean } = {}): ConvertFailed => {
    log(`failed: ${reason}`);
    return { ok: false, reason, message, ...extra };
  };
  /** What becomes of the app afterwards, as the operator is told it. */
  const leftAs = () =>
    before.length > 0
      ? `${name} was already open, so Drashti left it as it is: look at ${name} and answer it.`
      : state.othersSeen
        ? `Something else was opened in ${name} meanwhile, so Drashti left it open: look at ${name} and answer it.`
        : `Drashti closed ${name}, which it had started.`;
  /** Why the app stopped answering, and what became of it. */
  const silentFail = (when: string): ConvertFailed => {
    state.answering = false;
    return fail(
      `${name} stopped answering`,
      `${name} stopped answering while ${when}: it may be asking a question about this file in a window behind Drashti. ${leftAs()} ${byHand(app.converter)}`,
    );
  };
  const fromError = (r: Ran, when: string, what: string): ConvertFailed => {
    if (r.aborted) return cancelled();
    const n = errorNumber(r.stderr);
    if (n === NOT_ALLOWED)
      return fail(`not allowed to use ${name}`, notAllowedMessage(app.converter), { notAllowed: true });
    if (r.timedOut || n === TIMED_OUT) return silentFail(when);
    const detail = firstLine(r.stderr);
    return fail(
      `${name} could not ${what}`,
      `${name} could not ${what}${detail ? ` (${detail})` : ''}. ${byHand(app.converter)}`,
    );
  };
  const tell = (body: string[], args: string[], seconds: number, own?: AbortSignal) =>
    tellApp(app, body, args, seconds, own && signal ? AbortSignal.any([signal, own]) : (own ?? signal));

  const open = async (
    file: string,
  ): Promise<{ ok: true; document: MacDocument } | { ok: false; failed: ConvertFailed }> => {
    // ---- open a copy of the file, made for the purpose -----------------------------------
    await mkdir(folder, { recursive: true });
    const inside = await mkdtemp(join(folder, 'convert-'));
    insides.push(inside);
    const copyName = copies === 0 ? stem : `${stem} ${String(copies + 1)}`;
    copies++;
    const copy = join(inside, `${copyName}${copyExt(file)}`);
    // A clone where the disk can (no copying on APFS), a copy otherwise.
    await copyFile(file, copy, fsConstants.COPYFILE_FICLONE);
    // Keynote is given the copy the way a double-click gives it (through LaunchServices): asked by
    // AppleScript instead, its sandbox often could not read a .pptx ("not found"), and it said so
    // in a window nobody saw. PowerPoint reads its own folder either way.
    const asked =
      app.converter === 'keynote'
        ? await run(
            'open',
            ['-g', '-j', '-b', app.id, copy, '--args', '-ApplePersistenceIgnoreState', 'YES'],
            30_000,
            signal,
          )
        : await appleScript(
            [
              'on run argv',
              `tell application id "${app.id}"`,
              'ignoring application responses',
              'open (POSIX file (item 1 of argv))',
              'end ignoring',
              'end tell',
              'end run',
            ],
            [copy],
            20_000,
            signal,
          );
    if (asked.code !== 0) return { ok: false, failed: fromError(asked, 'opening the file', 'open it') };
    log('asked to open the copy');

    // ---- wait for it to be open, while the app answers ------------------------------------
    const find =
      app.converter === 'keynote'
        ? [
            'repeat with d in documents',
            'if (name of d) starts with (item 1 of argv) then return (id of d) & linefeed & ((count of slides of d) as text)',
            'end repeat',
            'return ""',
          ]
        : [
            'repeat with i from 1 to (count of presentations)',
            'if (full name of presentation i) is (item 2 of argv) then return (name of presentation i) & linefeed & ((count of slides of presentation i) as text)',
            'end repeat',
            'return ""',
          ];
    const mb = (await stat(file)).size / (1024 * 1024);
    const openLimit = Math.min(limits.openMaxMs, limits.openMs + limits.openPerMbMs * mb);
    // Only time while the app answers counts against the limit: one that is busy or slow to start
    // is waited for (up to `silentMs` without an answer).
    let answeringFor = 0;
    let lastAnswer = Date.now();
    let answeredLast = true;
    let slides = options.slideCount ?? 0;
    for (;;) {
      const r = await tellApp(app, find, [copyName, copy], 5, signal);
      if (r.aborted) return { ok: false, failed: cancelled() };
      if (r.code === 0) {
        if (answeredLast) answeringFor += Date.now() - lastAnswer;
        answeredLast = true;
        lastAnswer = Date.now();
        const [found, count] = r.stdout.trim().split('\n');
        if (found) {
          slides = Number(count) || slides;
          log(`open, ${String(slides)} slides`);
          const document = { doc: found, slides, copy };
          opened.push(document);
          return { ok: true, document };
        }
      } else {
        answeredLast = false;
        const n = errorNumber(r.stderr);
        if (n === NOT_ALLOWED || (n !== null && GONE.has(n)) || !(r.timedOut || n === TIMED_OUT))
          return { ok: false, failed: fromError(r, 'opening the file', 'open it') };
      }
      if (Date.now() - lastAnswer > limits.silentMs)
        return { ok: false, failed: silentFail('opening the file') };
      if ((await tookFront()) && app.converter === 'keynote') {
        log('came to the front instead of opening it');
        return {
          ok: false,
          failed: fail(
            `${name} could not open it`,
            `${name} could not open the file and showed a message about it: it may be damaged. ${leftAs()} ${byHand(app.converter)}`,
          ),
        };
      }
      if (answeringFor > openLimit)
        return {
          ok: false,
          failed: fail(
            `${name} did not open it`,
            `${name} did not open the file: it may be damaged, or ${name} may be asking about it in a window behind Drashti. ${byHand(app.converter)}`,
          ),
        };
      await sleep(500, signal);
    }
  };

  const close = async (document: MacDocument) => {
    const at = opened.indexOf(document);
    if (at < 0) return;
    opened.splice(at, 1);
    if (!state.answering) return;
    // Keynote's copy, once changed, may have been saved by macOS itself into the operator's Keynote documents
    // (iCloud Drive's): where it is, asked first, so that it goes too (Session 54, C review).
    let keptOutside: string | null = null;
    if (app.converter === 'keynote') {
      const kept = await tellApp(
        app,
        [
          'set f to file of document id (item 1 of argv)',
          'if f is missing value then return ""',
          'return POSIX path of f',
        ],
        [document.doc],
        10,
      );
      const path = kept.code === 0 ? kept.stdout.trim() : '';
      const place = path === '' ? null : await realPlaceAsync(folder, path);
      if (place && !place.inside && basename(place.path).startsWith(stem)) keptOutside = place.path;
    }
    const command =
      app.converter === 'keynote'
        ? 'close (document id (item 1 of argv)) saving no'
        : 'close presentation (item 1 of argv) saving no';
    const closed = await tellApp(app, [command], [document.doc], 10);
    log(closed.code === 0 ? 'closed the copy' : `could not close the copy: ${firstLine(closed.stderr)}`);
    if (keptOutside) {
      await rm(keptOutside, { recursive: true, force: true }).catch(() => undefined);
      log('removed the copy macOS had kept of it in Keynote’s documents');
    }
  };

  const savedAs = async (document: MacDocument, file: string) => {
    if (app.converter !== 'powerpoint') return;
    const r = await tellApp(
      app,
      [
        'repeat with i from 1 to (count of presentations)',
        'if (full name of presentation i) is (item 1 of argv) then return name of presentation i',
        'end repeat',
        'return ""',
      ],
      [file],
      10,
    );
    const now = r.code === 0 ? r.stdout.trim() : '';
    if (now !== '') document.doc = now;
  };

  const hide = async () => {
    // One the operator had open is theirs: as they left it.
    if (before.length > 0) return;
    const r = await hideApp(app.id);
    log(r.code === 0 ? 'hidden' : `could not hide it: ${firstLine(r.stderr)}`);
  };

  /**
   * Whether something not Drashti's copy is open in the app Drashti started (Session 54, C review): the operator
   * opened the app from the Dock, or a file of theirs, which macOS gives the app already running. Looked for every
   * few seconds while it answers, so that one which then stops answering is never stopped with their work in it.
   */
  let looking = false;
  const lookForOthers = async () => {
    if (looking || !state.answering || state.othersSeen) return;
    looking = true;
    try {
      const r = await tellApp(app, [...othersIn(app), 'return others as text'], [stem], 3);
      if (r.code === 0 && Number(r.stdout.trim()) > 0) {
        state.othersSeen = true;
        log('something else is open in it: it is the operator’s now, never quit or stopped by Drashti');
      }
    } finally {
      looking = false;
    }
  };
  let watching: ReturnType<typeof setInterval> | undefined;

  try {
    // ---- start the app, hidden, without reopening anything --------------------------------
    const deadline = Date.now() + limits.startMs;
    let launches = 0;
    for (;;) {
      if (signal?.aborted) return cancelled();
      if ((await pidsOf(app)).length === 0) {
        if (launches === 2)
          return fail(`${name} did not start`, `${name} did not start. ${byHand(app.converter)}`);
        launches++;
        log(launches === 1 ? 'starting it' : 'starting it again (it quit while starting)');
        await run(
          'open',
          ['-g', '-j', '-b', app.id, '--args', '-ApplePersistenceIgnoreState', 'YES'],
          30_000,
          signal,
        );
      }
      // The first question to the app is when macOS asks whether Drashti may control it.
      const r = await appleScript(
        [
          'on run argv',
          `if not (application id "${app.id}" is running) then return "gone"`,
          'with timeout of 10 seconds',
          `tell application id "${app.id}" to return version`,
          'end timeout',
          'end run',
        ],
        [],
        20_000,
        signal,
      );
      if (r.aborted) return cancelled();
      if (r.code === 0 && r.stdout.trim() !== 'gone') {
        log(`answering (${before.length > 0 ? 'it was already open' : 'Drashti started it'})`);
        if (before.length === 0) {
          ours = await pidsOf(app);
          for (const pid of ours) options.started?.(pid);
          watching = setInterval(() => void lookForOthers(), OTHERS_EVERY_MS);
        }
        break;
      }
      const n = errorNumber(r.stderr);
      if (n === NOT_ALLOWED) return fromError(r, 'starting', 'start');
      if (Date.now() > deadline)
        return fail(
          `${name} did not answer`,
          `${name} did not start or answer within ${String(Math.round(limits.startMs / 1000))} seconds. If macOS asked whether Drashti may control ${name}, choose Allow, then import the file again. ${byHand(app.converter)}`,
        );
      // Not answering yet, or gone (it quit while starting, as a first start after an update can).
      await sleep(500, signal);
    }
    return await use({
      converter,
      name,
      folder,
      log,
      open,
      tell,
      pids: () => pidsOf(app),
      stuck: silentFail,
      fromError,
      close,
      savedAs,
      hide,
      signal,
    });
  } finally {
    // ---- leave the app as the operator had it ----------------------------------------------
    clearInterval(watching);
    for (const document of [...opened]) await close(document);
    if (before.length > 0) log('left open, as the operator had it');
    else if (state.othersSeen) log('left open: something else was opened in it meanwhile');
    else await quitIfIdle(app, before, stem, state.answering, log);
    // Quit, stopped, or left open for something the operator opened in it: no longer Drashti's own.
    for (const pid of ours) options.ended?.(pid);
    // The app took the front from Drashti: give the operator's window the keys back.
    if (!state.tookFront && frontBefore?.pid === process.ppid) await tookFront();
    if (state.tookFront && frontBefore?.pid === process.ppid) {
      log('Drashti back in front');
      options.refocus?.();
    }
    for (const inside of insides) await rm(inside, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function convertOnMac(
  converter: Converter,
  input: string,
  work: string,
  limits: ConvertLimits,
  options: ConvertOptions,
): Promise<Converted> {
  return withMacSession(converter, input, work, limits, options, async (session): Promise<Converted> => {
    const opened = await session.open(input);
    if (!opened.ok) return opened.failed;
    const { doc, slides, copy } = opened.document;
    const inside = dirname(copy);
    const ext = copyExt(input);
    const name = session.name;

    // ---- save it as PDF (and a Keynote file as PowerPoint too, for its builds) -------------
    const pdf = join(work, 'pictures.pdf');
    const inApp = join(inside, 'pictures.pdf');
    const pptx = join(inside, 'builds.pptx');
    const wantBuilds =
      converter === 'keynote' && ext === '.key' && (await stat(input)).size <= BUILDS_MAX_BYTES;
    const seconds = Math.ceil((limits.saveMs + limits.perSlideMs * Math.max(slides, 1)) / 1000);
    const saved =
      converter === 'keynote'
        ? await session.tell(
            [
              'set d to document id (item 1 of argv)',
              'export d to (POSIX file (item 2 of argv)) as PDF with properties {PDF image quality:Best, skipped slides:false}',
              'set noteList to {}',
              'repeat with s in (slides of d)',
              'if skipped of s is false then set end of noteList to (presenter notes of s)',
              'end repeat',
              'if (item 3 of argv) is not "" then',
              'try',
              'export d to (POSIX file (item 3 of argv)) as Microsoft PowerPoint',
              'end try',
              'end if',
              "set AppleScript's text item delimiters to (ASCII character 30)",
              'return noteList as text',
            ],
            [doc, inApp, wantBuilds ? pptx : ''],
            seconds,
          )
        : await session.tell(
            [
              'save presentation (item 1 of argv) in (POSIX file (item 2 of argv)) as save as PDF',
              'return ""',
            ],
            [doc, inApp],
            seconds,
          );
    if (saved.code !== 0) return session.fromError(saved, 'saving it as PDF', 'save it as PDF');
    // PowerPoint can say it saved and write nothing (a file it could not draw): give it a moment.
    for (let i = 0; i < 20 && !exists(inApp); i++) await sleep(250, session.signal);
    if (session.signal?.aborted) return cancelled();
    if (!exists(inApp))
      return {
        ok: false,
        reason: `${name} could not save it as PDF: save it as PDF by hand and import that`,
        message: `${name} could not save it as PDF. ${byHand(converter)}`,
      };
    await copyFile(inApp, pdf);
    session.log('saved as PDF');

    let fileSlides: PptxSlide[] | null = null;
    let shownOnly = false;
    if (converter === 'keynote') {
      if (wantBuilds && exists(pptx)) {
        try {
          fileSlides = await readPptx(pptx);
        } catch {
          // Its builds cannot be counted: the notes come from Keynote itself.
        }
      }
      if (!fileSlides) {
        shownOnly = true;
        fileSlides = saved.stdout
          .replace(/\n$/u, '')
          .split('\u001e')
          .map((n) => ({ hidden: false, notes: tidyNotes(n), animated: false }));
      }
    }
    return { ok: true, pdf, slides: fileSlides, shownOnly };
  });
}

/** How often an app Drashti started is asked whether something else is open in it (Session 54, C review). */
const OTHERS_EVERY_MS = 5000;

/**
 * AppleScript that counts, as `others`, the documents open in the app that are not Drashti's copies (whose names
 * start with argv's first item). By number: PowerPoint cannot say the name of `d` in `repeat with d in
 * presentations` (-2763), so the old way of asking failed whenever something else was open, and Drashti then
 * stopped it (C review: found by the real-app test).
 */
function othersIn(app: MacApp): string[] {
  const [docs, one] =
    app.converter === 'keynote' ? ['documents', 'document'] : ['presentations', 'presentation'];
  return [
    'set others to 0',
    `repeat with i from 1 to (count of ${docs})`,
    `if not ((name of ${one} i) starts with (item 1 of argv)) then set others to others + 1`,
    'end repeat',
  ];
}

/**
 * Quit an app Drashti started (it was not running before), unless something
 * besides Drashti's copy is open in it; stop it if it does not answer, or
 * does not quit (a question nobody sees can hold it up). One something else
 * was seen open in meanwhile never comes here (Session 54, C review).
 */
async function quitIfIdle(
  app: MacApp,
  before: number[],
  stem: string,
  answering: boolean,
  log: (line: string) => void,
): Promise<void> {
  const running = await pidsOf(app);
  if (running.length === 0) return;
  if (answering) {
    const r = await tellApp(
      app,
      [...othersIn(app), 'if others is 0 then quit saving no', 'return others as text'],
      [stem],
      10,
    );
    // Someone opened a document of their own in it meanwhile: it stays open.
    if (r.code === 0 && r.stdout.trim() !== '0') {
      log('left open: the operator opened something in it meanwhile');
      return;
    }
    if (r.code === 0) {
      for (let i = 0; i < 40 && (await pidsOf(app)).length > 0; i++) await sleep(250);
      if ((await pidsOf(app)).length === 0) {
        log('quit');
        return;
      }
      log('did not quit when asked');
    } else {
      const n = errorNumber(r.stderr);
      // It answered, but what is open in it could not be told (Session 54, C review): never stopped then.
      if (!(r.timedOut || n === TIMED_OUT || (n !== null && GONE.has(n)))) {
        log(`left open: what is open in it could not be told (${firstLine(r.stderr)})`);
        return;
      }
      log(`did not answer when asked to quit: ${firstLine(r.stderr)}`);
    }
  }
  // It does not answer (a question nobody sees): stop the copy Drashti started.
  const ours = running.filter((p) => !before.includes(p));
  log(`stopping it (${ours.map(String).join(', ')})`);
  for (const pid of ours) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  for (let i = 0; i < 20 && (await pidsOf(app)).some((p) => ours.includes(p)); i++) await sleep(250);
  for (const pid of (await pidsOf(app)).filter((p) => ours.includes(p))) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

// ---- on Windows --------------------------------------------------------------------------------

/**
 * PowerPoint on Windows, through its automation: note whether PowerPoint was
 * running, open the copy read-only without a window, with its questions off
 * and its macros forced off (AutomationSecurity 3, put back as it was after;
 * Sessions 31–36, SEC-13: if that cannot be set, the deck is not opened),
 * save as PDF (32 is ppSaveAsPDF), note every slide's notes and whether
 * it is hidden, close, and quit PowerPoint only if Drashti started it and
 * nothing else is open or shows (Session 54, C review: a window, which the copy
 * opened without one never has, is the operator's). A PowerPoint Drashti
 * started runs below normal priority, and its process id is written down so
 * Drashti can stop it if it stops answering, while it shows no window.
 */
export const POWERPOINT_WINDOWS_SCRIPT = `param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$Notes, [Parameter(Mandatory)][string]$Started, [string]$Settings = '')
$ErrorActionPreference = 'Stop'
$before = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$app = New-Object -ComObject PowerPoint.Application
$ours = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
Set-Content -LiteralPath $Started -Value ($ours -join ',') -Encoding ASCII
foreach ($id in $ours) { try { (Get-Process -Id $id).PriorityClass = 'BelowNormal' } catch {} }
$alerts = $app.DisplayAlerts
$security = $app.AutomationSecurity
if ($Settings -ne '') { Set-Content -LiteralPath $Settings -Value "$([int]$alerts),$([int]$security)" -Encoding ASCII }
try { $app.DisplayAlerts = 1 } catch {}
$pres = $null
try {
  $app.AutomationSecurity = 3
  $pres = $app.Presentations.Open($In, -1, 0, 0)
  $pres.SaveAs($Out, 32)
  $slides = @()
  foreach ($s in $pres.Slides) {
    $text = ''
    try { $text = [string]$s.NotesPage.Shapes.Placeholders(2).TextFrame.TextRange.Text } catch {}
    $slides += [pscustomobject]@{ hidden = ($s.SlideShowTransition.Hidden -ne 0); notes = $text; animated = $false }
  }
  ConvertTo-Json -InputObject @($slides) -Compress | Set-Content -LiteralPath $Notes -Encoding UTF8
} finally {
  if ($pres) { try { $pres.Close() } catch {} }
  try { $app.DisplayAlerts = $alerts } catch {}
  try { $app.AutomationSecurity = $security } catch {}
  $shown = @($ours | Where-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; $p -and $p.MainWindowHandle -ne [IntPtr]::Zero })
  if ($ours.Count -gt 0 -and $app.Presentations.Count -eq 0 -and $shown.Count -eq 0) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
`;

/** The process ids PowerPoint's script wrote down ("1234,5678"). */
const idsIn = (text: string) =>
  text
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

/**
 * PowerPoint on Windows, with the PowerPoint Drashti started told as the script writes it down, and
 * forgotten once the deck is done (Session 31, ROB-3).
 */
async function convertOnWindows(
  input: string,
  work: string,
  limits: ConvertLimits,
  options: ConvertOptions,
): Promise<Converted> {
  const startedFile = join(work, 'started.txt');
  const ours = new Set<number>();
  const look = () =>
    readFile(startedFile, 'ascii').then(
      (text) => {
        for (const id of idsIn(text))
          if (!ours.has(id)) {
            ours.add(id);
            options.started?.(id);
          }
      },
      () => undefined,
    );
  const poll = setInterval(() => void look(), 500);
  try {
    return await powerPointOnWindows(input, work, limits, options);
  } finally {
    clearInterval(poll);
    for (const id of ours) options.ended?.(id);
  }
}

async function powerPointOnWindows(
  input: string,
  work: string,
  limits: ConvertLimits,
  options: ConvertOptions,
): Promise<Converted> {
  const { signal } = options;
  const pdf = join(work, 'pictures.pdf');
  const script = join(work, 'powerpoint.ps1');
  const notesFile = join(work, 'notes.json');
  const startedFile = join(work, 'started.txt');
  const settingsFile = join(work, 'powerpoint-settings.txt');
  // A copy made for the purpose: the operator may have the file itself open in PowerPoint.
  const copy = join(work, `Drashti copy${input.toLowerCase().endsWith('.ppt') ? '.ppt' : '.pptx'}`);
  await copyFile(input, copy);
  await writeFile(script, POWERPOINT_WINDOWS_SCRIPT);
  const runner = options.runPowerShell ?? windowsPowerShell;
  const timeoutMs =
    limits.startMs + limits.saveMs + limits.perSlideMs * Math.max(options.slideCount ?? 100, 1);
  const r = await runner(
    script,
    ['-In', copy, '-Out', pdf, '-Notes', notesFile, '-Started', startedFile, '-Settings', settingsFile],
    timeoutMs,
    signal,
  );
  if (r.timedOut || r.aborted) {
    // Stop the PowerPoint Drashti started, which is stuck, while it shows no window; one the operator had open stays.
    const ids = await readFile(startedFile, 'ascii').then(idsIn, () => []);
    const left = await stopStuckPowerPoint(ids, work, runner, options.log);
    const back = await putBackIfRunning(ids, left, settingsFile, copy, work, runner, options.log);
    if (r.aborted) return cancelled();
    return {
      ok: false,
      reason: 'PowerPoint stopped answering',
      message: `PowerPoint did not finish within ${String(Math.round(timeoutMs / 60_000))} minutes.${leftOpenWords(left)}${notBackWords(back)} ${byHand('powerpoint')}`,
    };
  }
  if (r.code !== 0 || !exists(pdf)) {
    // PowerPoint's own words go to the log only.
    const detail = firstLine(r.stderr);
    if (detail) options.log?.(`PowerPoint: failed: ${detail}`);
    return {
      ok: false,
      reason: 'it stopped with an error',
      message: `PowerPoint could not save it as PDF. ${byHand('powerpoint')}`,
    };
  }
  let slides: PptxSlide[] | null = null;
  try {
    const raw = JSON.parse((await readFile(notesFile, 'utf8')).replace(/^\uFEFF/u, '')) as unknown;
    if (Array.isArray(raw))
      slides = raw.map((s: { hidden?: unknown; notes?: unknown }) => ({
        hidden: s.hidden === true,
        notes: tidyNotes(typeof s.notes === 'string' ? s.notes : ''),
        animated: false,
      }));
  } catch {
    // No notes to be had: the pictures come without them.
  }
  return { ok: true, pdf, slides, shownOnly: false };
}

// ---- a deck's movie on Windows (Session 54, C2) ---------------------------------------------------

/**
 * PowerPoint on Windows working on a deck for its movie, in the PDF script's way (its questions and macros off,
 * the PowerPoint Drashti started below normal priority, written down, and quit when nothing else is open): an old
 * .ppt saved as a .pptx (`Presentation.SaveAs` with 24, ppSaveAsOpenXMLPresentation); the pictures saved as PDF
 * (32), should the movie not do; and the movie, by `Presentation.CreateVideo(FileName, UseTimingsAndNarrations,
 * DefaultSlideDuration, VertResolution, FramesPerSecond, Quality)`, which works in the background:
 * `Presentation.CreateVideoStatus` is read every half second until it is done (3, ppMediaTaskStatusDone) or has
 * failed (4, ppMediaTaskStatusFailed); 1 is in progress and 2 queued (Microsoft's PowerPoint VBA reference:
 * Presentation.CreateVideo, Presentation.CreateVideoStatus, PpMediaTaskStatus). Given the timed copy
 * (import/deck/timed-copy.ts), its own timings are used. CI has no Office: the mandir PC tries it for real
 * (assister/session-54-deck-trial.md, "What the mandir PC must try").
 */
export const POWERPOINT_WINDOWS_BAKE_SCRIPT = `param([Parameter(Mandatory)][string]$In, [string]$Pptx = '', [string]$Pdf = '', [string]$Movie = '', [Parameter(Mandatory)][string]$Started, [int]$LimitSeconds = 3600, [int]$StallSeconds = 0, [int]$WorkingMs = 500, [string]$Settings = '')
$ErrorActionPreference = 'Stop'
$before = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$app = New-Object -ComObject PowerPoint.Application
$ours = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
Set-Content -LiteralPath $Started -Value ($ours -join ',') -Encoding ASCII
foreach ($id in $ours) { try { (Get-Process -Id $id).PriorityClass = 'BelowNormal' } catch {} }
$alerts = $app.DisplayAlerts
$security = $app.AutomationSecurity
if ($Settings -ne '') { Set-Content -LiteralPath $Settings -Value "$([int]$alerts),$([int]$security)" -Encoding ASCII }
try { $app.DisplayAlerts = 1 } catch {}
$pres = $null
try {
  $app.AutomationSecurity = 3
  $pres = $app.Presentations.Open($In, -1, 0, 0)
  if ($Pptx -ne '') { $pres.SaveAs($Pptx, 24) }
  if ($Pdf -ne '') { try { $pres.SaveAs($Pdf, 32) } catch {} }
  if ($Movie -ne '') {
    $pres.CreateVideo($Movie, $true, 5, 1080, 30, 85)
    $deadline = (Get-Date).AddSeconds($LimitSeconds)
    $ppt = @(Get-Process POWERPNT -ErrorAction SilentlyContinue)[0]
    $cpu = { try { $ppt.Refresh(); $ppt.TotalProcessorTime.TotalMilliseconds } catch { $null } }
    $markCpu = & $cpu
    $markSize = -1
    $moved = Get-Date
    while ($true) {
      $status = $pres.CreateVideoStatus
      if ($status -eq 3) { break }
      if ($status -eq 4) { throw 'PowerPoint could not make the movie.' }
      if ((Get-Date) -gt $deadline) { throw 'PowerPoint did not finish the movie in time.' }
      $size = -1
      if (Test-Path -LiteralPath $Movie) { $size = (Get-Item -LiteralPath $Movie).Length }
      $now = & $cpu
      if ($size -ne $markSize -or ($null -ne $now -and $null -ne $markCpu -and $now - $markCpu -ge $WorkingMs)) {
        $markSize = $size
        $markCpu = $now
        $moved = Get-Date
      }
      if ($StallSeconds -gt 0 -and $null -ne $markCpu -and ((Get-Date) - $moved).TotalSeconds -gt $StallSeconds) { throw 'PowerPoint made no progress on the movie for a minute.' }
      Start-Sleep -Milliseconds 500
    }
  }
} finally {
  if ($pres) { try { $pres.Close() } catch {} }
  try { $app.DisplayAlerts = $alerts } catch {}
  try { $app.AutomationSecurity = $security } catch {}
  $shown = @($ours | Where-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; $p -and $p.MainWindowHandle -ne [IntPtr]::Zero })
  if ($ours.Count -gt 0 -and $app.Presentations.Count -eq 0 -and $shown.Count -eq 0) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
`;

/** What PowerPoint on Windows is asked to make of a deck: any of a .pptx, a PDF and a movie. */
export interface WindowsDeckWork {
  /** The file PowerPoint opens (a copy is made of it first). */
  input: string;
  pptx?: string;
  pdf?: string;
  movie?: string;
  /** The movie's time limit, once PowerPoint has started on it. */
  movieLimitMs?: number;
  /** No progress on the movie for this long, and it is given up on (Session 54, C review). */
  stallMs?: number;
}

/** Runs PowerShell with a script and its arguments (tests give a fake: CI has no Office). */
export type PowerShellRunner = (
  script: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<Ran>;

/**
 * Which of these PowerPoint processes shows a window (Session 54, C review): .NET's MainWindowHandle, a visible
 * window no other window owns. A copy Drashti opened has none (WithWindow msoFalse), and a question PowerPoint asks
 * about it belongs to its hidden window; so one that shows is the operator's doing: PowerPoint opened from the Start
 * menu, or a file of theirs, which Windows gives the PowerPoint already running.
 */
export const POWERPOINT_WINDOWS_SHOWN_SCRIPT = `param([Parameter(Mandatory)][string]$Ids)
$shown = @()
foreach ($id in ($Ids -split ',')) {
  $p = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
  if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { $shown += [int]$id }
}
Write-Output ($shown -join ',')
`;

/**
 * Stop the PowerPoint Drashti started that did not finish (it is stuck), but never one that shows a window: that
 * is the operator's now, with whatever they opened in it. Returns those left open; when it cannot be told, every
 * one is left.
 */
async function stopStuckPowerPoint(
  ids: number[],
  work: string,
  runner: PowerShellRunner,
  log?: (line: string) => void,
): Promise<number[]> {
  if (ids.length === 0) return [];
  const script = join(work, 'powerpoint-windows.ps1');
  await writeFile(script, POWERPOINT_WINDOWS_SHOWN_SCRIPT);
  const r = await runner(script, ['-Ids', ids.join(',')], 30_000);
  const known = r.code === 0 && !r.timedOut && !r.aborted;
  const shown = known ? idsIn(r.stdout.trim()) : ids;
  for (const id of ids) {
    if (shown.includes(id)) continue;
    try {
      process.kill(id);
    } catch {
      // Already gone.
    }
  }
  if (shown.length > 0)
    log?.(
      known
        ? `PowerPoint: left open, as it shows a window (${shown.map(String).join(', ')})`
        : `PowerPoint: left open, as it could not be told whether it shows a window: ${firstLine(r.stderr)}`,
    );
  return shown;
}

/**
 * Put PowerPoint's own settings back (Session 54, C review): its alerts and macro security, which a script turns
 * off while it works and puts back in its finally, which never runs when the script is stopped. They were written
 * down before they were changed; the PowerPoint running now (never one started for this) has Drashti's copy closed
 * and them put back.
 */
export const POWERPOINT_WINDOWS_PUT_BACK_SCRIPT = `param([Parameter(Mandatory)][string]$Settings, [string]$Copy = '')
$ErrorActionPreference = 'Stop'
$said = @((Get-Content -LiteralPath $Settings -Raw).Trim() -split ',')
$app = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
try {
  if ($Copy -ne '') {
    foreach ($p in @($app.Presentations)) { try { if ($p.FullName -eq $Copy) { $p.Close() } } catch {} }
  }
  $app.DisplayAlerts = [int]$said[0]
  $app.AutomationSecurity = [int]$said[1]
  Write-Output 'put back'
} finally {
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
`;

/**
 * After a script that was stopped: where PowerPoint still runs (the operator's own, which it was given, or one it
 * started and left open as it shows a window) and its settings were changed, put them back. Whether they are as
 * they were (true when nothing was changed, or that PowerPoint is gone).
 */
async function putBackIfRunning(
  ids: number[],
  left: number[],
  settings: string,
  copy: string,
  work: string,
  runner: PowerShellRunner,
  log?: (line: string) => void,
): Promise<boolean> {
  if (!exists(settings) || (ids.length > 0 && left.length === 0)) return true;
  const script = join(work, 'powerpoint-put-back.ps1');
  await writeFile(script, POWERPOINT_WINDOWS_PUT_BACK_SCRIPT);
  const r = await runner(script, ['-Settings', settings, '-Copy', copy], 30_000);
  const back = r.code === 0 && r.stdout.includes('put back');
  log?.(
    back
      ? 'PowerPoint: its alerts and macro settings put back as they were'
      : `PowerPoint: its alerts and macro settings could not be put back: ${firstLine(r.stderr) || 'no answer'}`,
  );
  return back;
}

/** What the operator is told of settings that could not be put back. */
const notBackWords = (back: boolean) =>
  back
    ? ''
    : ' Its alerts and macro settings, turned off while it worked, could not be put back: quit PowerPoint and open it again.';

/** What the operator is told of a stuck PowerPoint left open. */
const leftOpenWords = (left: number[]) =>
  left.length > 0
    ? ' PowerPoint shows a window now (opened meanwhile), so Drashti left it open: look at PowerPoint.'
    : '';

/** Windows PowerShell by its full path, with no PSModulePath from whatever started Drashti. */
const windowsPowerShell: PowerShellRunner = (script, args, timeoutMs, signal) => {
  const env = { ...process.env };
  delete env['PSModulePath'];
  const powershell = join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return run(
    powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    timeoutMs,
    signal,
    env,
  );
};

/**
 * PowerPoint on Windows making what `job` asks of a deck in `work` (Session 54, C2), with the PowerPoint Drashti
 * started told as the script writes it down and stopped when it does not finish in time. Resolves with what it
 * made, or why not.
 */
export async function deckOnWindows(
  job: WindowsDeckWork,
  work: string,
  options: ConvertOptions = {},
): Promise<{ ok: true } | ConvertFailed> {
  const limits = options.limits ?? CONVERT_LIMITS;
  const startedFile = join(work, `started-${String(Date.now())}.txt`);
  const settingsFile = join(work, `powerpoint-settings-${String(Date.now())}.txt`);
  const script = join(work, 'powerpoint-deck.ps1');
  // A copy made for the purpose: the operator may have the file itself open in PowerPoint.
  const copy = join(
    work,
    `Drashti copy ${String(Date.now())}${job.input.toLowerCase().endsWith('.ppt') ? '.ppt' : '.pptx'}`,
  );
  await copyFile(job.input, copy);
  await writeFile(script, POWERPOINT_WINDOWS_BAKE_SCRIPT);
  const movieLimitMs = job.movie ? (job.movieLimitMs ?? limits.movieMs) : 0;
  const timeoutMs =
    limits.startMs +
    limits.saveMs +
    limits.perSlideMs * Math.max(options.slideCount ?? 100, 1) +
    movieLimitMs;
  const ours = new Set<number>();
  const look = () =>
    readFile(startedFile, 'ascii').then(
      (text) => {
        for (const id of idsIn(text))
          if (!ours.has(id)) {
            ours.add(id);
            options.started?.(id);
          }
      },
      () => undefined,
    );
  const poll = setInterval(() => void look(), 500);
  const args = ['-In', copy, '-Started', startedFile, '-Settings', settingsFile];
  if (job.pptx) args.push('-Pptx', job.pptx);
  if (job.pdf) args.push('-Pdf', job.pdf);
  if (job.movie) args.push('-Movie', job.movie, '-LimitSeconds', String(Math.ceil(movieLimitMs / 1000)));
  if (job.movie && job.stallMs) args.push('-StallSeconds', String(Math.round(job.stallMs / 1000)));
  try {
    const runner = options.runPowerShell ?? windowsPowerShell;
    const r = await runner(script, args, timeoutMs, options.signal);
    await look();
    if (r.timedOut || r.aborted) {
      // Stop the PowerPoint Drashti started, which is stuck, while it shows no window; one the operator had open stays.
      const left = await stopStuckPowerPoint([...ours], work, runner, options.log);
      const back = await putBackIfRunning([...ours], left, settingsFile, copy, work, runner, options.log);
      if (r.aborted) return cancelled();
      return {
        ok: false,
        reason: 'PowerPoint stopped answering',
        message: `PowerPoint did not finish within ${String(Math.round(timeoutMs / 60_000))} minutes.${leftOpenWords(left)}${notBackWords(back)}`,
      };
    }
    const missing = [job.pptx, job.movie].find((f) => f !== undefined && !exists(f));
    if (r.code !== 0 || missing) {
      // PowerPoint's own words go to the log only.
      const detail = firstLine(r.stderr);
      if (detail) options.log?.(`PowerPoint: failed: ${detail}`);
      if (job.movie && detail.includes('made no progress on the movie'))
        return {
          ok: false,
          reason: 'it made no progress on the movie for a minute',
          message:
            'PowerPoint stopped making the deck’s movie: it made no progress for a minute, as when it asks something in a window nobody sees.',
        };
      return {
        ok: false,
        reason: job.movie ? 'it could not make the movie' : 'it could not save it as a .pptx',
        message: job.movie
          ? 'PowerPoint could not make the deck’s movie.'
          : 'PowerPoint could not save it as a .pptx.',
      };
    }
    return { ok: true };
  } finally {
    clearInterval(poll);
    for (const id of ours) options.ended?.(id);
    await rm(copy, { force: true }).catch(() => undefined);
  }
}
