import { spawn } from 'node:child_process';
import { constants as fsConstants, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { basename, extname, join } from 'node:path';
import type { PictureSource } from '../../shared/pictures';
import { tidyNotes } from '../../shared/pictures';
import { type PptxSlide, readPptx } from './pictures';
import { readZipEntries } from './zip';

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

const exists = (path: string) => {
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
): Promise<{ ok: true; slides: PptxSlide[] | null } | { ok: false; message: string }> {
  const damaged = (detail: string) => ({
    ok: false as const,
    message: `This file looks damaged (${detail}). If it opens in ${source === 'key' ? 'Keynote' : 'PowerPoint'}, save it again there (or save it as PDF) and import that.`,
  });
  if (source === 'pptx') {
    try {
      return { ok: true, slides: await readPptx(path) };
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
      ? { ok: true, slides: null }
      : damaged('it is not a PowerPoint 97–2003 file');
  }
  if (source === 'key') {
    try {
      const parts = await readZipEntries(
        path,
        (name) => name === 'Index/Document.iwa' || name === 'index.apxl' || name === 'index.apxl.gz',
      );
      return parts.size > 0 ? { ok: true, slides: null } : damaged('it has no Keynote document inside');
    } catch (error) {
      return damaged(error instanceof Error ? error.message.replace(/\.$/u, '') : String(error));
    }
  }
  return { ok: true, slides: null };
}

// ---- running things ----------------------------------------------------------------------------

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Stopped by its time limit. */
  timedOut: boolean;
  /** Stopped because the import was cancelled. */
  aborted: boolean;
}

/** Run a program, giving up after `timeoutMs` or when `signal` says to stop. */
function run(
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

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });

const firstLine = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
    ?.slice(0, 300) ?? '';

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
}

export const CONVERT_LIMITS: ConvertLimits = {
  startMs: 120_000,
  openMs: 20_000,
  openPerMbMs: 1_000,
  openMaxMs: 180_000,
  silentMs: 45_000,
  saveMs: 60_000,
  perSlideMs: 3_000,
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
}

const appName = (converter: Converter) => (converter === 'keynote' ? 'Keynote' : 'PowerPoint');

/** How to do it by hand, after anything goes wrong. */
const byHand = (converter: Converter) =>
  converter === 'keynote'
    ? 'Open it in Keynote and choose File > Export To > PDF…, then import the PDF.'
    : 'Open it in PowerPoint and choose File > Save As, PDF, then import the PDF.';

const cancelled = (): Converted => ({
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
  if (platform === 'darwin') return convertOnMac(MAC_APPS[converter], input, work, limits, options);
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

async function convertOnMac(
  app: MacApp,
  input: string,
  work: string,
  limits: ConvertLimits,
  options: ConvertOptions,
): Promise<Converted> {
  const { signal } = options;
  const name = appName(app.converter);
  const started = Date.now();
  const log = (line: string) => options.log?.(`${name} +${String(Date.now() - started)} ms: ${line}`);
  /** The app's processes before: none means Drashti starts it, and quits it afterwards. */
  const before = await pidsOf(app);
  /** The app in front before: an app that comes to the front meanwhile is showing the operator something. */
  const frontBefore = await frontApp();
  /** Whether the app took the front from Drashti (a question about the file, in front of the operator). */
  const tookFront = async () => {
    if (frontBefore?.id === app.id) return false;
    return (await frontApp())?.id === app.id;
  };
  /** `answering` is false once the app has stopped answering (it is asking a question nobody sees). */
  const state = { answering: true, shown: false };
  /** The open document, as the app knows it, once found. */
  let doc: string | null = null;
  // PowerPoint for Mac may only read and write in its own folders: work there.
  const folder =
    app.converter === 'powerpoint'
      ? join(homedir(), 'Library', 'Group Containers', 'UBF8T346G9.Office', 'Drashti')
      : work;
  let inside: string | null = null;
  /**
   * The name the copy is opened under: the file's own (the app may show it in a
   * question), and a number no document of the operator's has.
   */
  const stem = `${basename(input, extname(input)).slice(0, 60)} (Drashti copy ${String(1000 + Math.floor(Math.random() * 9000))})`;

  const fail = (reason: string, message: string, extra: { notAllowed?: boolean } = {}): Converted => {
    log(`failed: ${reason}`);
    return { ok: false, reason, message, ...extra };
  };
  /** Why the app stopped answering, and what became of it. */
  const silentFail = (when: string): Converted => {
    state.answering = false;
    return fail(
      `${name} stopped answering`,
      `${name} stopped answering while ${when}: it may be asking a question about this file in a window behind Drashti. ${
        before.length === 0
          ? `Drashti closed ${name}, which it had started.`
          : `${name} was already open, so Drashti left it as it is: look at ${name} and answer it.`
      } ${byHand(app.converter)}`,
    );
  };
  const fromError = (r: Ran, when: string): Converted => {
    if (r.aborted) return cancelled();
    const n = errorNumber(r.stderr);
    if (n === NOT_ALLOWED)
      return fail(`not allowed to use ${name}`, notAllowedMessage(app.converter), { notAllowed: true });
    if (r.timedOut || n === TIMED_OUT) return silentFail(when);
    const detail = firstLine(r.stderr);
    return fail(
      `${name} could not save it as PDF`,
      `${name} could not save it as PDF${detail ? ` (${detail})` : ''}. ${byHand(app.converter)}`,
    );
  };

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
        break;
      }
      const n = errorNumber(r.stderr);
      if (n === NOT_ALLOWED) return fromError(r, 'starting');
      if (Date.now() > deadline)
        return fail(
          `${name} did not answer`,
          `${name} did not start or answer within ${String(Math.round(limits.startMs / 1000))} seconds. If macOS asked whether Drashti may control ${name}, choose Allow, then import the file again. ${byHand(app.converter)}`,
        );
      // Not answering yet, or gone (it quit while starting, as a first start after an update can).
      await sleep(500, signal);
    }

    // ---- open a copy of the file, made for the purpose -----------------------------------
    await mkdir(folder, { recursive: true });
    inside = await mkdtemp(join(folder, 'convert-'));
    const ext = input.toLowerCase().endsWith('.ppt')
      ? '.ppt'
      : input.toLowerCase().endsWith('.key')
        ? '.key'
        : '.pptx';
    const copy = join(inside, `${stem}${ext}`);
    // A clone where the disk can (no copying on APFS), a copy otherwise.
    await copyFile(input, copy, fsConstants.COPYFILE_FICLONE);
    // Keynote is given the copy the way a double-click gives it (through LaunchServices): asked by
    // AppleScript instead, its sandbox often could not read a .pptx ("not found"), and it said so
    // in a window nobody saw. PowerPoint reads its own folder either way.
    const opened =
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
    if (opened.code !== 0) return fromError(opened, 'opening the file');
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
    const mb = (await stat(input)).size / (1024 * 1024);
    const openLimit = Math.min(limits.openMaxMs, limits.openMs + limits.openPerMbMs * mb);
    // Only time while the app answers counts against the limit: one that is busy or slow to start
    // is waited for (up to `silentMs` without an answer).
    let answeringFor = 0;
    let lastAnswer = Date.now();
    let answeredLast = true;
    let slides = options.slideCount ?? 0;
    for (;;) {
      const r = await tellApp(app, find, [stem, copy], 5, signal);
      if (r.aborted) return cancelled();
      if (r.code === 0) {
        if (answeredLast) answeringFor += Date.now() - lastAnswer;
        answeredLast = true;
        lastAnswer = Date.now();
        const [found, count] = r.stdout.trim().split('\n');
        if (found) {
          doc = found;
          slides = Number(count) || slides;
          log(`open, ${String(slides)} slides`);
          break;
        }
      } else {
        answeredLast = false;
        const n = errorNumber(r.stderr);
        if (n === NOT_ALLOWED || (n !== null && GONE.has(n)) || !(r.timedOut || n === TIMED_OUT))
          return fromError(r, 'opening the file');
      }
      if (Date.now() - lastAnswer > limits.silentMs) return silentFail('opening the file');
      if (await tookFront()) {
        log('came to the front instead of opening it');
        state.shown = true;
        return fail(
          `${name} could not open it`,
          `${name} could not open the file and showed a message about it: it may be damaged. ${
            before.length === 0
              ? `Drashti closed ${name}, which it had started.`
              : `${name} was already open, so Drashti left it as it is: look at ${name} and answer it.`
          } ${byHand(app.converter)}`,
        );
      }
      if (answeringFor > openLimit)
        return fail(
          `${name} did not open it`,
          `${name} did not open the file: it may be damaged, or ${name} may be asking about it in a window behind Drashti. ${byHand(app.converter)}`,
        );
      await sleep(500, signal);
    }

    // ---- save it as PDF (and a Keynote file as PowerPoint too, for its builds) -------------
    const pdf = join(work, 'pictures.pdf');
    const inApp = join(inside, 'pictures.pdf');
    const pptx = join(inside, 'builds.pptx');
    const wantBuilds =
      app.converter === 'keynote' && ext === '.key' && (await stat(input)).size <= BUILDS_MAX_BYTES;
    const seconds = Math.ceil((limits.saveMs + limits.perSlideMs * Math.max(slides, 1)) / 1000);
    const saved =
      app.converter === 'keynote'
        ? await tellApp(
            app,
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
            signal,
          )
        : await tellApp(
            app,
            [
              'save presentation (item 1 of argv) in (POSIX file (item 2 of argv)) as save as PDF',
              'return ""',
            ],
            [doc, inApp],
            seconds,
            signal,
          );
    if (saved.code !== 0) return fromError(saved, 'saving it as PDF');
    // PowerPoint can say it saved and write nothing (a file it could not draw): give it a moment.
    for (let i = 0; i < 20 && !exists(inApp); i++) await sleep(250, signal);
    if (signal?.aborted) return cancelled();
    if (!exists(inApp))
      return fail(
        `${name} could not save it as PDF`,
        `${name} could not save it as PDF. ${byHand(app.converter)}`,
      );
    await copyFile(inApp, pdf);
    log('saved as PDF');

    let fileSlides: PptxSlide[] | null = null;
    let shownOnly = false;
    if (app.converter === 'keynote') {
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
  } finally {
    // ---- leave the app as the operator had it ----------------------------------------------
    if (doc !== null && state.answering) {
      const close =
        app.converter === 'keynote'
          ? 'close (document id (item 1 of argv)) saving no'
          : 'close presentation (item 1 of argv) saving no';
      const closed = await tellApp(app, [close], [doc], 10);
      log(closed.code === 0 ? 'closed the copy' : `could not close the copy: ${firstLine(closed.stderr)}`);
    }
    if (before.length === 0) await quitIfIdle(app, before, stem, state.answering, log);
    else log('left open, as the operator had it');
    // The app took the front from Drashti: give the operator's window the keys back.
    if (state.shown && frontBefore?.pid === process.ppid) {
      log('Drashti back in front');
      options.refocus?.();
    }
    if (inside) await rm(inside, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Quit an app Drashti started (it was not running before), unless something
 * besides Drashti's copy is open in it; stop it if it does not answer, or
 * does not quit (a question nobody sees can hold it up).
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
    const docs = app.converter === 'keynote' ? 'documents' : 'presentations';
    const r = await tellApp(
      app,
      [
        'set others to 0',
        `repeat with d in ${docs}`,
        'if not ((name of d) starts with (item 1 of argv)) then set others to others + 1',
        'end repeat',
        'if others is 0 then quit saving no',
        'return others as text',
      ],
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
    }
    log(
      r.code === 0 ? 'did not quit when asked' : `did not answer when asked to quit: ${firstLine(r.stderr)}`,
    );
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
 * running, open the copy read-only without a window and with its questions
 * off, save as PDF (32 is ppSaveAsPDF), note every slide's notes and whether
 * it is hidden, close, and quit PowerPoint only if Drashti started it and
 * nothing else is open. A PowerPoint Drashti started runs below normal
 * priority, and its process id is written down so Drashti can stop it if it
 * stops answering.
 */
const POWERPOINT_WINDOWS_SCRIPT = `param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$Notes, [Parameter(Mandatory)][string]$Started)
$ErrorActionPreference = 'Stop'
$before = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$app = New-Object -ComObject PowerPoint.Application
$ours = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
Set-Content -LiteralPath $Started -Value ($ours -join ',') -Encoding ASCII
foreach ($id in $ours) { try { (Get-Process -Id $id).PriorityClass = 'BelowNormal' } catch {} }
$alerts = $app.DisplayAlerts
try { $app.DisplayAlerts = 1 } catch {}
$pres = $null
try {
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
  if ($ours.Count -gt 0 -and $app.Presentations.Count -eq 0) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
`;

async function convertOnWindows(
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
  // A copy made for the purpose: the operator may have the file itself open in PowerPoint.
  const copy = join(work, `Drashti copy${input.toLowerCase().endsWith('.ppt') ? '.ppt' : '.pptx'}`);
  await copyFile(input, copy);
  await writeFile(script, POWERPOINT_WINDOWS_SCRIPT);
  // Windows PowerShell by its full path, with no PSModulePath from whatever started Drashti.
  const env = { ...process.env };
  delete env['PSModulePath'];
  const powershell = join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const timeoutMs =
    limits.startMs + limits.saveMs + limits.perSlideMs * Math.max(options.slideCount ?? 100, 1);
  const r = await run(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-In',
      copy,
      '-Out',
      pdf,
      '-Notes',
      notesFile,
      '-Started',
      startedFile,
    ],
    timeoutMs,
    signal,
    env,
  );
  if (r.timedOut || r.aborted) {
    // Stop the PowerPoint Drashti started, which is stuck; one the operator had open stays.
    try {
      const ids = (await readFile(startedFile, 'ascii'))
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      for (const id of ids) {
        try {
          process.kill(id);
        } catch {
          // Already gone.
        }
      }
    } catch {
      // PowerPoint never started.
    }
    if (r.aborted) return cancelled();
    return {
      ok: false,
      reason: 'PowerPoint stopped answering',
      message: `PowerPoint did not finish within ${String(Math.round(timeoutMs / 60_000))} minutes. ${byHand('powerpoint')}`,
    };
  }
  if (r.code !== 0 || !exists(pdf)) {
    const detail = firstLine(r.stderr);
    return {
      ok: false,
      reason: 'PowerPoint could not save it as PDF',
      message: `PowerPoint could not save it as PDF${detail ? ` (${detail})` : ''}. ${byHand('powerpoint')}`,
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
