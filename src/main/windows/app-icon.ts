import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/*
 * Drashti's icon on its own windows (Session 19). On Windows the taskbar and Alt+Tab show each window's
 * icon: build/icon.ico, which electron-builder.yml copies into the installed app's resources folder. A Mac
 * shows the app's icon (build/icon.icns, inside Drashti.app) for every window, so there it needs none.
 */

export interface IconPlace {
  platform: NodeJS.Platform;
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
}

/** Where a window's icon is on this computer, or undefined where windows show the app's own. */
export function windowIconPath(p: IconPlace): string | undefined {
  if (p.platform !== 'win32') return undefined;
  return p.packaged ? join(p.resourcesPath, 'icon.ico') : join(p.appPath, 'build', 'icon.ico');
}

/** The `icon` option for a window that can show in the taskbar. */
export function windowIcon(): { icon?: string } {
  const file = windowIconPath({
    platform: process.platform,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  return file && existsSync(file) ? { icon: file } : {};
}
