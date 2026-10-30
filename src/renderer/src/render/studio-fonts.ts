import { FONT_SAMPLE, LOWER_THIRD_FONT_CHOICES } from '../../../shared/lower-third-fonts';

/*
 * The Lower Thirds studio's fonts (Session 55, Part 16; render/studio-fonts.css), loaded soon after one of Drashti's
 * own windows opens (after its own Noto fonts: render/fonts.ts preloadFonts), so a lower third in one of them draws
 * in it from its first frame. Unwaited for: nothing waits on them. Pages on phones and browsers (served over the
 * network) load each only when their words need it.
 */

let started = false;

/** Whether this page is one of Drashti's own windows (read from the app's files), not a phone's page. */
const ownWindow = (): boolean => location.protocol === 'file:';

export function preloadStudioFonts(): void {
  if (started || !ownWindow() || typeof document === 'undefined') return;
  started = true;
  for (const choice of LOWER_THIRD_FONT_CHOICES)
    if (choice.bundled === 'studio')
      for (const family of choice.families)
        for (const weight of choice.weights)
          void document.fonts.load(`${String(weight)} 48px "${family}"`, FONT_SAMPLE).catch(() => undefined);
}
