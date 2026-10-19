import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cutText } from '../shared/text';
import { scrub } from './log';
import type { WatchdogEvent } from './watchdog';
import { whyText } from './watchdog';

/*
 * The crash journal (Sessions 31–36, ROB-6): the last 20 things that went wrong while Drashti ran (a
 * window that crashed, hung or was given up on, a GPU or utility process that stopped, an error in the
 * main process nobody caught), written to the data folder as each happens. The watchdog's own history
 * dies with Drashti; this survives it, so the next start can say what happened. Each entry is scrubbed
 * as it is written (the home folder as ~, no file addresses, no stream key) and cut to 300 letters.
 * Writing it never throws: a journal that cannot be written must never hide the problem itself.
 */

export const JOURNAL_FILE = 'crash-journal.json';
/** How many entries it keeps, the newest. */
export const JOURNAL_ENTRIES = 20;
/** How long an entry may be, in letters. */
export const JOURNAL_LETTERS = 300;

export interface CrashEntry {
  /** Counts up from 1 across the journal's life, so "shown up to" survives the oldest being dropped. */
  n: number;
  at: string;
  what: string;
}

interface JournalFile {
  version: 1;
  /** The next entry's number. */
  next: number;
  /** The last entry shown at a start. */
  shown: number;
  entries: CrashEntry[];
}

const empty = (): JournalFile => ({ version: 1, next: 1, shown: 0, entries: [] });

/** An entry as the journal keeps it: scrubbed, on one line, at most JOURNAL_LETTERS letters. */
export function scrubEntry(what: string): string {
  return cutText(scrub(what).replace(/\s+/gu, ' ').trim(), JOURNAL_LETTERS, '…');
}

const isEntry = (e: unknown): e is CrashEntry =>
  typeof e === 'object' &&
  e !== null &&
  Number.isInteger((e as CrashEntry).n) &&
  typeof (e as CrashEntry).at === 'string' &&
  typeof (e as CrashEntry).what === 'string';

/** The journal as kept, or null when the file is missing or not one Drashti wrote. Entries not in its form are left out. */
function read(file: string): JournalFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { version, next, shown, entries } = raw as Partial<JournalFile>;
  if (version !== 1 || !Number.isInteger(next) || !Number.isInteger(shown) || !Array.isArray(entries))
    return null;
  return {
    version,
    next: next ?? 1,
    shown: shown ?? 0,
    entries: entries.filter(isEntry).slice(-JOURNAL_ENTRIES),
  };
}

export class CrashJournal {
  private readonly state: JournalFile;

  constructor(
    private readonly file: string,
    private readonly warn: (line: string) => void = () => undefined,
  ) {
    this.state = read(file) ?? empty();
  }

  /** Its entries, oldest first. */
  entries(): readonly CrashEntry[] {
    return this.state.entries;
  }

  /** Note a problem as it happens (the file is written at once); its number, to say more about it later. */
  add(what: string, at = new Date()): number {
    const n = this.state.next;
    this.state.entries.push({ n, at: at.toISOString(), what: scrubEntry(what) });
    this.state.next++;
    if (this.state.entries.length > JOURNAL_ENTRIES)
      this.state.entries.splice(0, this.state.entries.length - JOURNAL_ENTRIES);
    this.write();
    return n;
  }

  /** Say an entry noted before again, with more (Session 38; the file is written at once): false when it is no longer kept. */
  amend(n: number, what: string): boolean {
    const entry = this.state.entries.find((e) => e.n === n);
    if (!entry) return false;
    entry.what = scrubEntry(what);
    this.write();
    return true;
  }

  /** What it noted since it was last shown, oldest first; from now on those count as shown. */
  takeUnshown(): CrashEntry[] {
    const unshown = this.state.entries.filter((e) => e.n > this.state.shown);
    const last = this.state.entries.at(-1);
    if (last && last.n > this.state.shown) {
      this.state.shown = last.n;
      this.write();
    }
    return unshown;
  }

  private write(): void {
    try {
      writeFileSync(`${this.file}.writing`, JSON.stringify(this.state));
      renameSync(`${this.file}.writing`, this.file);
    } catch (error) {
      this.warn(`The crash journal could not be written: ${String(error)}`);
    }
  }
}

/** A window as the journal names it. */
function windowName(window: string): string {
  if (window === 'operator') return 'the operator window';
  const output = /^output "(.*)"$/u.exec(window);
  if (output) return `output “${output[1] ?? ''}”`;
  return `the ${window}`;
}

/**
 * A watchdog event as the journal says it, or null for one that is no problem (a reload, a recovery, a
 * restart, whose wait goes into its hang's entry: `restarted`, how long Drashti waited, Session 38).
 */
export function watchdogWords(
  e: Pick<WatchdogEvent, 'window' | 'kind' | 'reason' | 'stack' | 'exit'>,
  restarted?: string,
): string | null {
  const name = windowName(e.window);
  // A crash with how its process ended (Session 39): "(crashed, exit code 0xC0000005)".
  const why = whyText(e);
  switch (e.kind) {
    case 'crashed':
      return `${name} crashed${why}; the watchdog brought it back`;
    case 'hung':
      // The wait before the stack, which is long: the cut to JOURNAL_LETTERS takes stack frames, never the figure.
      return `${name} hung${why}${restarted ? `; restarted after ${restarted}` : ''}${e.stack ? `; its JavaScript: ${e.stack}` : ''}`;
    case 'gave-up':
      return `${name} kept crashing, so the watchdog stopped it${why}`;
    case 'render-error':
      return `${name} failed as it drew${why}`;
    default:
      return null;
  }
}

/**
 * The watchdog's events into the journal, each as watchdogWords says it (Session 38). A hang is noted as it is
 * noticed, before the window is restarted, so a dump that stopped Drashti itself still leaves it said; the
 * restart then adds how long Drashti waited to that hang's entry.
 */
export function watchdogJournal(journal: CrashJournal): (e: WatchdogEvent) => void {
  /** Each window's last hang noted, waiting for its restart. */
  const hangs = new Map<string, { n: number; e: WatchdogEvent }>();
  return (e) => {
    if (e.kind === 'restarted') {
      const hang = hangs.get(e.window);
      hangs.delete(e.window);
      const words = hang && e.reason ? watchdogWords(hang.e, e.reason) : null;
      if (hang && words) journal.amend(hang.n, words);
      return;
    }
    const words = watchdogWords(e);
    if (words === null) return;
    const n = journal.add(words);
    if (e.kind === 'hung') hangs.set(e.window, { n, e });
  };
}

const GONE_WORDS: Record<string, string> = {
  crashed: 'crashed',
  killed: 'was stopped by the system',
  oom: 'ran out of memory',
  'abnormal-exit': 'stopped',
  'launch-failed': 'could not start',
  'integrity-failure': 'failed its code check',
};

/** A process that stopped (app's child-process-gone) as the journal says it, or null when it ended as it should. */
export function childGoneWords(d: {
  type: string;
  reason: string;
  exitCode: number;
  name?: string;
}): string | null {
  if (d.reason === 'clean-exit') return null;
  const what =
    d.type === 'Utility' ? `the utility process${d.name ? ` “${d.name}”` : ''}` : `the ${d.type} process`;
  return `${what} ${GONE_WORDS[d.reason] ?? `stopped (${d.reason})`}${d.exitCode ? ` (code ${String(d.exitCode)})` : ''}`;
}

/**
 * The start's notice about what went wrong while Drashti last ran (Sessions 31–36, ROB-6), or null when
 * nothing did: the last problem, and how many there were. `time` says an entry's time as people read it.
 */
export function journalNotice(unshown: readonly CrashEntry[], time: (iso: string) => string): string | null {
  const last = unshown.at(-1);
  if (!last) return null;
  const what =
    unshown.length === 1
      ? `a problem was noted at ${time(last.at)}: ${last.what}`
      : `${String(unshown.length)} problems were noted; the last at ${time(last.at)}: ${last.what}`;
  return `While Drashti last ran, ${what}. Help, then Save Diagnostics…, keeps the details for the admin.`;
}
