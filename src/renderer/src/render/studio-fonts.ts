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

/** Every face of the studio's fonts, asked for once (its later calls do nothing), in Drashti's own windows only. */
export function preloadStudioFonts(): void {
  if (started || !ownWindow() || typeof document === 'undefined') return;
  started = true;
  for (const choice of LOWER_THIRD_FONT_CHOICES)
    if (choice.bundled === 'studio')
      for (const family of choice.families)
        for (const weight of choice.weights)
          void document.fonts.load(`${String(weight)} 48px "${family}"`, FONT_SAMPLE).catch(() => undefined);
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
