import { plural } from '../shared/text';

/** The parts of Electron's WebContents the watchdog needs (easy to fake in tests). */
export interface WatchTarget {
  on(event: 'render-process-gone', listener: (event: unknown, details: { reason: string }) => void): unknown;
  on(event: 'unresponsive' | 'responsive' | 'destroyed', listener: () => void): unknown;
  reload(): void;
  forcefullyCrashRenderer(): void;
  isDestroyed(): boolean;
}

export type WatchdogEventKind =
  'crashed' | 'reloaded' | 'unresponsive' | 'responsive' | 'hung' | 'gave-up' | 'render-error' | 'retried';

export interface WatchdogEvent {
  window: string;
  kind: WatchdogEventKind;
  reason?: string;
  at: number;
}

export interface WatchdogOptions {
  /** How long a renderer may stay unresponsive before it is restarted. */
  hangMs?: number;
  /** Give up after this many crashes within a minute (a crash loop). */
  maxCrashesPerMinute?: number;
  /** Waits before each successive reload: the first crash reloads almost at once. */
  backoffMs?: readonly number[];
}

/** After giving up on a window (a crash loop), it is tried again this long after (Session 23)... */
export const RETRY_FIRST_MS = 2 * 60_000;
/** ...and then this long after each time it gives up again. */
export const RETRY_AGAIN_MS = 10 * 60_000;

interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => {
    clearTimeout(h as NodeJS.Timeout);
  },
  now: () => Date.now(),
};

/**
 * Keeps renderer processes alive. A crashed renderer is reloaded (with
 * back-off, and not forever in a crash loop); a hung one is restarted after
 * `hangMs`. Output windows are separate processes, so the operator window
 * crashing or reloading never touches what the screens show.
 */
export class RendererWatchdog {
  readonly events: WatchdogEvent[] = [];
  /** When each window was last reloaded after a render error. */
  private readonly renderReloads = new Map<string, number>();
  /** Each watched window's "try it again now" (Screens' Try again, Session 23). */
  private readonly retries = new Map<WatchTarget, (why: string) => void>();

  constructor(
    private readonly onEvent: (e: WatchdogEvent) => void = () => undefined,
    private readonly timers: Timers = realTimers,
  ) {}

  private record(window: string, kind: WatchdogEventKind, reason?: string): void {
    const e: WatchdogEvent = { window, kind, at: this.timers.now(), ...(reason ? { reason } : {}) };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    this.onEvent(e);
  }

  /**
   * A window's page failed as it drew, and said so (Session 23): its process is healthy, so nothing
   * else would notice. It is reloaded through the same reload a crash gets, once: again only after a
   * minute, so a page that fails every time it draws is never reloaded over and over (an output
   * shows black meanwhile, and tries again with each change).
   */
  renderError(target: WatchTarget, name: string, reason: string): void {
    this.record(name, 'render-error', reason);
    const now = this.timers.now();
    const last = this.renderReloads.get(name);
    if (last !== undefined && now - last < 60_000) return;
    this.renderReloads.set(name, now);
    this.timers.setTimeout(() => {
      if (target.isDestroyed()) return;
      target.reload();
      this.record(name, 'reloaded');
    }, 100);
  }

  /**
   * A window judged stuck from outside (an output whose heartbeat stopped, Session 23): it is
   * crashed, and the crash path reloads it, as a hang Chromium noticed would be.
   */
  stuck(target: WatchTarget, name: string, reason: string): void {
    this.record(name, 'hung', reason);
    if (!target.isDestroyed()) target.forcefullyCrashRenderer();
  }

  /** Try a window again now (after it was given up on): false when it is not watched. */
  retryNow(target: WatchTarget, why = 'asked to'): boolean {
    const retry = this.retries.get(target);
    if (!retry) return false;
    retry(why);
    return true;
  }

  watch(target: WatchTarget, name: string, options: WatchdogOptions = {}): void {
    const hangMs = options.hangMs ?? 5000;
    const maxCrashes = options.maxCrashesPerMinute ?? 5;
    const backoff = options.backoffMs ?? [100, 1000, 2000, 5000];
    const crashes: number[] = [];
    let hangTimer: unknown = null;
    let reloadTimer: unknown = null;
    let retryTimer: unknown = null;
    let gaveUp = false;
    /** How many times it was given up on: the first is tried again sooner. */
    let gaveUpTimes = 0;

    // Given up on: tried again, its crash count starting afresh (Session 23).
    const retry = (why: string) => {
      if (retryTimer !== null) this.timers.clearTimeout(retryTimer);
      retryTimer = null;
      if (target.isDestroyed()) return;
      crashes.length = 0;
      gaveUp = false;
      target.reload();
      this.record(name, 'retried', why);
    };
    this.retries.set(target, retry);

    const cancelHang = () => {
      if (hangTimer !== null) this.timers.clearTimeout(hangTimer);
      hangTimer = null;
    };

    target.on('render-process-gone', (_event, details) => {
      cancelHang();
      if (details.reason === 'clean-exit' || target.isDestroyed()) return;
      this.record(name, 'crashed', details.reason);
      const now = this.timers.now();
      crashes.push(now);
      while (crashes.length > 0 && now - (crashes[0] ?? now) > 60_000) crashes.shift();
      if (crashes.length > maxCrashes) {
        if (!gaveUp) {
          this.record(name, 'gave-up', `${crashes.length} crashes in a minute`);
          // No reload meanwhile (one was still waiting from the crash before): only the retry.
          if (reloadTimer !== null) this.timers.clearTimeout(reloadTimer);
          reloadTimer = null;
          gaveUpTimes++;
          const wait = gaveUpTimes === 1 ? RETRY_FIRST_MS : RETRY_AGAIN_MS;
          retryTimer = this.timers.setTimeout(() => {
            retry(`${Math.round(wait / 60_000)} minutes after giving up`);
          }, wait);
        }
        gaveUp = true;
        return;
      }
      const wait = backoff[Math.min(crashes.length - 1, backoff.length - 1)] ?? 1000;
      if (reloadTimer !== null) this.timers.clearTimeout(reloadTimer);
      reloadTimer = this.timers.setTimeout(() => {
        reloadTimer = null;
        if (target.isDestroyed()) return;
        target.reload();
        this.record(name, 'reloaded');
      }, wait);
    });

    target.on('unresponsive', () => {
      this.record(name, 'unresponsive');
      cancelHang();
      hangTimer = this.timers.setTimeout(() => {
        hangTimer = null;
        if (target.isDestroyed()) return;
        this.record(name, 'hung', `unresponsive for ${hangMs} ms`);
        // Crashing it hands over to the crash path above, which reloads it.
        target.forcefullyCrashRenderer();
      }, hangMs);
    });

    target.on('responsive', () => {
      if (hangTimer !== null) this.record(name, 'responsive');
      cancelHang();
    });

    target.on('destroyed', () => {
      cancelHang();
      if (reloadTimer !== null) this.timers.clearTimeout(reloadTimer);
      if (retryTimer !== null) this.timers.clearTimeout(retryTimer);
      this.retries.delete(target);
    });
  }
}

/**
 * Should closing the operator window ask first? Only while screens are showing something, or (since
 * Session 23) the stream is on air or recording.
 */
export function shouldConfirmQuit(
  outputsShowing: number,
  alreadyConfirmed: boolean,
  disabled: boolean,
  streamInUse = false,
): boolean {
  return !disabled && !alreadyConfirmed && (outputsShowing > 0 || streamInUse);
}

/** "1 screen is showing", "3 screens are showing". */
const screensShowing = (n: number) => `${plural(n, 'screen')} ${n === 1 ? 'is' : 'are'} showing`;

const andList = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;

/** What the quit question says: the screens showing, and the stream on air or recording (Session 23). */
export function quitDetail(showing: number, stream: { live: boolean; recording: boolean }): string {
  if (!stream.live && !stream.recording)
    return `${screensShowing(showing)}. If Drashti quits, ${showing === 1 ? 'it goes' : 'they go'} black.`;
  const doing = stream.live
    ? `the stream is ${stream.recording ? 'on air and recording' : 'on air'}`
    : 'Drashti is recording';
  const said = showing > 0 ? `${screensShowing(showing)}, and ${doing}` : doing;
  const ends = [
    ...(showing > 0 ? ['the screens go black'] : []),
    ...(stream.live ? ['the stream ends'] : []),
    ...(stream.recording ? ['the recording stops'] : []),
  ];
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}. If Drashti quits, ${andList(ends)}.`;
}
