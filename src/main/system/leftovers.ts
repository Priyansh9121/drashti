import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { powershellEnv, powershellPath, runPowerShell } from './powershell';

/*
 * Programs Drashti starts that can outlive it (Session 31, ROB-3): a conversion's FFmpeg, yt-dlp (with the
 * Deno and FFmpeg it starts), and a PowerPoint or Keynote Drashti itself started to save a deck as PDF.
 * When Drashti quits they are stopped; when it is stopped dead (a crash, a power cut, a forced quit) they
 * carry on alone, an FFmpeg converting for nobody, a hidden PowerPoint holding a file.
 *
 * So each one is written down as it starts, with its process id, its start time and its program, as the
 * system itself says them, and forgotten once it ends. At the next start, before anything could start one
 * again, each written down that is still running, with that id, start time and program all the same, is
 * stopped and the log says so. A process that only has the id (the system gave it to another program since)
 * is never touched, and neither is an operator's own PowerPoint: only one Drashti started is ever written
 * down, and only until its deck is saved.
 */

export type ChildKind = 'conversion' | 'yt-dlp' | 'PowerPoint' | 'Keynote';

export interface ChildEntry {
  pid: number;
  /** When the system says it started (ms since the epoch). */
  startedAt: number;
  /** Its program, as the system says it. */
  path: string;
  what: ChildKind;
  /** It leads a process group (yt-dlp on a Mac): stopped with its group. */
  group: boolean;
  /** A part-file it was writing (a Save as MP4's, beside where it was to go): removed at the next start. */
  partFile?: string;
}

/** What the system says of a running process. */
export interface ProcessFacts {
  startedAt: number;
  path: string;
}

const entrySchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.number(),
  path: z.string().min(1).max(4096),
  what: z.enum(['conversion', 'yt-dlp', 'PowerPoint', 'Keynote']),
  group: z.boolean(),
  partFile: z.string().max(4096).optional(),
});
const fileSchema = z.object({ version: z.literal(1), children: z.array(entrySchema).max(1000) });

/** The same program: the same path, letter case aside on Windows (the system's own spelling either way). */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Whether a running process is the one written down: the same id, start time and program. */
export function isTheOne(
  entry: ChildEntry,
  facts: ProcessFacts | undefined,
  platform?: NodeJS.Platform,
): boolean {
  return facts?.startedAt === entry.startedAt && samePath(facts.path, entry.path, platform);
}

// ---- what the system says ------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `ps -o pid=,lstart=,comm=` (macOS and Linux, LC_ALL=C): "4704 Sat Oct 17 11:17:52 2026 /path/to/ffmpeg".
 * The start time is the computer's own local time, to the second.
 */
export function parsePs(text: string): Map<number, ProcessFacts> {
  const out = new Map<number, ProcessFacts>();
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+(.+?)\s*$/u.exec(
      line,
    );
    if (!m) continue;
    const month = MONTHS.indexOf(m[2] ?? '');
    if (month < 0) continue;
    const at = new Date(
      Number(m[7]),
      month,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ).getTime();
    out.set(Number(m[1]), { startedAt: at, path: m[8] ?? '' });
  }
  return out;
}

/** Windows PowerShell's lines "pid|start (ISO, UTC)|program". */
export function parseWindows(text: string): Map<number, ProcessFacts> {
  const out = new Map<number, ProcessFacts>();
  for (const line of text.split(/\r?\n/u)) {
    const [pid = '', start = '', ...path] = line.trim().split('|');
    const at = Date.parse(start);
    const program = path.join('|');
    if (/^\d+$/u.test(pid) && Number.isFinite(at) && program !== '')
      out.set(Number(pid), { startedAt: at, path: program });
  }
  return out;
}

const run = (file: string, args: string[], env?: NodeJS.ProcessEnv) =>
  new Promise<string>((resolve) => {
    execFile(file, args, { timeout: 10_000, windowsHide: true, env }, (_error, stdout) => {
      // ps says nothing for an id no process has (and exits 1 when none of them has one).
      resolve(stdout);
    });
  });

/** What the system says of these processes (those still running). */
export async function processFacts(
  pids: readonly number[],
  platform: NodeJS.Platform = process.platform,
): Promise<Map<number, ProcessFacts>> {
  const ids = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (ids.length === 0) return new Map();
  if (platform === 'win32') {
    return parseWindows((await runPowerShell(windowsScript(ids), {}, 20_000)) ?? '');
  }
  const facts = parsePs(
    await run('ps', ['-o', 'pid=,lstart=,comm=', '-p', ids.join(',')], {
      ...process.env,
      LC_ALL: 'C',
      LANG: 'C',
    }),
  );
  // Linux's comm is only the short name: its program is /proc/<pid>/exe.
  if (platform === 'linux')
    for (const [pid, f] of facts)
      try {
        facts.set(pid, { ...f, path: readlinkSync(`/proc/${String(pid)}/exe`) });
      } catch {
        facts.delete(pid);
      }
  return facts;
}

/** The Windows PowerShell script that says these processes' ids, start times (UTC) and programs. */
const windowsScript = (ids: readonly number[]) =>
  `Get-CimInstance Win32_Process -Filter "${ids.map((p) => `ProcessId=${String(p)}`).join(' OR ')}" | ForEach-Object { "$($_.ProcessId)|$($_.CreationDate.ToUniversalTime().ToString('o'))|$($_.ExecutablePath)" }`;

/**
 * The same, waited for (at start, after a crash only: the record is empty after a quit). A moment on a Mac;
 * a second or two on Windows, which starts PowerShell for it.
 */
export function processFactsNow(
  pids: readonly number[],
  platform: NodeJS.Platform = process.platform,
): Map<number, ProcessFacts> {
  const ids = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (ids.length === 0) return new Map();
  const said = (file: string, args: string[], env: NodeJS.ProcessEnv) => {
    try {
      return execFileSync(file, args, { timeout: 20_000, windowsHide: true, env, encoding: 'utf8' });
    } catch (error) {
      // ps exits 1 when none of them is running, having said nothing.
      const out = (error as { stdout?: unknown }).stdout;
      return typeof out === 'string' ? out : '';
    }
  };
  if (platform === 'win32')
    return parseWindows(
      said(
        powershellPath(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', windowsScript(ids)],
        powershellEnv(),
      ),
    );
  const facts = parsePs(
    said('ps', ['-o', 'pid=,lstart=,comm=', '-p', ids.join(',')], { ...process.env, LC_ALL: 'C', LANG: 'C' }),
  );
  if (platform === 'linux')
    for (const [pid, f] of facts)
      try {
        facts.set(pid, { ...f, path: readlinkSync(`/proc/${String(pid)}/exe`) });
      } catch {
        facts.delete(pid);
      }
  return facts;
}

/** Stop a process (with the processes it started, where the system allows), at once. */
export function stopProcess(entry: ChildEntry, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') {
    execFile(
      join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(entry.pid), '/T', '/F'],
      { windowsHide: true },
      () => undefined,
    );
    return;
  }
  try {
    process.kill(entry.group ? -entry.pid : entry.pid, 'SIGKILL');
  } catch {
    try {
      process.kill(entry.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it is there, but not ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// ---- the record --------------------------------------------------------------------------------------

export interface LeftoversDeps {
  /** The record, in Drashti's data folder (one per data folder, as the single-instance lock is). */
  file: string;
  facts?(pids: readonly number[]): Promise<Map<number, ProcessFacts>>;
  /** The same, waited for (the start-up sweep). */
  factsNow?(pids: readonly number[]): Map<number, ProcessFacts>;
  stop?(entry: ChildEntry): void;
  alive?(pid: number): boolean;
  /** This Drashti's own process id: never stopped. */
  ownPid?: number;
  log(level: 'info' | 'warn', message: string): void;
}

export class Leftovers {
  /** Ids that ended before the system had said their start time: never written down late. */
  private readonly ended = new Set<number>();

  constructor(private readonly deps: LeftoversDeps) {}

  private read(): ChildEntry[] {
    try {
      if (!existsSync(this.deps.file)) return [];
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.deps.file, 'utf8')));
      return parsed.success ? parsed.data.children : [];
    } catch {
      return [];
    }
  }

  private write(children: ChildEntry[]): void {
    try {
      const tmp = `${this.deps.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, children }), { mode: 0o600 });
      renameSync(tmp, this.deps.file);
    } catch (error) {
      this.deps.log('warn', `The list of programs Drashti started could not be kept: ${String(error)}`);
    }
  }

  /** The record as it is (tests). */
  entries(): ChildEntry[] {
    return this.read();
  }

  /**
   * A program Drashti just started: written down once the system says when it started and what it is
   * (a moment later; nothing if it ended meanwhile).
   */
  async started(
    pid: number | undefined,
    what: ChildKind,
    options: { group?: boolean; partFile?: string } = {},
  ): Promise<void> {
    if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return;
    this.ended.delete(pid);
    const facts = (await (this.deps.facts ?? processFacts)([pid])).get(pid);
    if (!facts || this.ended.has(pid)) {
      this.ended.delete(pid);
      return;
    }
    const entry: ChildEntry = {
      pid,
      startedAt: facts.startedAt,
      path: facts.path,
      what,
      group: options.group ?? false,
      ...(options.partFile ? { partFile: options.partFile } : {}),
    };
    this.write([...this.read().filter((e) => e.pid !== pid), entry]);
  }

  /** It ended (or was stopped by Drashti): forgotten. */
  forget(pid: number | null | undefined): void {
    if (pid === null || pid === undefined) return;
    this.ended.add(pid);
    const children = this.read();
    if (children.some((e) => e.pid === pid)) this.write(children.filter((e) => e.pid !== pid));
  }

  /**
   * At start, before anything could start one again: stop each program the last run left running, the
   * very one written down (id, start time and program), and say so; remove the part-files they were
   * writing; then start the record afresh. Asks the system nothing when the record is empty (after a
   * quit, it is). Waited for: the services that clear their part-files start after it.
   */
  stopLeft(): number {
    const children = this.read();
    if (children.length === 0) return 0;
    const facts = (this.deps.factsNow ?? processFactsNow)(children.map((e) => e.pid));
    const own = this.deps.ownPid ?? process.pid;
    const stopping = children.filter((e) => e.pid !== own && isTheOne(e, facts.get(e.pid)));
    for (const entry of stopping) {
      (this.deps.stop ?? stopProcess)(entry);
      this.deps.log(
        'warn',
        `Stopped ${entry.what === 'conversion' ? 'a conversion' : entry.what} left running by the last run (process ${String(entry.pid)})`,
      );
    }
    // Gone before the services that use their files start (Windows lets a file go only once its process has).
    const isAlive = (pid: number) => (this.deps.alive ? this.deps.alive(pid) : alive(pid));
    for (let i = 0; i < 50 && stopping.some((e) => isAlive(e.pid)); i++) pause(100);
    for (const entry of children)
      if (entry.partFile && existsSync(entry.partFile)) {
        try {
          rmSync(entry.partFile, { force: true });
          this.deps.log('info', 'Removed a part-file left by the last run');
        } catch {
          // Still held: the next start tries again only if it is written down again.
        }
      }
    this.write([]);
    return stopping.length;
  }
}

/** Wait this long, here and now (the start-up sweep only). */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The record's file in a data folder. */
export const leftoversFile = (userData: string) => join(userData, 'started-programs.json');
