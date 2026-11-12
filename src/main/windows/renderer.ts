import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { packaged, sw } from '../switches';

export type RendererPage =
  | 'index'
  | 'output'
  | 'audio'
  | 'gallery'
  | 'stream'
  | 'node'
  | 'pdf'
  | 'pdf-export'
  | 'sharpen'
  | 'zoom'
  | 'lock'
  | 'access-list'
  | 'lower-thirds'
  | 'slide-editor';

export const rendererDir = (): string => join(__dirname, '../renderer');
export const devServerUrl = (): string | undefined =>
  packaged() ? undefined : process.env['ELECTRON_RENDERER_URL'];

/** Tests only: pages keep the GPU's warm-up drawn, to be looked at (Session 27). Never when packaged. */
const holdWarmUp = (): boolean => !packaged() && sw('DRASHTI_TEST_HOLD_WARM_UP') === '1';
/** Tests only: pages draw the show at once, as translated (Session 55: the opening's test of screens drawn). */
const skipWarmUp = (): boolean => !packaged() && sw('DRASHTI_TEST_SKIP_WARM_UP') === '1';
/** Tests only: the audience screens and the operator window keep the motion probe's record (Session 57, item 6). */
const motionProbe = (): boolean => !packaged() && sw('DRASHTI_TEST_MOTION_PROBE') === '1';

/**
 * Run translated (an Intel build under Rosetta on an Apple-silicon Mac, x64 under Windows' emulation): pages
 * draw the show at once, without warming their GPU up (Session 27). There the warm-up's drawing kept a screen
 * busy for seconds at a time (the release's Intel check under Rosetta reloaded its output again and again).
 */
const translated = (): boolean => app.runningUnderARM64Translation;

/** Load one of our HTML pages into a window, from Vite in dev or from disk. */
export function loadPage(
  win: BrowserWindow,
  page: RendererPage,
  given: Record<string, string> = {},
): Promise<void> {
  const warm = holdWarmUp()
    ? { ...given, warmUp: 'hold' }
    : translated() || skipWarmUp()
      ? { ...given, warmUp: 'skip' }
      : given;
  const query = motionProbe() ? { ...warm, motionProbe: '1' } : warm;
  const dev = devServerUrl();
  if (dev) {
    const url = new URL(`${page}.html`, dev.endsWith('/') ? dev : dev + '/');
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return win.loadURL(url.toString());
  }
  return win.loadFile(join(rendererDir(), `${page}.html`), { query });
}
