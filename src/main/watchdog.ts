/** The parts of Electron's WebContents the watchdog needs (easy to fake in tests). */
export interface WatchTarget {
  on(event: 'render-process-gone', listener: (event: unknown, details: { reason: string }) => void): unknown;
  on(event: 'unresponsive' | 'responsive' | 'destroyed', listener: () => void): unknown;
  reload(): void;
  forcefullyCrashRenderer(): void;
  isDestroyed(): boolean;
}

export type WatchdogEventKind = 'crashed' | 'reloaded' | 'unresponsive' | 'responsive' | 'hung' | 'gave-up';

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

  watch(target: WatchTarget, name: string, options: WatchdogOptions = {}): void {
    const hangMs = options.hangMs ?? 5000;
    const maxCrashes = options.maxCrashesPerMinute ?? 5;
    const backoff = options.backoffMs ?? [100, 1000, 2000, 5000];
    const crashes: number[] = [];
    let hangTimer: unknown = null;
    let reloadTimer: unknown = null;
    let gaveUp = false;

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
        if (!gaveUp) this.record(name, 'gave-up', `${crashes.length} crashes in a minute`);
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
    });
  }
}

/** Should closing the operator window ask first? Only while screens are showing something. */
export function shouldConfirmQuit(
  outputsShowing: number,
  alreadyConfirmed: boolean,
  disabled: boolean,
): boolean {
  return !disabled && !alreadyConfirmed && outputsShowing > 0;
}
