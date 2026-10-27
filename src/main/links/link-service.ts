import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { formatBytes } from '../../shared/format';
import {
  aboveTheSetting,
  checkLink,
  heightLabel,
  isLinkHeight,
  LINK_KEEP_FREE_BYTES,
  type LinkHeight,
  type LinkKind,
  type LinkResult,
  type LinkShape,
  type LinkView,
  MAX_ZIP_BYTES,
  MAX_ZIP_FILES,
  NOT_TAKEN_REASON,
  PERMISSION_WORDS,
  takenKind,
  waitingKind,
  type YouTubeChoice,
} from '../../shared/links';
import { fileProblem } from '../plain-errors';
import { claimFile, safeName } from './names';
import type { FromWorker, ToWorker, WorkerRoute } from './protocol';
import { choiceWords } from './youtube';
import type { YtDlpLaunch } from './youtube-run';
import { killTree } from './youtube-tools';
import type { FolderFile } from '../playlists/folder-playlist';
import { kindRank, partsInFolderOrder } from '../../shared/folder-order';

/*
 * Import from a Link, the main process's side (Session 25b). One link at a
 * time: look at it, download it (in its own low-priority process) into the
 * folder the admin chose, unpack a folder's zip, then import the PowerPoint
 * files and MP4 videos through the normal import. Drashti never moves or
 * deletes what it saved.
 *
 * - Closing the dialog never stops a download: the status bar shows it.
 * - It waits while the stream is on air or recording, asking nothing of
 *   Dropbox meanwhile, and carries on afterwards. So does looking at a
 *   YouTube link, which runs yt-dlp, Deno and YouTube's code (since
 *   1.0.0-alpha.3); looking at a Dropbox link asks for a few headers only,
 *   and never waits.
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
  /** Drashti's own folder for copies made for an import (emptied at each start and after each import). */
  workDir: string;
  /** The admin's highest video quality (Session 25c), kept with the library's settings. */
  maxHeight: { get(): LinkHeight; set(height: LinkHeight): void };
  /** The playlist the last download went into (Session 54, F1), kept with the library's settings. */
  lastPlaylist?: { get(): string | null; set(id: string): void };
  /**
   * Make a video taller than `maxHeight` a copy that tall in `outDir` (Drashti's own conversion: it waits
   * while the stream is on air or recording); `copy` null: it is that tall or less already. Reports why
   * it waits, or how far it has got.
   */
  fitVideo?(
    path: string,
    outDir: string,
    maxHeight: number,
    report: (waitingFor: string | null, fraction: number | null) => void,
  ): Promise<{ ok: true; copy: string | null } | { ok: false; message: string }>;
  /**
   * YouTube (Session 25c): how yt-dlp is started, with its home, temporary folder and Deno's cache in
   * `work` (a Drashti work folder, emptied afterwards); or why it cannot be.
   */
  youtubeLaunch?(work: string): { ok: true; launch: YtDlpLaunch } | { ok: false; message: string };
  /**
   * yt-dlp's process as it starts and ends (Session 31, ROB-3: ../system/leftovers.ts): one left running
   * by a crash is stopped at the next start, with its process group on a Mac.
   */
  children?: { started(pid: number, group: boolean): void; ended(pid: number): void };
  /** Tests only: where requests go instead, and the guard. */
  route: WorkerRoute;
  /** How often to look at the stream while downloading (ms). */
  pollMs?: number;
  /**
   * A Dropbox folder's own playlist (Session 26c), when its import ended: in the folder's order, at the top
   * of the list. Its id and name, or null when nothing came in.
   */
  folderPlaylist?(input: {
    name: string;
    runId: string;
    files: FolderFile[];
  }): { id: string; name: string } | null;
  /** Its PDFs and pictures, imported by the one button: each at the end of its folder's part. How many. */
  addToFolderPlaylist?(input: { playlistId: string; runId: string; files: FolderFile[] }): number;
}

const WAITING_FOR = 'the stream is on air or recording';
const LOOK_WAITS = 'Links: looking at a YouTube link waits while the stream is on air or recording';
const ACTIVE = new Set<LinkView['phase']>(['waiting', 'downloading', 'unpacking', 'converting', 'importing']);
/** Only these are ever cleared at a start (never anything else a record might name). */
const OURS = /^\.drashti-(download-[0-9a-f-]+\.part|unpacking-.+|youtube-[0-9a-f-]+)$/u;

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
  /** YouTube: yt-dlp's process while it runs (stopped with all it started at a stop or a quit). */
  private toolPid: number | null = null;
  /** YouTube: the Drashti work folder of a look or download (its home, temporary folder, Deno's cache). */
  private toolsWork: string | null = null;

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
      playlist: null,
      waiting: [],
      waitingAdded: null,
      maxHeight: deps.maxHeight.get(),
      choice: null,
      lastPlaylist: deps.lastPlaylist?.get() ?? null,
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
    // yt-dlp, and the Deno and FFmpeg it started, stop with the download process.
    if (this.toolPid !== null) {
      killTree(this.toolPid);
      this.deps.children?.ended(this.toolPid);
    }
    this.toolPid = null;
    if (worker) {
      worker.post({ type: 'stop' });
      worker.kill();
    }
    this.clearToolsWork();
  }

  /** The work folder yt-dlp and Deno ran in: emptied once they have stopped. */
  private clearToolsWork(): void {
    const work = this.toolsWork;
    this.toolsWork = null;
    if (!work) return;
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // Still held by the programs the moment after they were stopped (Windows): again once they have
      // gone, and the next start clears the work folder anyway.
      void rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
    }
  }

  /** A new work folder for yt-dlp and Deno, and how to start yt-dlp with it. */
  private youtubeRun(): { ok: true; launch: YtDlpLaunch; cwd: string } | { ok: false; message: string } {
    if (!this.deps.youtubeLaunch)
      return { ok: false, message: 'YouTube downloads are not available in this Drashti.' };
    this.clearToolsWork();
    const work = join(this.deps.workDir, `youtube-${randomUUID()}`);
    for (const dir of ['home', 'temp', 'deno']) mkdirSync(join(work, dir), { recursive: true });
    const launch = this.deps.youtubeLaunch(work);
    if (!launch.ok) {
      rmSync(work, { recursive: true, force: true });
      return launch;
    }
    // The caller keeps it as this.toolsWork once its download process has started.
    return { ok: true, launch: launch.launch, cwd: work };
  }

  private heard(m: FromWorker): void {
    switch (m.type) {
      case 'looked':
        this.looked(m);
        return;
      case 'progress': {
        this.downloadedBytes = m.done;
        // YouTube's total is the estimate taken when it started (yt-dlp knows each part's only).
        const progress = { done: m.done, total: m.total ?? this.state.progress?.total ?? null };
        if (this.state.phase === 'downloading') this.set({ progress });
        else this.state = { ...this.state, progress };
        return;
      }
      case 'downloaded':
        void this.downloaded(m);
        return;
      case 'work-folder':
        this.remember(m.path);
        return;
      case 'unpacked':
        void this.unpacked(m);
        return;
      case 'tool':
        if (this.toolPid !== null && this.toolPid !== m.pid) this.deps.children?.ended(this.toolPid);
        this.toolPid = m.pid;
        // On a Mac it leads a process group of its own (youtube-run.ts), stopped together.
        if (m.pid !== null) this.deps.children?.started(m.pid, process.platform !== 'win32');
        return;
      case 'yt-looked':
        this.ytLooked(m);
        return;
      case 'yt-downloaded':
        void this.ytDownloaded(m);
        return;
      case 'failed':
        if (this.job === 'look') {
          this.endWorker();
          this.deps.log('info', `Links: a ${this.kindWord()} link could not be looked at (${m.code})`);
          this.set({ phase: 'idle', look: null, waitingFor: null, message: m.message });
          return;
        }
        // An unpack says which of its rules stopped it (Session 26a: "unpack" alone left no clue).
        void this.failed(
          m.message,
          m.rule === 'stopped' ? 'stopped' : m.rule ? `${m.code}: ${m.rule}` : m.code,
        );
        return;
    }
  }

  private kindWord(): string {
    return this.state.kind ? KIND_WORD[this.state.kind] : 'link';
  }

  // ---- looking -------------------------------------------------------------------

  /**
   * Check a pasted link for the kind chosen, and ask Dropbox (or yt-dlp, for YouTube) what it holds. YouTube's
   * look waits while the stream is on air or recording, as a download does.
   */
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
        waitingFor: null,
        message: check.message,
        saved: null,
        notTaken: [],
        fitted: [],
        runId: null,
        playlist: null,
        waiting: [],
        waitingAdded: null,
      });
      return this.refuse(check.message);
    }
    // YouTube: yt-dlp asks for the video's details (in the download process, at low priority).
    const run = kind === 'youtube' ? this.youtubeRun() : null;
    if (run && !run.ok) {
      this.endWorker();
      this.checked = null;
      this.set({
        phase: 'idle',
        kind,
        link: null,
        look: null,
        waitingFor: null,
        message: run.message,
        saved: null,
        runId: null,
      });
      return this.refuse(run.message);
    }
    this.checked = { url: check.url, shape: check.shape };
    this.held = run !== null && this.deps.onAir();
    this.set({
      phase: 'looking',
      kind,
      link: check.url,
      look: null,
      progress: null,
      waitingFor: this.held ? WAITING_FOR : null,
      message: null,
      saved: null,
      notTaken: [],
      fitted: [],
      runId: null,
      playlist: null,
      waiting: [],
      waitingAdded: null,
      choice: null,
    });
    const worker = this.startWorker('look');
    if (run?.ok) {
      this.toolsWork = run.cwd;
      if (this.held) this.deps.log('info', LOOK_WAITS);
      worker.post({ type: 'hold', on: this.held });
      worker.post({ type: 'yt-look', link: check.url, launch: run.launch, cwd: run.cwd });
      this.watch();
    } else worker.post({ type: 'look', link: check.url, route: this.deps.route });
    return this.answer();
  }

  private ytLooked(m: Extract<FromWorker, { type: 'yt-looked' }>): void {
    this.endWorker();
    if (!this.checked || this.state.phase !== 'looking') return;
    const tallest = m.details.heights[0]?.height;
    this.deps.log(
      'info',
      `Links: looked at a YouTube video link (${tallest === undefined ? 'sound only' : `up to ${heightLabel(tallest)}`})`,
    );
    this.set({
      phase: 'looked',
      look: { shape: 'video', name: m.details.title, size: null, video: m.details },
      waitingFor: null,
      message: null,
    });
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
      playlist: null,
      waiting: [],
      waitingAdded: null,
      choice: null,
    });
    return this.answer();
  }

  // ---- the highest video quality (an admin's) ------------------------------------

  /** Set the highest video quality, for YouTube and Dropbox (Session 25c). */
  setMaxHeight(height: unknown): LinkResult {
    if (!isLinkHeight(height)) return this.refuse('Choose 1080p, 1440p, 2160p (4K) or 4320p (8K).');
    if (this.busy) return this.refuse('Change it once the download going on has finished.');
    if (height !== this.state.maxHeight) {
      this.deps.maxHeight.set(height);
      this.deps.log('info', `Links: the highest video quality is now ${heightLabel(height)}`);
      this.set({ maxHeight: height });
    }
    return this.answer();
  }

  // ---- the playlist a download goes into (every person's) -------------------------

  /**
   * The playlist a download's import went into (Session 54, F1): the dialog offers it first the next time. The
   * window adds what the import made, so it says which playlist that was; only an id is kept.
   */
  setPlaylist(id: unknown): LinkResult {
    if (typeof id !== 'string' || id === '' || id.length > 200) return this.refuse('That is not a playlist.');
    if (id !== this.state.lastPlaylist) {
      this.deps.lastPlaylist?.set(id);
      this.set({ lastPlaylist: id });
    }
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

  download(choice?: unknown): LinkResult {
    if (this.busy) return this.refuse('A download is going on already.');
    const checked = this.checked;
    const look = this.state.look;
    if (this.state.phase !== 'looked' || !checked || !look) return this.refuse('Paste a link first.');
    if (look.video) return this.youtubeDownload(checked.url, look.video, choice);
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
      playlist: null,
      waiting: [],
      waitingAdded: null,
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

  /** Is this a choice of the qualities the video offers, within the setting, with the tick ticked? */
  private youtubeChoice(
    video: NonNullable<NonNullable<LinkView['look']>['video']>,
    raw: unknown,
  ): { ok: true; choice: YouTubeChoice; bytes: number | null } | { ok: false; message: string } {
    const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<YouTubeChoice>;
    if (c.permission !== true) return { ok: false, message: `Tick the box first: ${PERMISSION_WORDS}.` };
    if (c.type === 'mp3')
      return { ok: true, choice: { type: 'mp3', height: null, permission: true }, bytes: video.soundBytes };
    if (c.type !== 'mp4') return { ok: false, message: 'Choose MP4 (the video) or MP3 (its sound only).' };
    const offered = video.heights.find((h) => h.height === c.height);
    if (!offered) return { ok: false, message: 'Choose one of the qualities this video offers.' };
    if (offered.height > this.state.maxHeight)
      return { ok: false, message: aboveTheSetting(this.state.maxHeight) };
    return {
      ok: true,
      choice: { type: 'mp4', height: offered.height, permission: true },
      bytes: offered.bytes,
    };
  }

  /** YouTube: yt-dlp downloads into a hidden folder in the folder chosen (Session 25c). */
  private youtubeDownload(
    link: string,
    video: NonNullable<NonNullable<LinkView['look']>['video']>,
    raw: unknown,
  ): LinkResult {
    const picked = this.youtubeChoice(video, raw);
    if (!picked.ok) return this.refuse(picked.message);
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
    if (picked.bytes !== null && free - picked.bytes < LINK_KEEP_FREE_BYTES)
      return this.refuse(
        `Saving it (about ${formatBytes(picked.bytes)}) would leave less than 2 GB free on that disk, which Drashti keeps free for the show. Free up some space, choose another folder, or a lower quality.`,
      );
    if (free < LINK_KEEP_FREE_BYTES)
      return this.refuse(
        'That disk has less than 2 GB free, which Drashti keeps free for the show. Free up some space, or choose another folder.',
      );
    const run = this.youtubeRun();
    if (!run.ok) return this.refuse(run.message);
    // yt-dlp's part-files and its finished file stay under a hidden name until Drashti names the file.
    this.part = join(folder, `.drashti-youtube-${randomUUID()}`);
    mkdirSync(this.part, { recursive: true });
    this.remember(this.part);
    this.downloadedBytes = 0;
    this.held = this.deps.onAir();
    const choice = { type: picked.choice.type, height: picked.choice.height };
    this.set({
      phase: this.held ? 'waiting' : 'downloading',
      waitingFor: this.held ? WAITING_FOR : null,
      progress: { done: 0, total: picked.bytes },
      message: null,
      saved: null,
      notTaken: [],
      fitted: [],
      runId: null,
      playlist: null,
      waiting: [],
      waitingAdded: null,
      choice,
    });
    this.deps.log(
      'info',
      `Links: a YouTube video download starts (${choiceWords(choice)}${picked.bytes !== null ? `, about ${formatBytes(picked.bytes)}` : ''})`,
    );
    if (this.held) this.deps.log('info', 'Links: the download waits while the stream is on air or recording');
    const worker = this.startWorker('download');
    // startWorker cleared the work folder the look used: this download has its own.
    this.toolsWork = run.cwd;
    worker.post({ type: 'hold', on: this.held });
    worker.post({
      type: 'yt-download',
      link,
      launch: run.launch,
      cwd: run.cwd,
      workDir: this.part,
      choice,
      keepFree: LINK_KEEP_FREE_BYTES,
    });
    this.watch();
    return this.answer();
  }

  /** YouTube: downloaded. The file takes the video's title as a safe name, never over a file there. */
  private async ytDownloaded(m: Extract<FromWorker, { type: 'yt-downloaded' }>): Promise<void> {
    const work = this.part;
    const look = this.state.look;
    if (!work || !look) return;
    this.endWorker();
    const folder = this.state.folder;
    const ext = m.file.toLowerCase().endsWith('.mp3') ? 'mp3' : 'mp4';
    try {
      const title = look.name.replace(/[\\/]/gu, '-');
      const target = await claimFile(folder, safeName(`${title}.${ext}`, `YouTube video.${ext}`));
      await rename(m.file, target);
      await rm(work, { recursive: true, force: true });
      this.temps.delete(work);
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

  /**
   * While looking at a YouTube link, downloading or unpacking: hold whenever the stream is on air or
   * recording.
   */
  private watch(): void {
    this.stopWatching();
    this.timer = setInterval(() => {
      const on = this.deps.onAir();
      if (on === this.held || !this.worker) return;
      this.held = on;
      this.worker.post({ type: 'hold', on });
      if (this.job === 'look') {
        // Still looking: only the words change.
        this.deps.log('info', on ? LOOK_WAITS : 'Links: looking at the YouTube link carries on');
        this.set({ waitingFor: on ? WAITING_FOR : null });
      } else if (on) {
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
    // From YouTube: the one file Drashti named (its MP4 or MP3). From Dropbox: its PowerPoints, MP4s and sounds.
    const youtube = this.state.kind === 'youtube';
    // A Dropbox folder (Session 26c): it becomes a playlist of its own, and its PDFs and pictures wait for
    // the one button.
    const isFolder = !youtube && this.checked?.shape === 'folder';
    const taken = youtube ? paths : paths.filter((p) => takenKind(p) !== null);
    // Listed in the folder's order, as they will go in.
    const waiting = isFolder
      ? partsInFolderOrder(
          files.filter((f) => takenKind(f) === null && waitingKind(f)),
          (f) => f,
          kindRank,
        ).flatMap((part) => part.entries)
      : [];
    const notTaken = youtube
      ? []
      : files
          .filter((f) => takenKind(f) === null && !waiting.includes(f))
          .map((name) => ({ name, reason: NOT_TAKEN_REASON }));
    this.deps.log(
      'info',
      `Links: a ${this.kindWord()} download was saved (${String(files.length)} ${files.length === 1 ? 'file' : 'files'}, ${formatBytes(bytes)}); ${String(taken.length)} to import, ${String(notTaken.length)} not taken`,
    );
    this.set({
      phase: 'importing',
      waitingFor: null,
      progress: null,
      saved: { folder, files },
      notTaken,
      waiting,
      waitingAdded: null,
    });
    // Videos above the highest quality: a copy that tall is imported instead (the original stays in the folder).
    const maxHeight = this.state.maxHeight;
    const most = heightLabel(maxHeight);
    const work = join(this.deps.workDir, randomUUID());
    const prepared: string[] = [];
    const fitted: string[] = [];
    // What the import is given, and where each one is in the folder (a 1080p copy is its original's).
    const given: FolderFile[] = [];
    for (const path of taken) {
      if (takenKind(path) !== 'video' || !this.deps.fitVideo) {
        prepared.push(path);
        given.push({ path, relative: inFolder(path) });
        continue;
      }
      this.set({ phase: 'converting', waitingFor: null, progress: null });
      const fit = await this.deps.fitVideo(
        path,
        join(work, String(prepared.length)),
        maxHeight,
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
          `Links: a video above ${most} could not be made ${most}, so it was not imported`,
        );
        notTaken.push({
          name: inFolder(path),
          reason: `It is above ${most}, and Drashti could not make it ${most} (${fit.message.replace(/\.$/u, '')}), so it was not imported: make it ${most} or smaller in another program, then import it again.`,
        });
        continue;
      }
      if (fit.copy) fitted.push(inFolder(path));
      prepared.push(fit.copy ?? path);
      given.push({ path: fit.copy ?? path, relative: inFolder(path) });
    }
    this.set({ phase: 'importing', waitingFor: null, progress: null, notTaken, fitted });
    if (prepared.length === 0) {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
      this.set({
        phase: 'done',
        message:
          taken.length === 0
            ? waiting.length > 0
              ? 'Saved. It has no PowerPoint file (.pptx) or MP4 video; its PDFs and pictures wait for Add the PDFs and pictures.'
              : 'Saved. Nothing in it is a PowerPoint file (.pptx), an MP4 video or a sound, so nothing was imported.'
            : 'Saved, but nothing in it could be imported: see Not taken.',
      });
      return;
    }
    const result = await this.deps.importFiles(prepared);
    // The import has copied the copies into the library: they are not needed now.
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    if (result.ok) {
      this.deps.log('info', 'Links: the saved files went to the import');
      const shown = paths[0] ?? folder;
      this.byRun.set(result.runId, shown);
      for (const old of [...this.byRun.keys()].slice(0, Math.max(0, this.byRun.size - 20)))
        this.byRun.delete(old);
      // A folder: its own playlist, in its folders' order (made where the import's report says what each became).
      const playlist =
        isFolder && this.deps.folderPlaylist
          ? this.deps.folderPlaylist({
              name: this.state.look?.name ?? 'Dropbox folder',
              runId: result.runId,
              files: given,
            })
          : null;
      if (playlist)
        this.deps.log('info', `Links: a Dropbox folder became a playlist of ${String(given.length)} file(s)`);
      this.set({ phase: 'done', runId: result.runId, playlist });
    } else {
      this.deps.log('warn', 'Links: the saved files could not be imported');
      this.set({ phase: 'failed', message: `Saved, but not imported: ${result.message}` });
    }
  }

  /**
   * Add the PDFs and pictures (Session 26c): a folder's waiting files, imported, then each at the end of its
   * folder's part of the folder's playlist (made now if the folder had nothing else).
   */
  async addWaiting(): Promise<LinkResult> {
    const saved = this.state.saved;
    const waiting = this.state.waiting;
    if (!saved || waiting.length === 0 || this.busy) return this.refuse('Nothing is waiting to be added.');
    this.set({ phase: 'importing', waitingFor: null, progress: null, message: null });
    const files = waiting.map((relativePath) => ({
      path: join(saved.folder, ...relativePath.split('/')),
      relative: relativePath,
    }));
    const result = await this.deps.importFiles(files.map((f) => f.path));
    if (!result.ok) {
      this.deps.log('warn', 'Links: a folder’s PDFs and pictures could not be imported');
      this.set({ phase: 'done', message: `Not added: ${result.message}` });
      return this.answer();
    }
    const playlistId = this.state.playlist?.id ?? null;
    let added = 0;
    let playlist = this.state.playlist;
    if (playlistId && this.deps.addToFolderPlaylist)
      added = this.deps.addToFolderPlaylist({ playlistId, runId: result.runId, files });
    else if (!playlistId && this.deps.folderPlaylist) {
      playlist = this.deps.folderPlaylist({
        name: this.state.look?.name ?? 'Dropbox folder',
        runId: result.runId,
        files,
      });
      added = playlist ? files.length : 0;
    }
    this.deps.log(
      'info',
      `Links: added a folder’s PDFs and pictures (${String(added)} of ${String(files.length)})`,
    );
    this.byRun.set(result.runId, files[0]?.path ?? saved.folder);
    this.set({ phase: 'done', runId: result.runId, playlist, waiting: [], waitingAdded: added });
    return this.answer();
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
      this.set({ phase: 'idle', waitingFor: null, message: null });
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
