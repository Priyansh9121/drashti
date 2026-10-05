import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/*
 * Installing a downloaded update (Session 14), only when Drashti quits and
 * only with an admin's say-so (update-service.ts decides when):
 *
 * - Windows: the NSIS installer runs silently (/S) once Drashti has quit,
 *   over the same per-user install, and does not start Drashti again.
 * - A Mac signed with a Developer ID: the zip is handed to Squirrel.Mac
 *   (Electron's autoUpdater) through a feed on this computer only; Squirrel
 *   checks it is signed by the same developer as the app running, and
 *   installs it as Drashti quits, without restarting it.
 * - An unsigned Mac (Squirrel.Mac refuses an app with no signature): the
 *   file is kept and shown, to install by hand after quitting.
 */

export interface Installer {
  mode: 'at-quit' | 'by-hand';
  /** Get it ready to install when Drashti quits (a Mac: Squirrel.Mac takes it now). */
  prepare(file: string, version: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Drashti is quitting, and an admin said to install: start it (Windows: the installer). */
  atQuit(file: string): void;
}

export function windowsInstaller(): Installer {
  return {
    mode: 'at-quit',
    prepare: () => Promise.resolve({ ok: true }),
    atQuit: (file) => {
      // Silent, as an update; no --force-run, so Drashti is not started again by it.
      spawn(file, ['--updated', '/S'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    },
  };
}

/** Whether the running Mac app is signed with a Developer ID (an ad-hoc or no signature is not). */
export function signedWithDeveloperId(appBundle: string): boolean {
  const out = spawnSync('codesign', ['-dv', '--verbose=2', appBundle], { encoding: 'utf8', timeout: 5000 });
  return `${out.stderr}${out.stdout}`.includes('Authority=Developer ID Application');
}

/** The bits of Electron's autoUpdater Squirrel.Mac needs. */
export interface SquirrelUpdater {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  on(event: 'update-downloaded' | 'error', listener: (...args: unknown[]) => void): unknown;
  removeAllListeners(event: 'update-downloaded' | 'error'): unknown;
}

export function macInstaller(isSigned: () => boolean, updater: SquirrelUpdater): Installer {
  let feed: Server | null = null;
  // Asked once, when first needed (codesign takes a moment).
  let signedAnswer: boolean | null = null;
  const signed = () => (signedAnswer ??= isSigned());
  return {
    get mode() {
      return signed() ? ('at-quit' as const) : ('by-hand' as const);
    },
    prepare: async (file, version) => {
      if (!signed())
        return {
          ok: false,
          message:
            'This copy of Drashti is not signed, so a Mac cannot install the update by itself: quit Drashti, open the downloaded file and drag Drashti into Applications.',
        };
      // Squirrel.Mac reads a feed: one that points at the checked file, on this computer only.
      feed?.close();
      const server = createServer((req, res) => {
        const port = (server.address() as AddressInfo).port;
        if (req.url === '/feed') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ url: `http://127.0.0.1:${String(port)}/update.zip`, name: version }));
        } else if (req.url === '/update.zip') {
          res.writeHead(200, { 'content-type': 'application/zip', 'content-length': statSync(file).size });
          createReadStream(file).pipe(res);
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      feed = server;
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      const port = (server.address() as AddressInfo).port;
      return new Promise((resolve) => {
        updater.removeAllListeners('update-downloaded');
        updater.removeAllListeners('error');
        updater.on('update-downloaded', () => {
          resolve({ ok: true });
        });
        updater.on('error', (error: unknown) => {
          resolve({
            ok: false,
            message: `The Mac would not take the update (${error instanceof Error ? error.message : 'unknown'}).`,
          });
        });
        updater.setFeedURL({ url: `http://127.0.0.1:${String(port)}/feed` });
        updater.checkForUpdates();
      });
    },
    // Squirrel.Mac installs it as Drashti quits, by itself.
    atQuit: () => undefined,
  };
}

/** The installer for this computer: Windows, a Mac (signed or not), or the tests' stand-in. */
export function defaultInstaller(o: {
  platform: string;
  isPackaged: boolean;
  execPath: string;
  testLog: string | undefined;
  updater: SquirrelUpdater;
}): Installer {
  if (o.testLog) return testInstaller(o.testLog, o.platform);
  if (o.platform === 'win32') return windowsInstaller();
  // The running app's bundle: Drashti.app/Contents/MacOS/Drashti, three folders up.
  return macInstaller(
    () => o.isPackaged && signedWithDeveloperId(join(o.execPath, '..', '..', '..')),
    o.updater,
  );
}

/**
 * Tests only (DRASHTI_TEST_UPDATE_INSTALL): installs at quit as Windows does,
 * but writes what it would run into a file instead of running anything.
 */
export function testInstaller(log: string, platform: string): Installer {
  return {
    mode: 'at-quit',
    prepare: () => Promise.resolve({ ok: true }),
    atQuit: (file) => {
      const args = platform === 'win32' ? ['--updated', '/S'] : ['(Squirrel.Mac)'];
      writeFileSync(log, `${JSON.stringify({ file, args, at: new Date().toISOString() })}\n`);
    },
  };
}
