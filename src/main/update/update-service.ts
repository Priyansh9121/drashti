import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { UpdateFile, UpdateManifest, UpdateResult, UpdateView } from '../../shared/updates';
import { compareVersions, manifestUrl, updateManifestSchema } from '../../shared/updates';
import { RateGate } from '../rate-gate';
import { downloadFile, DownloadStopped } from './download';
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
const pendingSchema = z.object({ version: z.string(), file: z.string(), sha512: z.string() });

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

  constructor(private readonly deps: UpdateDeps) {
    mkdirSync(deps.dir, { recursive: true });
    // An admin's say-so from before a restart (or a crash) still stands, for a file that is still here.
    const pending = this.readPending();
    if (pending && existsSync(pending.file) && compareVersions(pending.version, deps.current) !== 0) {
      this.installOnQuit = true;
      this.downloaded = pending.file;
      this.phase = 'ready';
      this.manifest = {
        app: 'drashti',
        version: pending.version,
        releasedAt: '',
        notes: '',
        source: '',
        files: [],
      };
    } else if (pending) rmSync(join(deps.dir, PENDING), { force: true });
    this.scheduleDaily();
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
      const parsed = updateManifestSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('its release notes cannot be read');
      const m = parsed.data;
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
      this.phase = 'available';
      this.deps.log('info', `Updates: ${m.version} is available (this is ${this.deps.current})`);
      return this.answer();
    } catch (error) {
      this.phase = 'error';
      this.message = `Could not look for updates (${error instanceof Error ? error.message : 'no answer'}). Is the internet connected?`;
      this.deps.log('warn', 'Updates: could not look for updates');
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
    const dest = join(this.deps.dir, file.name.replace(/[^\w.-]/gu, '_'));
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
    const ready = await this.deps.installer.prepare(file, m.version);
    if (!ready.ok) {
      this.message = ready.message;
      return this.answer();
    }
    const fileInfo = this.fileFor(m);
    this.installOnQuit = true;
    writeFileSync(
      join(this.deps.dir, PENDING),
      `${JSON.stringify({ version: m.version, file, sha512: fileInfo?.sha512 ?? '' })}\n`,
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
    this.deps.log('info', 'Updates: installing as Drashti quits');
    rmSync(join(this.deps.dir, PENDING), { force: true });
    this.deps.installer.atQuit(this.downloaded);
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
