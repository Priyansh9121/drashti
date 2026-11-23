import { FONT_SAMPLE, LOWER_THIRD_FONT_CHOICES } from '../../../shared/lower-third-fonts';

/*
 * The Lower Thirds studio's fonts (Session 55, Part 16; render/studio-fonts.css), loaded by each of Drashti's own
 * windows once it has drawn what it opened to draw (an output and the stream's page their show, the operator window
 * its LIVE picture; the studio at once), so a lower third in one of them draws in it from its first frame.
 * Unwaited for: nothing waits on them. Never with a page's start: 50 faces loading with an output's own start kept
 * its show from its screen longer (the Performance check of 30 Oct 2026, PERF-1). Pages on phones and browsers
 * (served over the network) load each only when their words need it.
 */

let started = false;

/** Whether this page is one of Drashti's own windows (read from the app's files), not a phone's page. */
const ownWindow = (): boolean => location.protocol === 'file:';

/** How long a face waits for an idle moment at most, on a page that is never idle (an output drawing a busy show). */
const IDLE_WAIT_MS = 200;

/** `next` once the page is idle, or after IDLE_WAIT_MS at most. */
function whenIdle(next: () => void): void {
  if (typeof requestIdleCallback === 'function')
    // eslint-disable-next-line no-restricted-syntax -- only paces asking for unwaited-for fonts: nothing drawn waits on it
    requestIdleCallback(next, { timeout: IDLE_WAIT_MS });
  // eslint-disable-next-line no-restricted-syntax -- the same, where there is no idle callback (a unit test)
  else setTimeout(next, 0);
}

/**
 * Every face of the studio's fonts, asked for once (its later calls do nothing), in Drashti's own windows only: one
 * face at a time, the next once the last has come (or could not be read) and the page is idle. Asked for all at once,
 * their loads took the page's main thread for ~0.4 s on CI's Mac (a21: in the operator window just after its first
 * show, so a live Next waited 306 ms behind them; source-preparation-responsiveness.spec.ts:101); one at a time,
 * anything the page must do waits for one face at most.
 */
export function preloadStudioFonts(): void {
  if (started || !ownWindow() || typeof document === 'undefined') return;
  started = true;
  const faces: string[] = [];
  for (const choice of LOWER_THIRD_FONT_CHOICES)
    if (choice.bundled === 'studio')
      for (const family of choice.families)
        for (const weight of choice.weights) faces.push(`${String(weight)} 48px "${family}"`);
  const ask = (at: number): void => {
    const face = faces[at];
    if (face === undefined) return;
    const next = () => {
      whenIdle(() => {
        ask(at + 1);
      });
    };
    document.fonts.load(face, FONT_SAMPLE).then(next, next);
  };
  whenIdle(() => {
    ask(0);
  });
}

/**
 * The studio's fonts once this page has drawn the frame it is drawing now: two frames on, so they never share the
 * work of its first drawing. For an effect: its cancel, should the page go before.
 */
export function preloadStudioFontsOnceDrawn(): () => void {
  let next = 0;
  const first = requestAnimationFrame(() => {
    next = requestAnimationFrame(() => {
      preloadStudioFonts();
    });
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(next);
  };
}
