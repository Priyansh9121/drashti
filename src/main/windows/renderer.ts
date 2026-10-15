import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';

export type RendererPage = 'index' | 'output' | 'audio' | 'gallery' | 'stream' | 'node' | 'pdf' | 'sharpen';

export const rendererDir = (): string => join(__dirname, '../renderer');
export const devServerUrl = (): string | undefined =>
  app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];

/** Tests only: pages keep the GPU's warm-up drawn, to be looked at (Session 27). Never when packaged. */
const holdWarmUp = (): boolean => !app.isPackaged && process.env['DRASHTI_TEST_HOLD_WARM_UP'] === '1';

/** Load one of our HTML pages into a window, from Vite in dev or from disk. */
export function loadPage(
  win: BrowserWindow,
  page: RendererPage,
  given: Record<string, string> = {},
): Promise<void> {
  const query = holdWarmUp() ? { ...given, warmUp: 'hold' } : given;
  const dev = devServerUrl();
  if (dev) {
    const url = new URL(`${page}.html`, dev.endsWith('/') ? dev : dev + '/');
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return win.loadURL(url.toString());
  }
  return win.loadFile(join(rendererDir(), `${page}.html`), { query });
}
