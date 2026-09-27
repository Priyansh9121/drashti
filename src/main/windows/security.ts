import { type Session, type WebContents } from 'electron';
import { isAppUrl } from './navigation';
import { rendererDir, devServerUrl } from './renderer';

/** Deny every permission (camera, notifications, ...) to every page. */
export function applySessionSecurity(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
}

/** No pop-ups, no <webview>, and no navigating away from our own pages. */
export function secureWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, { devServerUrl: devServerUrl(), rendererDir: rendererDir() })) event.preventDefault();
  });
}
