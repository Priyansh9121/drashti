import { clockHeld, engineNow } from './clock';

/**
 * The browser task scheduler, for a cue's Go check on every page and LIVE's other future starts (render/playback.ts);
 * any other later start (a deck's clip) keeps its ordinary timer.
 */
interface GoScheduler {
  postTask(
    run: () => void,
    options: { delay: number; priority: 'user-blocking'; signal: AbortSignal },
  ): Promise<unknown>;
}

/**
 * How long before a cue's Go a visible page is checked as well, and held until Go (goearly, alpha.24): on CI's Mac a page
 * busy at Go set its cued picture's rate 22-138 ms late, its Go check, a task due at Go, waiting behind the task in hand
 * (every one of them begun after Go-25: N/reports/a24-bgblack-crossfade303.md). Held from here, nothing begun in the last
 * 25 ms comes before the start. Also the longest that hold may last.
 */
export const GO_EARLY_MS = 25;

/** What the early check reads of its page: its clocks, whether it is seen, and the one Go it has held for. */
export interface GoHoldPage {
  /** The engine's time (render/clock.ts): Go comes by it. */
  now(): number;
  /** The page's own steady clock: how long the hold has lasted. */
  realNow(): number;
  /** Whether the page is on a screen: a hidden one is never held. */
  visible(): boolean;
  /** Whether the clock stands still (a test's hold, the warm-up's pause): it would never reach Go. */
  held(): boolean;
  /** The Go it last held for: a page is held once for a Go, whatever plays it. */
  lastGo: number | null;
}

/** This page. */
export const GO_HOLD_PAGE: GoHoldPage = {
  now: engineNow,
  // eslint-disable-next-line no-restricted-properties -- how long the hold has lasted, a length of time, never the time
  realNow: () => performance.now(),
  visible: () => typeof document !== 'undefined' && document.visibilityState === 'visible',
  held: clockHeld,
  lastGo: null,
};

/**
 * Hold the page until the engine's time reaches `goAt`, GO_EARLY_MS at most by its own clock. Whether Go came: if not
 * (the engine's clock moved meanwhile), the Go check due at Go does the start.
 */
function holdUntil(goAt: number, page: GoHoldPage): boolean {
  const from = page.realNow();
  while (page.now() < goAt) if (page.realNow() - from >= GO_EARLY_MS) return false;
  return true;
}

/**
 * Ask for a clock check, never decide playback from a timer or task’s own clock. For a cue's Go (`goAt`, its engine
 * time) on a visible page, a check GO_EARLY_MS before it too: run with Go that close, it holds the page until Go and
 * runs the check there, once for that Go on this page; the check due at Go is then dropped. Otherwise (the page hidden,
 * the clock held, Go further off, already held for that Go, or the hold ended before Go) the check at Go does it.
 */
export function scheduleGoCheck(
  run: () => void,
  delay: number,
  priority: boolean,
  goAt?: number,
  page: GoHoldPage = GO_HOLD_PAGE,
): () => void {
  const scheduler = (globalThis as unknown as { scheduler?: GoScheduler }).scheduler;
  if (priority && scheduler) {
    const controller = new AbortController();
    const signal = controller.signal;
    void scheduler.postTask(run, { delay, priority: 'user-blocking', signal }).catch(() => undefined);
    if (goAt !== undefined && page.visible()) {
      const early = () => {
        if (!page.visible() || page.held()) return;
        const left = goAt - page.now();
        if (left > GO_EARLY_MS) return;
        if (left > 0) {
          if (page.lastGo === goAt) return;
          page.lastGo = goAt;
          if (!holdUntil(goAt, page)) return;
        }
        controller.abort();
        run();
      };
      void scheduler
        .postTask(early, { delay: Math.max(0, delay - GO_EARLY_MS), priority: 'user-blocking', signal })
        .catch(() => undefined);
    }
    return () => controller.abort();
  }
  // eslint-disable-next-line no-restricted-syntax -- asks playback to check the shared clock at its scheduled start
  const timer = setTimeout(run, delay);
  return () => clearTimeout(timer);
}
