import { redactNames } from './library-redaction';

/*
 * A line in the log for every show command and every operator request (alpha.21, logs for 100+ installs (a), the
 * owner's "for all users there should be a log of everythiing as we expect more than 100, if someone has issue, i
 * should identify and troubleshoot based in logs"): its name, its ids, numbers and choices, and what came of it, from
 * the operator window, a phone, Companion, OSC or a script alike (the engine hears them all); and every notice the
 * operator is shown. Never content: no words, titles or names (a notice’s library names and names in quotes are blanked). A burst of
 * the same one (a slider, a drag) is one line, then one line a second at most counting the rest. Lines are written a
 * turn after the command was answered, together, never in its way.
 */

export interface CommandLogDeps {
  /** One line into the log (log.info). */
  write(line: string): void;
  /** Read at each notice, so names added or renamed since the last notice are protected too. */
  libraryNames(): readonly string[];
  now(): number;
  setTimer(ms: number, run: () => void): () => void;
}

/** A burst: within this long of the last line for the same command, it is counted, not written. */
export const COMMAND_BURST_MS = 1000;

/** A request's verb (after the colon) that only reads: never logged (the window asks them all the time). */
const READS =
  /^(?:get|list|view|status|search|read|tree|items|details|words|usage|looks?|snapshot|saves|conversions|categories|tracks|templates|state|watch|proxy-status|served|thumbs|everything|last|last-said|pending|extras|single-keys|safe-areas|info|mode|no-gpu|plays-hevc|preparing-trims|markers|video-analysis|video-edit|resume-point|keyframe|playback|photo|media-ready|pdf-page-sources|presentation-usage|qr-choices|smart-views|first-slides|slides-for-edit|import-progress|legacy-presentations|subscribe|point-at|asset|job|page|done|pointed|report|context|dirty|adjusting|said|said-closed|asking|answered|covered|normalized|capture|ask|access|ended|changed|next|made|get-.+|list-.+|report-.+|test-.+)$/u;

/**
 * Requests that change nothing an operator did, or are logged their own way: the show's commands (the engine's line),
 * a window's render errors (their own line), the pages' own bookkeeping, and reads whose verb says otherwise.
 */
const NOT_LOGGED = new Set([
  'engine:command',
  'app:render-error',
  'app:window-started',
  'app:start-notice',
  'ready:check',
  'playlists:opened',
  'slideeditor:font-families',
  'slideeditor:copied',
  'stream:page-context',
  'stream:page-inputs',
  'stream:profiles',
  'stream:watch-preview',
  'shastra:resolve',
  'shastra:passage',
  'shastra:item-passage',
  'videoinput:cameras',
  'youtube:upcoming',
  'stage:layouts',
  'library:take-automatic-import-notices',
  'media:no-picture',
  'media:cannot-play',
  // Asked every second or few while their window is open (reads, though their verbs do not say so).
  'media:clip-clips',
  'accesslist:refresh',
]);

/** Whether a request on this channel goes into the log (one that changes something). */
export function requestLogged(channel: string): boolean {
  if (NOT_LOGGED.has(channel)) return false;
  const verb = channel.slice(channel.indexOf(':') + 1);
  return verb !== '' && !READS.test(verb);
}

/** Any name in quotes blanked: “…” and "…" (a ’ is an apostrophe, left). */
export function blankQuoted(text: string): string {
  return text.replace(/“[^”]*”/gu, '“…”').replace(/"[^"\n]*"/gu, '"…"');
}

/** Keys whose word is one of the command's own choices (never words someone typed). */
const CHOICES = new Set([
  'layer',
  'kind',
  'media',
  'fit',
  'size',
  'corner',
  'motion',
  'layout',
  'lang',
  'mode',
  'to',
  'direction',
  'where',
  'side',
  'which',
]);
const ID_KEY = /^(?:id|[a-zA-Z]+Id)$/u;
const ID_VALUE = /^[A-Za-z0-9_.:-]{1,80}$/u;
const CHOICE_VALUE = /^[a-z][a-zA-Z0-9-]{0,30}$/u;

const number = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e4) / 1e4));

/** One value as the log may write it, or null when it may not (words, titles, names). */
function valueText(key: string, value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? number(value) : null;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') {
    if (ID_KEY.test(key) && ID_VALUE.test(value)) return value;
    if (CHOICES.has(key) && CHOICE_VALUE.test(value)) return value;
    return null;
  }
  if (Array.isArray(value)) return `${String(value.length)} items`;
  return null;
}

/** A command's ids, numbers and choices (one level into an object it carries), as "key=value"s. */
export function commandFields(command: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(command)) {
    if (key === 'type' || value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [inner, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === null || v === undefined || (typeof v === 'object' && !Array.isArray(v))) continue;
        const text = valueText(inner, v);
        if (text !== null) out.push(`${key}.${inner}=${text}`);
      }
      continue;
    }
    const text = valueText(key, value);
    if (text !== null) out.push(`${key}=${text}`);
  }
  return out;
}

type Result = { ok: true; changed: boolean; rev: number } | { ok: false; error: string; message?: string };

const outcomeOf = (r: Result) =>
  r.ok ? `${r.changed ? 'done' : 'nothing changed'} (revision ${String(r.rev)})` : `not done (${r.error})`;

interface Burst {
  /** When the last line for it was written. */
  lastAt: number;
  held: number;
  firstHeldAt: number;
  lastHeldAt: number;
  last: string;
  stop: (() => void) | null;
}

export class CommandLog {
  private readonly bursts = new Map<string, Burst>();
  private queue: string[] = [];
  private flushing: (() => void) | null = null;

  constructor(private readonly d: CommandLogDeps) {}

  /** A show command, whoever sent it, and what came of it. */
  show(command: { type: string } & Record<string, unknown>, result: Result): void {
    const fields = commandFields(command);
    this.heard(
      `Show: ${command.type}`,
      `${fields.length > 0 ? ` ${fields.join(' ')}` : ''}: ${outcomeOf(result)}`,
      fields.length > 0 ? `${fields.join(' ')}: ${outcomeOf(result)}` : outcomeOf(result),
    );
  }

  /**
   * A change the show made by itself (a slide moving on, a message's time up, what a restart put back): the parts that
   * changed (the show's own names: slide, background, black-out…), never what they hold, and its revision.
   */
  changedByItself(rev: number, parts: readonly string[]): void {
    // A burst of the same parts (a timer's message coming and going) is one line, then a count.
    this.heard(
      `Show: changed by itself: ${parts.join(', ')}`,
      ` (revision ${String(rev)})`,
      `revision ${String(rev)}`,
    );
  }

  /** An operator request that changes something (requestLogged), and how it went; a failure by its error's name. */
  request(channel: string, outcome: string, error?: unknown): void {
    if (!requestLogged(channel)) return;
    const said =
      outcome === 'failed' ? `failed (${error instanceof Error ? error.name : 'an error'})` : outcome;
    this.heard(`Request: ${channel}`, `: ${said}`, said);
  }

  /** A notice the operator was shown: library names blanked as in diagnostics, then any names in quotes. */
  notice(text: string): void {
    let safe: string;
    try {
      safe = redactNames(text, this.d.libraryNames());
    } catch {
      // A closed or unreadable library must never let its names into the raw log.
      safe = '[words unavailable]';
    }
    this.add(`Notice: ${blankQuoted(safe.replace(/\s+/gu, ' ').trim())}`);
  }

  /** Every line waiting, written now (the window closing, Drashti quitting). */
  flush(): void {
    this.flushing?.();
    this.flushing = null;
    const lines = this.queue;
    this.queue = [];
    for (const line of lines) this.d.write(line);
  }

  private heard(key: string, rest: string, last: string): void {
    const now = this.d.now();
    const burst = this.bursts.get(key);
    if (!burst || (burst.held === 0 && now - burst.lastAt >= COMMAND_BURST_MS)) {
      this.bursts.set(key, { lastAt: now, held: 0, firstHeldAt: 0, lastHeldAt: 0, last: '', stop: null });
      this.add(`${key}${rest}`);
      return;
    }
    if (burst.held === 0) burst.firstHeldAt = now;
    burst.held++;
    burst.lastHeldAt = now;
    burst.last = last;
    burst.stop ??= this.d.setTimer(Math.max(0, burst.lastAt + COMMAND_BURST_MS - now), () => {
      burst.stop = null;
      const seconds = ((burst.lastHeldAt - burst.firstHeldAt) / 1000).toFixed(1);
      this.add(`${key} ×${String(burst.held)} more in ${seconds} s (the last: ${burst.last})`);
      burst.lastAt = this.d.now();
      burst.held = 0;
    });
  }

  private add(line: string): void {
    this.queue.push(line);
    this.flushing ??= this.d.setTimer(0, () => {
      this.flushing = null;
      this.flush();
    });
  }
}
