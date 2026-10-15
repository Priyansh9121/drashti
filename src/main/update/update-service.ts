import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { UpdateFile, UpdateManifest, UpdateResult, UpdateView } from '../../shared/updates';
import {
  compareVersions,
  fileUrlAllowed,
  MANIFEST_MAX_BYTES,
  manifestUrl,
  updateManifestSchema,
} from '../../shared/updates';
import { RateGate } from '../rate-gate';
import { downloadFile, DownloadStopped, sha512Of } from './download';
import type { Installer } from './installer';

/*
 * Updates as the main process (or a node) runs them (shared/updates.ts).
 * Nothing happens by itself but a look once a day, when an admin allowed
 * it: an admin checks, downloads (at a limited speed, waiting while the
 * stream is on air or recording) and says to install when Drashti quits.
 * The installer starts only then, and Drashti never starts itself again.
 * Files live in Updates/ in the data folder; pending.json says what to
 * install at the next quit, so a crash in between keeps the admin's say-so.
 */

const PENDING = 'pending.json';
const DAY_MS = 24 * 3600 * 1000;
const pendingSchema = z.object({
  version: z.string(),
  file: z.string(),
  sha512: z.string(),
  /** A node matching its Main's version (Session 30): only then is an older one installed. */
  matchMain: z.boolean().optional(),
});
const SHA512 = /^[A-Za-z0-9+/]{86}==$/u;

/** A file's size, time and identity, as checked: one changed since is refused at quit. */
interface Checked {
  file: string;
  size: number;
  mtimeMs: number;
  ino: number;
}

/** The same file as checked: its size, time and identity unchanged. */
const sameAs = (a: Checked | null, b: Checked | null): boolean =>
  a !== null &&
  b !== null &&
  a.file === b.file &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ino === b.ino;

const checkedNow = (file: string): Checked | null => {
  try {
    const s = statSync(file);
    return { file, size: s.size, mtimeMs: s.mtimeMs, ino: s.ino };
  } catch {
    return null;
  }
};

/** The answer's body as text, refused past `max` bytes (Session 30: a manifest is small). */
async function textUpTo(response: Response, max: number): Promise<string | null> {
  const told = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(told) && told > max) return null;
  const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface UpdateDeps {
  current: string;
  platform: string;
  arch: string;
  /** Where releases are (UPDATE_BASE; the tests' own server in tests). */
  base: string;
  /** The Updates folder in the data folder. */
  dir: string;
  fetch: (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
  installer: Installer;
  /** The stream is on air or recording: downloads wait. */
  onAir(): boolean;
  /** Whether an admin allowed a look once a day, and keeping that (null on a node: never). */
  autoCheck: { get(): boolean; set(on: boolean): void } | null;
  now(): number;
  changed(view: UpdateView): void;
  log(level: 'info' | 'warn', message: string): void;
  /** The download speed (4 MB/s unless a test says). */
  bytesPerSecond?: number;
  /** A packaged Drashti: an update's files come from GitHub only (Session 30). */
  packaged: boolean;
}

export class UpdateService {
  private phase: UpdateView['phase'] = 'idle';
  private manifest: UpdateManifest | null = null;
  private progress: { done: number; total: number } | null = null;
  private waitingFor: string | null = null;
  private message: string | null = null;
  private checkedAt: number | null = null;
  private installOnQuit = false;
  private downloaded: string | null = null;
  private cancelled = false;
  private holdThisQuit = false;
  private dailyTimer: NodeJS.Timeout | null = null;
  private lastSent = '';
  /** The file to install, as it was when last checked against its SHA-512. */
  private checked: Checked | null = null;
  /** The manifest came from asking for one version (a node matching Main). */
  private askedFor: string | null = null;

  constructor(private readonly deps: UpdateDeps) {
    mkdirSync(deps.dir, { recursive: true });
    const pending = this.readPending();
    if (pending) this.takePending(pending);
    this.scheduleDaily();
  }

  /** On a node (no daily look of its own). */
  private get node(): boolean {
    return this.deps.autoCheck === null;
  }

  /**
   * An admin's say-so from before a restart (or a crash) still stands (Session 30): for a newer version
   * only (an older one only on a node matching its Main), for a file in Updates/ with its SHA-512 that
   * still matches it. The file is checked again in the background (a big installer takes a moment); until
   * then nothing is installed, and a quit meanwhile leaves the say-so for the next one.
   */
  private takePending(p: z.infer<typeof pendingSchema>): void {
    const drop = (why: string | null) => {
      if (why) this.deps.log('warn', `Updates: the update waiting to install was not taken (${why})`);
      rmSync(join(this.deps.dir, PENDING), { force: true });
    };
    const file = resolve(p.file);
    const rel = relative(resolve(this.deps.dir), file);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || !existsSync(file)) {
      drop('its file is not in the Updates folder');
      return;
    }
    const order = compareVersions(p.version, this.deps.current);
    if (order === 0) {
      // Installed: done with.
      drop(null);
      return;
    }
    if (order < 0 && !(this.node && p.matchMain === true)) {
      drop(`${p.version} is older than this Drashti`);
      return;
    }
    if (!SHA512.test(p.sha512)) {
      drop('no checksum');
      return;
    }
    void sha512Of(file).then(
      (got) => {
        if (got !== p.sha512) {
          drop('its file changed after it was checked');
          rmSync(file, { force: true });
          return;
        }
        this.checked = checkedNow(file);
        this.installOnQuit = true;
        this.downloaded = file;
        this.askedFor = p.matchMain ? p.version : null;
        this.phase = 'ready';
        this.manifest = {
          app: 'drashti',
          version: p.version,
          releasedAt: '',
          notes: '',
          source: '',
          files: [],
        };
        this.changed();
      },
      () => {
        drop('its file cannot be read');
      },
    );
  }

  private readPending(): z.infer<typeof pendingSchema> | null {
    try {
      return pendingSchema.parse(JSON.parse(readFileSync(join(this.deps.dir, PENDING), 'utf8')));
    } catch {
      return null;
    }
  }

  view(): UpdateView {
    const m = this.manifest;
    const file = m ? this.fileFor(m) : null;
    return {
      current: this.deps.current,
      phase: this.phase,
      offer: m
        ? { version: m.version, notes: m.notes, size: file?.size ?? 0, releasedAt: m.releasedAt }
        : null,
      progress: this.phase === 'downloading' || this.phase === 'waiting' ? this.progress : null,
      waitingFor: this.phase === 'waiting' ? this.waitingFor : null,
      installOnQuit: this.installOnQuit,
      install: this.deps.installer.mode,
      message: this.message,
      checkedAt: this.checkedAt,
      autoCheck: this.deps.autoCheck?.get() ?? false,
    };
  }

  private changed(): void {
    const view = this.view();
    const sent = JSON.stringify(view);
    if (sent === this.lastSent) return;
    this.lastSent = sent;
    this.deps.changed(view);
  }

  private fileFor(m: UpdateManifest): UpdateFile | null {
    const kind = this.deps.platform === 'win32' ? 'nsis' : 'zip';
    return (
      m.files.find(
        (f) => f.platform === this.deps.platform && f.arch === this.deps.arch && f.kind === kind,
      ) ?? null
    );
  }

  private busy(): boolean {
    return this.phase === 'checking' || this.phase === 'downloading' || this.phase === 'waiting';
  }

  /** Look for a newer release (an admin's Check now, or once a day). With `version`, that one (a node matching Main). */
  async check(version: string | null = null): Promise<UpdateResult> {
    if (this.busy()) return { ok: false, message: 'Drashti is already looking at an update.' };
    if (this.installOnQuit && version === null)
      return { ok: false, message: 'An update is waiting to install when Drashti quits.' };
    this.phase = 'checking';
    this.message = null;
    this.changed();
    try {
      const response = await this.deps.fetch(manifestUrl(this.deps.base, version), { headers: {} });
      if (response.status === 404) {
        this.phase = version === null ? 'up-to-date' : 'error';
        this.manifest = null;
        this.message =
          version === null
            ? 'No release has been published yet.'
            : `Drashti ${version} is not published as a release.`;
        return this.answer();
      }
      if (!response.ok) throw new Error(`the server said ${String(response.status)}`);
      const text = await textUpTo(response, MANIFEST_MAX_BYTES);
      if (text === null) throw new Error('its manifest is larger than 64 KB');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('its release notes cannot be read');
      }
      const parsed = updateManifestSchema.safeParse(json);
      if (!parsed.success) throw new Error('its release notes cannot be read');
      const m = parsed.data;
      // A node asking for Main's version takes that version only.
      if (version !== null && m.version !== version)
        throw new Error(`asked for ${version}, the release says ${m.version}`);
      // A packaged Drashti takes its files from GitHub only.
      if (m.files.some((f) => !fileUrlAllowed(f.url, this.deps.packaged)))
        throw new Error('its files are not where releases are');
      this.checkedAt = this.deps.now();
      if (version === null && compareVersions(m.version, this.deps.current) <= 0) {
        this.phase = 'up-to-date';
        this.manifest = null;
        this.deps.log('info', `Updates: up to date (${this.deps.current})`);
        return this.answer();
      }
      if (!this.fileFor(m)) {
        this.phase = 'error';
        this.manifest = null;
        this.message = `Drashti ${m.version} has no installer for this computer (${this.deps.platform} ${this.deps.arch}).`;
        return this.answer();
      }
      this.manifest = m;
      this.askedFor = version;
      this.phase = 'available';
      this.deps.log('info', `Updates: ${m.version} is available (this is ${this.deps.current})`);
      return this.answer();
    } catch (error) {
      this.phase = 'error';
      this.manifest = null;
      this.message =
        'Could not look for updates. Check that this computer is on the internet, then choose Check now again.';
      this.deps.log(
        'warn',
        `Updates: could not look for updates (${error instanceof Error ? error.message : 'no answer'})`,
      );
      return this.answer();
    }
  }

  private answer(): UpdateResult {
    this.changed();
    return { ok: true, view: this.view() };
  }

  /** Download the update offered (an admin), waiting while the stream is on air or recording. */
  download(): UpdateResult {
    const m = this.manifest;
    const file = m ? this.fileFor(m) : null;
    if (!m || !file || this.phase !== 'available')
      return {
        ok: false,
        message: this.phase === 'ready' ? 'It is downloaded already.' : 'Look for an update first.',
      };
    // A release's file names never change (build/downloads.json), so the version goes in the name here:
    // a download stopped part-way carries on only into the same version.
    const dest = join(this.deps.dir, `${m.version}-${file.name}`.replace(/[^\w.-]/gu, '_'));
    this.phase = 'downloading';
    this.cancelled = false;
    this.progress = { done: 0, total: file.size };
    this.message = null;
    this.changed();
    this.deps.log('info', `Updates: downloading ${m.version}`);
    const rate = new RateGate(this.deps.bytesPerSecond ?? 4 * 1024 * 1024);
    void downloadFile({
      url: file.url,
      dest,
      size: file.size,
      sha512: file.sha512,
      fetch: this.deps.fetch,
      rate,
      gate: () => this.gate(),
      cancelled: () => this.cancelled,
      progress: (done, total) => {
        this.progress = { done, total };
        this.changed();
      },
    }).then(
      () => {
        this.downloaded = dest;
        this.phase = 'ready';
        this.progress = null;
        this.deps.log('info', `Updates: ${m.version} downloaded and checked`);
        this.changed();
      },
      (error: unknown) => {
        this.phase = this.cancelled ? 'available' : 'error';
        this.progress = null;
        this.message = error instanceof DownloadStopped ? error.message : 'The download stopped; try again.';
        this.deps.log(
          'warn',
          `Updates: the download stopped (${error instanceof DownloadStopped ? error.code : 'error'})`,
        );
        this.changed();
      },
    );
    return { ok: true, view: this.view() };
  }

  /** Never while the stream is on air or recording: wait, then go on. */
  private async gate(): Promise<void> {
    while (this.deps.onAir() && !this.cancelled) {
      if (this.phase !== 'waiting') {
        this.phase = 'waiting';
        this.waitingFor = 'the stream is on air or recording';
        this.deps.log('info', 'Updates: the download waits while the stream is on air or recording');
        this.changed();
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (this.phase === 'waiting') {
      this.phase = 'downloading';
      this.waitingFor = null;
      this.changed();
    }
  }

  /** Stop a download (what came so far is kept, and it carries on next time). */
  cancel(): UpdateResult {
    this.cancelled = true;
    return { ok: true, view: this.view() };
  }

  /** Install when Drashti quits (an admin says so), or not after all. */
  async setInstallOnQuit(on: boolean): Promise<UpdateResult> {
    const m = this.manifest;
    const file = this.downloaded;
    if (on && (!m || !file || this.phase !== 'ready'))
      return { ok: false, message: 'Download the update first.' };
    if (!on) {
      this.installOnQuit = false;
      rmSync(join(this.deps.dir, PENDING), { force: true });
      this.deps.log('info', 'Updates: not installing at quit after all');
      return this.answer();
    }
    if (!m || !file) return { ok: false, message: 'Download the update first.' };
    const want = this.fileFor(m)?.sha512;
    // Checked again now, as the say-so is given: at quit, only that it is still the same file.
    if (want === undefined || (await sha512Of(file).catch(() => '')) !== want) {
      this.message = 'The downloaded file has changed since it was checked: download it again.';
      this.deps.log('warn', 'Updates: the update was not taken (its file changed after it was checked)');
      return this.answer();
    }
    const ready = await this.deps.installer.prepare(file, m.version);
    if (!ready.ok) {
      this.message = ready.message;
      if (ready.cause) this.deps.log('warn', `Updates: the update was not taken (${ready.cause})`);
      return this.answer();
    }
    this.checked = checkedNow(file);
    this.installOnQuit = true;
    writeFileSync(
      join(this.deps.dir, PENDING),
      `${JSON.stringify({
        version: m.version,
        file,
        sha512: want,
        ...(this.node && this.askedFor === m.version ? { matchMain: true } : {}),
      })}\n`,
    );
    this.deps.log('info', `Updates: ${m.version} installs when Drashti quits`);
    return this.answer();
  }

  /** The downloaded file, once it is checked (to show it, to install by hand). */
  downloadedFile(): string | null {
    return this.phase === 'ready' ? this.downloaded : null;
  }

  /** A quit that restarts Drashti at once (a restore, a switch to a node): the update waits for the next. */
  holdForNextQuit(): void {
    this.holdThisQuit = true;
  }

  /** Drashti is quitting: install, if an admin said so. */
  quit(): void {
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    this.dailyTimer = null;
    if (!this.installOnQuit || !this.downloaded || this.holdThisQuit) return;
    if (this.deps.installer.mode !== 'at-quit') return;
    // The file as it was when it was checked (a look at its size, time and identity: quitting stays quick).
    if (!sameAs(checkedNow(this.downloaded), this.checked)) {
      this.deps.log('warn', 'Updates: not installed: its file changed after it was checked');
      rmSync(join(this.deps.dir, PENDING), { force: true });
      return;
    }
    this.deps.log('info', 'Updates: installing as Drashti quits');
    rmSync(join(this.deps.dir, PENDING), { force: true });
    const ran = this.deps.installer.atQuit(this.downloaded);
    if (!ran.ok) this.deps.log('warn', `Updates: not installed: ${ran.message}`);
  }

  /** An admin allows a look once a day (never a download), or not. */
  setAutoCheck(on: boolean): UpdateResult {
    if (!this.deps.autoCheck) return { ok: false, message: 'A node does not look for updates by itself.' };
    this.deps.autoCheck.set(on);
    this.scheduleDaily();
    return this.answer();
  }

  private scheduleDaily(): void {
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    this.dailyTimer = null;
    if (!this.deps.autoCheck?.get()) return;
    const since = this.checkedAt === null ? DAY_MS : this.deps.now() - this.checkedAt;
    this.dailyTimer = setTimeout(
      () => {
        this.dailyTimer = null;
        // Not on air, and not while busy: a look only.
        if (!this.deps.onAir() && !this.busy() && !this.installOnQuit) void this.check();
        this.scheduleDaily();
      },
      Math.max(60_000, DAY_MS - since),
    );
    this.dailyTimer.unref();
  }
}
