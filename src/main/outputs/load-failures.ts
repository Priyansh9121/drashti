import type { BrowserWindow } from 'electron';
import type { RendererWatchdog } from '../watchdog';
import { loadPage } from '../windows/renderer';

/*
 * An output whose page fails to load, or whose preload fails (Session 31, ROB-7): its process is healthy,
 * so neither a crash nor a hang would ever be seen, and the screen stayed black until its heartbeat went
 * stale. Now the log says so at once, and it is treated as a render error (the watchdog's reload, at most
 * once a minute), loading the output's own page again rather than the address that failed.
 */

export function watchLoadFailures(
  window: BrowserWindow,
  o: { name: string; screen: string; watchdog: RendererWatchdog; log(message: string): void },
): void {
  const loadOwnPage = () => {
    if (!window.isDestroyed()) void loadPage(window, 'output', { screen: o.screen });
  };
  const said = `${o.name.charAt(0).toUpperCase()}${o.name.slice(1)}`;
  window.webContents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    // ERR_ABORTED (-3) is a load replaced by another (a reload); a frame inside the page is not the page.
    if (!isMainFrame || code === -3) return;
    o.log(`${said}: its page failed to load (${String(code)} ${description})`);
    o.watchdog.renderError(
      window.webContents,
      o.name,
      `its page failed to load (${description})`,
      loadOwnPage,
    );
  });
  window.webContents.on('preload-error', (_e, _path, error) => {
    o.log(`${said}: its preload failed (${error.message})`);
    o.watchdog.renderError(window.webContents, o.name, 'its preload failed', loadOwnPage);
  });
}
