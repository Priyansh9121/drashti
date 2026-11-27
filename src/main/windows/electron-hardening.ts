import type { App } from 'electron';
import { applySessionSecurity } from './security';

/** Install fail-closed defaults before any page or session is created. */
export function installElectronHardening(app: Pick<App, 'on'>): void {
  app.on('session-created', (session) => {
    applySessionSecurity(session);
    session.setDevicePermissionHandler(() => false);
    session.setDisplayMediaRequestHandler((_request, callback) => { callback({}); });
  });
}
