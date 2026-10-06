import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';

export type RendererPage = 'index' | 'output' | 'audio' | 'gallery' | 'stream' | 'node' | 'pdf';

export const rendererDir = (): string => join(__dirname, '../renderer');
export const devServerUrl = (): string | undefined =>
  app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];

/** Load one of our HTML pages into a window, from Vite in dev or from disk. */
export function loadPage(
  win: BrowserWindow,
  page: RendererPage,
  query: Record<string, string> = {},
): Promise<void> {
  const dev = devServerUrl();
  if (dev) {
    const url = new URL(`${page}.html`, dev.endsWith('/') ? dev : dev + '/');
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return win.loadURL(url.toString());
  }
  return win.loadFile(join(rendererDir(), `${page}.html`), { query });
}
