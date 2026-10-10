import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { formatBytes } from '../../shared/format';
import {
  checkLink,
  LINK_KEEP_FREE_BYTES,
  LINK_MAX_HEIGHT,
  type LinkKind,
  type LinkResult,
  type LinkShape,
  type LinkView,
  MAX_ZIP_BYTES,
  MAX_ZIP_FILES,
  NOT_TAKEN_REASON,
  takenKind,
} from '../../shared/links';
import { fileProblem } from '../plain-errors';
import { claimFile, safeName } from './names';
import type { FromWorker, ToWorker, WorkerRoute } from './protocol';

/*
 * Import from a Link, the main process's side (Session 25b). One link at a
 * time: look at it, download it (in its own low-priority process) into the
 * folder the admin chose, unpack a folder's zip, then import the PowerPoint
 * files and MP4 videos through the normal import. Drashti never moves or
 * deletes what it saved.
 *
 * - Closing the dialog never stops a download: the status bar shows it.
 * - It waits while the stream is on air or recording, asking nothing of
 *   Dropbox meanwhile, and carries on afterwards.
 * - A stopped or failed download leaves nothing under a real name: it is
 *   written under a hidden name first, and those are listed in a small file
 *   so a crash's leftovers are cleared at the next start.
 * - The log keeps the kind, the sizes and the outcome only: never the link,
 *   a title, a file name or the folder.
 */

/** The parts of a download process the service uses (tests pass one that runs in-process). */
export interface LinkWorker {
  post(message: ToWorker): void;
  onMessage(listener: (message: FromWorker) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export interface LinkServiceDeps {
  spawn(): LinkWorker;
  /** The stream is on air or recording. */
  onAir(): boolean;
  freeBytes(dir: string): number;
  /** "Drashti downloads" in Movies (Mac) or Videos (Windows). */
  defaultFolder: string;
  lastFolder: { get(): string | null; set(dir: string): void };
  /** The system's folder picker, starting at `current`; null when cancelled. */
  pickFolder(current: string): Promise<string | null>;
  /** The normal import of these files (it copies them into the library); its run once it ends. */
  importFiles(paths: string[]): Promise<{ ok: true; runId: string } | { ok: false; message: string }>;
  changed(view: LinkView): void;
  log(level: 'info' | 'warn', message: string): void;
  /** The file listing part-files and work folders, to clear after a crash. */
  record: string;
  /** Drashti's own folder for 1080p copies made for an import (emptied at each start and after each import). */
  workDir: string;
  /**
   * Make a video above 1080p a 1080p copy in `outDir` (Drashti's own conversion: it waits while the
   * stream is on air or recording); `copy` null: it is 1080p or less already. Reports why it waits, or
   * how far it has got.
   */
  fitVideo?(
    path: string,
    outDir: string,
    report: (waitingFor: string | null, fraction: number | null) => void,
  ): Promise<{ ok: true; copy: string | null } | { ok: false; message: string }>;
  /** Tests only: where requests go instead, and the guard. */
  route: WorkerRoute;
  /** How often to look at the stream while downloading (ms). */
  pollMs?: number;
}

const WAITING_FOR = 'the stream is on air or recording';
const ACTIVE = new Set<LinkView['phase']>(['waiting', 'downloading', 'unpacking', 'converting', 'importing']);
/** Only these are ever cleared at a start (never anything else a record might name). */
const OURS = /^\.drashti-(download-[0-9a-f-]+\.part|unpacking-.+)$/u;

const KIND_WORD: Record<LinkKind, string> = { dropbox: 'Dropbox', youtube: 'YouTube' };

export class LinkService {
  private state: LinkView;
  private checked: { url: string; shape: LinkShape } | null = null;
  private worker: LinkWorker | null = null;
  private job: 'look' | 'download' | 'unpack' | null = null;
  private part: string | null = null;
  private readonly temps = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private held = false;
  private downloadedBytes = 0;
  /** Import runs from a link: where to show their files (the last few). */
  private readonly byRun = new Map<string, string>();

  constructor(private readonly deps: LinkServiceDeps) {
    this.clearLeftovers();
    rmSync(deps.workDir, { recursive: true, force: true });
    this.state = {
      phase: 'idle',
      kind: null,
      link: null,
      look: null,
      folder: deps.lastFolder.get() ?? deps.defaultFolder,
      progress: null,
      waitingFor: null,
      message: null,
      saved: null,
      notTaken: [],
      fitted: [],
      runId: null,
    };
  }

  view(): LinkView {
    return { ...this.state, notTaken: [...this.state.notTaken], fitted: [...this.state.fitted] };
  }

  /** A download, an unpack, a conversion or an import is going on (or waiting). */
  get busy(): boolean {
    return ACTIVE.has(this.state.phase);
  }

  private set(change: Partial<LinkView>): void {
    this.state = { ...this.state, ...change };
    this.deps.changed(this.view());
  }

  private answer(): LinkResult {
    return { ok: true, view: this.view() };
  }

  private refuse(message: string): LinkResult {
    return { ok: false, message, view: this.view() };
  }

  // ---- the record of part-files ------------------------------------------------

  private saveRecord(): void {
    try {
      writeFileSync(this.deps.record, JSON.stringify([...this.temps]));
    } catch {
      // Only a crash's leftovers depend on it.
    }
  }

  private clearLeftovers(): void {
    let listed: unknown;
    try {
      listed = JSON.parse(readFileSync(this.deps.record, 'utf8'));
    } catch {
      return;
    }
    if (Array.isArray(listed))
      for (const path of listed)
        if (typeof path === 'string' && OURS.test(basename(path)))
          rmSync(path, { recursive: true, force: true });
    rmSync(this.deps.record, { force: true });
  }

  private remember(path: string): void {
    this.temps.add(path);
    this.saveRecord();
  }

  /** Remove the part-file and work folders (what was saved under a real name stays). */
  private async clearTemps(): Promise<void> {
    for (const path of [...this.temps, ...this.unpacking()])
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
    this.temps.clear();
    this.part = null;
    this.saveRecord();
  }

  /**
   * Work folders in the folder being saved to: one made the moment before a stop or a quit is not in
   * the record yet. Known by their name only, so nothing else is ever touched.
   */
  private unpacking(): string[] {
    if (this.part === null && this.temps.size === 0) return [];
    try {
      return readdirSync(this.state.folder)
        .filter((name) => name.startsWith('.drashti-unpacking-'))
        .map((name) => join(this.state.folder, name));
    } catch {
      return [];
    }
  }

  // ---- the download process ----------------------------------------------------

  private startWorker(job: 'look' | 'download'): LinkWorker {
    this.endWorker();
    const worker = this.deps.spawn();
    this.worker = worker;
    this.job = job;
    worker.onMessage((m) => {
      if (this.worker === worker) this.heard(m);
    });
    worker.onExit((code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      const job = this.job;
      this.job = null;
      if (job === null) return;
      this.deps.log('warn', `Links: the download process stopped unexpectedly (code ${String(code)})`);
      void this.failed('The download stopped unexpectedly. Try again.', 'crashed');
    });
    return worker;
  }

  private endWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.job = null;
    this.stopWatching();
    if (worker) {
      worker.post({ type: 'stop' });
      worker.kill();
    }
  }

  private heard(m: FromWorker): void {
    switch (m.type) {
      case 'looked':
        this.looked(m);
        return;
      case 'progress':
        this.downloadedBytes = m.done;
        if (this.state.phase === 'downloading') this.set({ progress: { done: m.done, total: m.total } });
        else this.state = { ...this.state, progress: { done: m.done, total: m.total } };
        return;
      case 'downloaded':
        void this.downloaded(m);
        return;
      case 'work-folder':
        this.remember(m.path);
        return;
      case 'unpacked':
        void this.unpacked(m);
        return;
      case 'failed':
        if (this.job === 'look') {
          this.endWorker();
          this.deps.log('info', `Links: a ${this.kindWord()} link could not be looked at (${m.code})`);
          this.set({ phase: 'idle', look: null, message: m.message });
          return;
        }
        void this.failed(m.message, m.code);
        return;
    }
  }

  private kindWord(): string {
    return this.state.kind ? KIND_WORD[this.state.kind] : 'link';
  }

  // ---- looking -------------------------------------------------------------------

  /** Check a pasted link for the kind chosen, and ask Dropbox what it holds. */
  look(kind: LinkKind, text: string): LinkResult {
    if (this.busy) return this.refuse('A download is going on. Wait for it to finish, or stop it first.');
    const check = checkLink(kind, text);
    if (!check.ok) {
      this.endWorker();
      this.checked = null;
      this.set({
        phase: 'idle',
        kind,
        link: null,
        look: null,
        message: check.message,
        saved: null,
        notTaken: [],
        fitted: [],
        runId: null,
      });
      return this.refuse(check.message);
    }
    this.checked = { url: check.url, shape: check.shape };
    this.set({
      phase: 'looking',
      kind,
      link: check.url,
      look: null,
      progress: null,
      waitingFor: null,
      message: null,
      saved: null,
      notTaken: [],
      fitted: [],
      runId: null,
    });
    this.startWorker('look').post({ type: 'look', link: check.url, route: this.deps.route });
    return this.answer();
  }

  private looked(m: Extract<FromWorker, { type: 'looked' }>): void {
    this.endWorker();
    const checked = this.checked;
    if (!checked || this.state.phase !== 'looking') return;
    const fromUrl = decodeURIComponent(new URL(checked.url).pathname.split('/').pop() ?? '');
    let name = m.name ?? fromUrl;
    if (checked.shape === 'folder') name = name.replace(/\.zip$/iu, '');
    const look = { shape: checked.shape, name, size: checked.shape === 'folder' ? null : m.size };
    this.deps.log(
      'info',
      `Links: looked at a ${this.kindWord()} ${checked.shape} link${look.size !== null ? ` (${formatBytes(look.size)})` : ''}`,
    );
    this.set({ phase: 'looked', look, message: null });
  }

  /** Start again with a new link (what was saved stays where it is). */
  reset(): LinkResult {
    if (this.busy) return this.refuse('A download is going on. Wait for it to finish, or stop it first.');
    this.endWorker();
    this.checked = null;
    this.set({
      phase: 'idle',
      link: null,
      look: null,
      progress: null,
      waitingFor: null,
      message: null,
      saved: null,
      notTaken: [],
      fitted: [],
      runId: null,
    });
    return this.answer();
  }

  // ---- where to save -------------------------------------------------------------

  async pickFolder(): Promise<LinkResult> {
    if (this.busy) return this.refuse('Choose where to save before the download starts.');
    const picked = await this.deps.pickFolder(this.state.folder);
    if (picked) {
      this.deps.lastFolder.set(picked);
      this.set({ folder: picked });
    }
    return this.answer();
  }

  // ---- downloading ---------------------------------------------------------------

  download(): LinkResult {
    if (this.busy) return this.refuse('A download is going on already.');
    const checked = this.checked;
    const look = this.state.look;
    if (this.state.phase !== 'looked' || !checked || !look) return this.refuse('Paste a link first.');
    const folder = this.state.folder;
    try {
      mkdirSync(folder, { recursive: true });
    } catch (error) {
      this.deps.log(
        'warn',
        `Links: the folder to save in could not be made (${String((error as NodeJS.ErrnoException).code)})`,
      );
      return this.refuse(`Drashti could not save there. ${fileProblem(error, 'write')}`);
    }
    const free = this.deps.freeBytes(folder);
    if (look.size !== null && free - look.size < LINK_KEEP_FREE_BYTES)
      return this.refuse(
        `Saving it (${formatBytes(look.size)}) would leave less than 2 GB free on that disk, which Drashti keeps free for the show. Free up some space, or choose another folder.`,
      );
    if (free < LINK_KEEP_FREE_BYTES)
      return this.refuse(
        'That disk has less than 2 GB free, which Drashti keeps free for the show. Free up some space, or choose another folder.',
      );
    this.part = join(folder, `.drashti-download-${randomUUID()}.part`);
    this.remember(this.part);
    this.downloadedBytes = 0;
    this.held = this.deps.onAir();
    this.set({
      phase: this.held ? 'waiting' : 'downloading',
      waitingFor: this.held ? WAITING_FOR : null,
      progress: { done: 0, total: look.size },
      message: null,
      saved: null,
      notTaken: [],
      fitted: [],
      runId: null,
    });
    this.deps.log('info', `Links: a ${this.kindWord()} ${checked.shape} download starts`);
    if (this.held) this.deps.log('info', 'Links: the download waits while the stream is on air or recording');
    const worker = this.startWorker('download');
    worker.post({ type: 'hold', on: this.held });
    worker.post({
      type: 'download',
      link: checked.url,
      part: this.part,
      keepFree: LINK_KEEP_FREE_BYTES,
      maxBytes: MAX_ZIP_BYTES,
      route: this.deps.route,
    });
    this.watch();
    return this.answer();
  }

  /** While downloading or unpacking: hold whenever the stream is on air or recording. */
  private watch(): void {
    this.stopWatching();
    this.timer = setInterval(() => {
      const on = this.deps.onAir();
      if (on === this.held || !this.worker) return;
      this.held = on;
      this.worker.post({ type: 'hold', on });
      if (on) {
        this.deps.log('info', 'Links: the download waits while the stream is on air or recording');
        this.set({ phase: 'waiting', waitingFor: WAITING_FOR });
      } else {
        this.deps.log('info', 'Links: the download carries on');
        this.set({ phase: this.job === 'unpack' ? 'unpacking' : 'downloading', waitingFor: null });
      }
    }, this.deps.pollMs ?? 1000);
    this.timer.unref();
  }

  private stopWatching(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async downloaded(m: Extract<FromWorker, { type: 'downloaded' }>): Promise<void> {
    const checked = this.checked;
    const part = this.part;
    const look = this.state.look;
    if (!checked || !part || !look) return;
    const folder = this.state.folder;
    if (checked.shape === 'folder') {
      // The zip is unpacked by the download process too (it waits while on air, as the download does).
      this.job = 'unpack';
      this.set({ phase: this.held ? 'waiting' : 'unpacking' });
      this.worker?.post({
        type: 'unpack',
        zip: part,
        parent: folder,
        name: look.name,
        keepFree: LINK_KEEP_FREE_BYTES,
        maxFiles: MAX_ZIP_FILES,
        maxBytes: MAX_ZIP_BYTES,
      });
      return;
    }
    this.endWorker();
    try {
      const target = await claimFile(folder, safeName(m.name ?? look.name, 'Dropbox download'));
      await rename(part, target);
      this.temps.delete(part);
      this.part = null;
      this.saveRecord();
      await this.saved(folder, [target], m.bytes);
    } catch (error) {
      this.deps.log(
        'warn',
        `Links: the download could not be given its name (${String((error as NodeJS.ErrnoException).code)})`,
      );
      await this.failed(`The download could not be saved. ${fileProblem(error, 'write')}`, 'name');
    }
  }

  private async unpacked(m: Extract<FromWorker, { type: 'unpacked' }>): Promise<void> {
    this.endWorker();
    this.temps.delete(m.folder);
    await this.clearTemps();
    await this.saved(m.folder, m.files, this.downloadedBytes);
  }

  /** Saved under real names: list them, then import what is taken. */
  private async saved(folder: string, paths: string[], bytes: number): Promise<void> {
    const inFolder = (p: string) => relative(folder, p).split(sep).join('/');
    const files = paths.map(inFolder);
    const taken = paths.filter((p) => takenKind(p) !== null);
    const notTaken = files
      .filter((f) => takenKind(f) === null)
      .map((name) => ({ name, reason: NOT_TAKEN_REASON }));
    this.deps.log(
      'info',
      `Links: a ${this.kindWord()} download was saved (${String(files.length)} ${files.length === 1 ? 'file' : 'files'}, ${formatBytes(bytes)}); ${String(taken.length)} to import, ${String(notTaken.length)} not taken`,
    );
    this.set({ phase: 'importing', waitingFor: null, progress: null, saved: { folder, files }, notTaken });
    // Videos above 1080p: a 1080p copy is imported instead (the original stays in the folder).
    const work = join(this.deps.workDir, randomUUID());
    const prepared: string[] = [];
    const fitted: string[] = [];
    for (const path of taken) {
      if (takenKind(path) !== 'video' || !this.deps.fitVideo) {
        prepared.push(path);
        continue;
      }
      this.set({ phase: 'converting', waitingFor: null, progress: null });
      const fit = await this.deps.fitVideo(
        path,
        join(work, String(prepared.length)),
        (waitingFor, fraction) => {
          this.set({
            waitingFor,
            progress: fraction === null ? null : { done: Math.round(fraction * 100), total: 100 },
          });
        },
      );
      if (!fit.ok) {
        this.deps.log(
          'warn',
          `Links: a video above ${String(LINK_MAX_HEIGHT)}p could not be made ${String(LINK_MAX_HEIGHT)}p, so it was not imported`,
        );
        notTaken.push({
          name: inFolder(path),
          reason: `It is above ${String(LINK_MAX_HEIGHT)}p, and Drashti could not make it ${String(LINK_MAX_HEIGHT)}p (${fit.message.replace(/\.$/u, '')}), so it was not imported.`,
        });
        continue;
      }
      if (fit.copy) fitted.push(inFolder(path));
      prepared.push(fit.copy ?? path);
    }
    this.set({ phase: 'importing', waitingFor: null, progress: null, notTaken, fitted });
    if (prepared.length === 0) {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
      this.set({
        phase: 'done',
        message:
          taken.length === 0
            ? 'Saved. Nothing in it is a PowerPoint file (.pptx) or an MP4 video, so nothing was imported.'
            : 'Saved, but nothing in it could be imported: see Not taken.',
      });
      return;
    }
    const result = await this.deps.importFiles(prepared);
    // The import has copied the 1080p copies into the library: they are not needed now.
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    if (result.ok) {
      this.deps.log('info', 'Links: the saved files went to the import');
      const shown = paths[0] ?? folder;
      this.byRun.set(result.runId, shown);
      for (const old of [...this.byRun.keys()].slice(0, Math.max(0, this.byRun.size - 20)))
        this.byRun.delete(old);
      this.set({ phase: 'done', runId: result.runId });
    } else {
      this.deps.log('warn', 'Links: the saved files could not be imported');
      this.set({ phase: 'failed', message: `Saved, but not imported: ${result.message}` });
    }
  }

  private async failed(message: string, code: string): Promise<void> {
    const stopped = code === 'stopped';
    this.endWorker();
    await this.clearTemps();
    this.deps.log(stopped ? 'info' : 'warn', `Links: a ${this.kindWord()} download stopped (${code})`);
    this.set({ phase: stopped ? 'stopped' : 'failed', waitingFor: null, progress: null, message });
  }

  /** Stop the download (or unpacking): nothing of it is kept. */
  stop(): LinkResult {
    if (this.job === 'look') {
      this.endWorker();
      this.set({ phase: 'idle', message: null });
      return this.answer();
    }
    if (this.state.phase === 'importing' || this.state.phase === 'converting')
      return this.refuse('The download is saved; its import carries on. Its report shows what came in.');
    if (!this.busy) return this.answer();
    this.endWorker();
    this.deps.log('info', `Links: a ${this.kindWord()} download was stopped`);
    this.set({ phase: 'stopped', waitingFor: null, progress: null, message: 'Stopped. Nothing was kept.' });
    void this.clearTemps();
    return this.answer();
  }

  /**
   * Where the files were saved (the first of them, to show in Finder or Explorer): for an import run's
   * report, or the download in the dialog.
   */
  savedPath(runId: string | null): string | null {
    if (runId !== null) return this.byRun.get(runId) ?? null;
    const saved = this.state.saved;
    if (!saved) return null;
    const first = saved.files[0];
    return first ? join(saved.folder, ...first.split('/')) : saved.folder;
  }

  /** Drashti is quitting: stop, and remove every part-file now. */
  close(): void {
    this.endWorker();
    for (const path of this.unpacking()) this.temps.add(path);
    for (const path of this.temps) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // Still open (Windows): the record clears it at the next start.
        continue;
      }
      this.temps.delete(path);
    }
    this.saveRecord();
    if (this.temps.size === 0) rmSync(this.deps.record, { force: true });
  }
}
