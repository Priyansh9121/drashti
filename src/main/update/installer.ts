import { execFile, spawn, spawnSync } from 'node:child_process';
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/*
 * Installing a downloaded update (Session 14), only when Drashti quits and
 * only with an admin's say-so (update-service.ts decides when):
 *
 * - Windows: the NSIS installer runs silently (/S) once Drashti has quit,
 *   over the same per-user install, and does not start Drashti again. When
 *   the Drashti running is signed, the installer must be signed (Authenticode,
 *   valid) by the same publisher, or it is refused: checked when an admin
 *   says to install, and again just before it runs. An unsigned Drashti
 *   takes the checked file as it is (its sha512 is from the release).
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
  /** Drashti is quitting, and an admin said to install: start it (Windows: the installer), unless refused. */
  atQuit(file: string): { ok: true } | { ok: false; message: string };
}

/** A file's Authenticode signature as Windows sees it: valid or not, and who signed it. */
export interface Authenticode {
  valid: boolean;
  /** The signing certificate's subject ("CN=…, O=…, C=…"), or null when there is none. */
  subject: string | null;
  /** Windows' word for it (Valid, NotSigned, HashMismatch, …), or "unreadable" when it could not be asked. */
  status: string;
}

/** Reading signatures: in the background (when an admin says to install) or at once (at quit). */
export interface SignatureReader {
  read(file: string): Promise<Authenticode>;
  readSync(file: string): Authenticode;
}

/** A certificate subject's parts, by name (CN, O, …); quoted values are unquoted. */
function subjectParts(subject: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const m of subject.matchAll(/(?:^|,)\s*([A-Za-z0-9.]+)=("(?:[^"]|"")*"|[^,]*)/g)) {
    const raw = (m[2] ?? '').trim();
    const value = raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw;
    parts.set((m[1] ?? '').toUpperCase(), value.trim());
  }
  return parts;
}

/** Whether two signatures are the same publisher: the same name (CN) and organisation (O), whichever certificate. */
export function samePublisher(a: string, b: string): boolean {
  const [pa, pb] = [subjectParts(a), subjectParts(b)];
  const cn = pa.get('CN');
  return cn !== undefined && cn !== '' && cn === pb.get('CN') && pa.get('O') === pb.get('O');
}

/** Whether an installer may run, given the running Drashti's signature (null: unsigned, or not packaged). */
export function installerAllowed(
  own: Authenticode | null,
  theirs: Authenticode,
): { ok: true } | { ok: false; message: string } {
  if (!own?.valid || !own.subject) return { ok: true };
  if (!theirs.valid || !theirs.subject)
    return {
      ok: false,
      message: `The downloaded update has no valid signature (Windows says: ${theirs.status}), so Drashti will not install it. Download Drashti again from its releases page, or ask whoever looks after this computer.`,
    };
  if (!samePublisher(own.subject, theirs.subject))
    return {
      ok: false,
      message: `The downloaded update is signed by someone else (${subjectParts(theirs.subject).get('CN') ?? 'unknown'}), not by Drashti's publisher, so Drashti will not install it.`,
    };
  return { ok: true };
}

const SIGNATURE_SCRIPT =
  '$s = Get-AuthenticodeSignature -LiteralPath $env:DRASHTI_SIGNED_FILE; ' +
  '[pscustomobject]@{ status = [string]$s.Status; subject = $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null }) } | ConvertTo-Json -Compress';
const POWERSHELL_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  SIGNATURE_SCRIPT,
];

/** Windows PowerShell itself, by its full path (never one found on PATH). */
function powershell(): string {
  return join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

/**
 * Its environment: this one with the file to check, without PSModulePath (started from
 * PowerShell 7, Windows PowerShell would load 7's modules and fail to check anything).
 */
function powershellEnv(file: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { DRASHTI_SIGNED_FILE: file };
  for (const [key, value] of Object.entries(process.env))
    if (key.toUpperCase() !== 'PSMODULEPATH' && key !== 'DRASHTI_SIGNED_FILE') env[key] = value;
  return env;
}

function parseSignature(stdout: string): Authenticode {
  try {
    const r = JSON.parse(stdout) as { status?: unknown; subject?: unknown };
    const status = typeof r.status === 'string' && r.status !== '' ? r.status : 'unreadable';
    return { valid: status === 'Valid', subject: typeof r.subject === 'string' ? r.subject : null, status };
  } catch {
    return { valid: false, subject: null, status: 'unreadable' };
  }
}

/** Windows' own check of a file's signature (PowerShell's Get-AuthenticodeSignature). */
export const windowsSignatures: SignatureReader = {
  read: (file) =>
    new Promise((resolve) => {
      execFile(
        powershell(),
        POWERSHELL_ARGS,
        { timeout: 30_000, windowsHide: true, env: powershellEnv(file) },
        (_error, stdout) => {
          resolve(parseSignature(stdout));
        },
      );
    }),
  readSync: (file) =>
    parseSignature(
      spawnSync(powershell(), POWERSHELL_ARGS, {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
        env: powershellEnv(file),
      }).stdout,
    ),
};

export function windowsInstaller(o: {
  /** The running Drashti's own file, or null when it is not packaged (treated as unsigned). */
  self: string | null;
  signatures: SignatureReader;
  run?: (file: string) => void;
}): Installer {
  // Asked once, when first needed.
  let own: Authenticode | null | undefined;
  const run =
    o.run ??
    ((file: string) => {
      // Silent, as an update; no --force-run, so Drashti is not started again by it.
      spawn(file, ['--updated', '/S'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    });
  return {
    mode: 'at-quit',
    prepare: async (file) => {
      own ??= o.self === null ? null : await o.signatures.read(o.self);
      if (!own?.valid) return { ok: true };
      return installerAllowed(own, await o.signatures.read(file));
    },
    atQuit: (file) => {
      own ??= o.self === null ? null : o.signatures.readSync(o.self);
      const allowed = own?.valid ? installerAllowed(own, o.signatures.readSync(file)) : { ok: true as const };
      if (allowed.ok) run(file);
      return allowed;
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
    atQuit: () => ({ ok: true }),
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
  if (o.platform === 'win32')
    return windowsInstaller({ self: o.isPackaged ? o.execPath : null, signatures: windowsSignatures });
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
      return { ok: true };
    },
  };
}
