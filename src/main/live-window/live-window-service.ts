import type { WebFrameMain } from 'electron';
import type { CommandResult } from '../../shared/engine/commands';
import type { BackgroundLayer, WindowBackground } from '../../shared/engine/state';
import {
  type LiveWindowResult,
  type LiveWindowStatus,
  SCREEN_RECORDING_WHY,
  type WindowList,
  WINDOWS_FAILED,
} from '../../shared/live-window';
import { othersWindows, type RawWindowSource } from './sources';

/*
 * Show a Window… (Session 48), as the main process keeps it: the windows the picker offers, the one the
 * operator chose going up as the background, whether it is still open (the operator's notice), and which
 * screens' pages may capture it.
 *
 * A page never names what it captures. A screen's page (an output, the stream's, the operator's) asks to
 * capture the window that is up now; its next request for the screen's picture is then given that window,
 * once (`grantFor`). Every other request is refused, so no page can ever capture a display, or a window
 * nobody chose.
 */

/** A window (or display) as the computer lists it, with a small picture of it. */
export interface ListedSource extends RawWindowSource {
  picture: string | null;
}

/** What a page's capture is given: a window of another app (its capture id), or (the tests' stand-in) a page of Drashti's. */
export type CaptureGrant = { id: string; name: string } | WebFrameMain;

/** The computer's windows, as Drashti may see them (./electron-sources.ts; ./stand-in-sources.ts for tests). */
export interface WindowSources {
  /** Whether the system lets Drashti see other apps' windows (macOS: Screen Recording). */
  access(): 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
  /** Ask for it: macOS lists Drashti under Screen Recording (asking the first time), and System Settings opens there. */
  askAccess(): Promise<void>;
  /** Every window the computer lists now, with a small picture of each. */
  list(): Promise<ListedSource[]>;
  /** The capture ids of Drashti's own windows: never offered. */
  ownIds(): ReadonlySet<string>;
  /** Whether the window is still open and showing (not closed, hidden or minimised). */
  isOpen(id: string): Promise<boolean>;
  /** What a page's capture of the window is given, or null when it cannot be. */
  grant(id: string): CaptureGrant | null;
}

export interface LiveWindowDeps {
  sources: WindowSources;
  /** The engine's showWindow: the only way a window goes up. */
  showWindow(window: Pick<WindowBackground, 'sourceId' | 'name'>): CommandResult;
  /** The background layer now. */
  background(): BackgroundLayer | null;
  /** The operator window is told how it stands, whenever that changes. */
  changed(status: LiveWindowStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  now(): number;
  /** How often to look whether the window is still open (2 s). */
  pollMs?: number;
}

/** A page's request to capture is honoured this long after it asked. */
export const ASK_MS = 10_000;
const POLL_MS = 2000;
const OFF: LiveWindowStatus = { state: 'off', name: null };

/** One frame of one page, as Chromium knows it. */
const frameKey = (frame: Pick<WebFrameMain, 'processId' | 'routingId'>): string =>
  `${String(frame.processId)}:${String(frame.routingId)}`;

export class LiveWindowService {
  /** The windows the picker offered last, by id: the only ones that can go up. */
  private offered = new Map<string, string>();
  private status: LiveWindowStatus = OFF;
  /** The window being followed ("<id>@<when it went up>"), or null. */
  private following: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private looking = false;
  /** Pages that asked to capture the window up now, until when. */
  private readonly asks = new Map<string, number>();

  constructor(private readonly deps: LiveWindowDeps) {}

  /** The other apps' open windows, for the picker; or why there are none to offer. */
  async list(): Promise<WindowList> {
    const { sources } = this.deps;
    if (sources.access() !== 'granted')
      return { ok: false, reason: 'permission', message: SCREEN_RECORDING_WHY };
    try {
      const windows = othersWindows(await sources.list(), sources.ownIds());
      this.offered = new Map(windows.map((w) => [w.id, w.name]));
      return { ok: true, windows: windows.map(({ id, name, picture }) => ({ id, name, picture })) };
    } catch (error) {
      this.deps.log('warn', `The open windows could not be listed: ${String(error)}`);
      return { ok: false, reason: 'unlisted', message: WINDOWS_FAILED };
    }
  }

  /** macOS: say why, then System Settings at Screen Recording (the picker said why first). */
  askAccess(): Promise<void> {
    return this.deps.sources.askAccess();
  }

  /** Put a window the picker just offered on the screens. */
  show(id: string): LiveWindowResult {
    const name = this.offered.get(id);
    if (name === undefined)
      return { ok: false, message: 'That window is not in the list any more. Choose it again.' };
    const result = this.deps.showWindow({ sourceId: id, name });
    if (!result.ok) return { ok: false, message: result.message };
    // Never its name: a window's name can be anything (an inbox's, say).
    this.deps.log('info', 'Another app’s window went up as the background');
    this.follow();
    return { ok: true };
  }

  current(): LiveWindowStatus {
    return this.status;
  }

  /** The show changed: follow the background (a window up, put back, replaced or cleared). */
  follow(): void {
    const bg = this.deps.background();
    if (bg?.kind !== 'window') {
      this.stop();
      this.set(OFF);
      return;
    }
    const key = `${bg.sourceId}@${String(bg.startedAt)}`;
    if (this.following === key) return;
    this.stop();
    this.following = key;
    this.set({ state: 'showing', name: bg.name });
    this.timer = setInterval(() => {
      void this.look();
    }, this.deps.pollMs ?? POLL_MS);
  }

  /** A screen's capture of the window ended: look at once whether it was closed. */
  ended(sourceId: string): void {
    const bg = this.deps.background();
    if (bg?.kind === 'window' && bg.sourceId === sourceId) void this.look();
  }

  /** Whether the window is still open: the notice says so when it is not, and goes when it is again. */
  async look(): Promise<void> {
    const bg = this.deps.background();
    if (bg?.kind !== 'window' || this.looking) return;
    const key = this.following;
    this.looking = true;
    let open: boolean;
    try {
      open = await this.deps.sources.isOpen(bg.sourceId);
    } catch {
      // Not known: never said to be gone without a reason.
      open = true;
    } finally {
      this.looking = false;
    }
    if (this.following !== key) return;
    this.set({ state: open ? 'showing' : 'gone', name: bg.name });
  }

  /** A screen's page asks to capture the window up now; false when that is not the window up. */
  ask(frame: WebFrameMain | null, sourceId: string): boolean {
    const bg = this.deps.background();
    if (!frame || bg?.kind !== 'window' || bg.sourceId !== sourceId) return false;
    this.asks.set(frameKey(frame), this.deps.now() + ASK_MS);
    return true;
  }

  /** What a page's request for the screen's picture is given: the window up now, if it asked for it (once). */
  grantFor(frame: Pick<WebFrameMain, 'processId' | 'routingId'> | null): CaptureGrant | null {
    if (!frame) return null;
    const key = frameKey(frame);
    const until = this.asks.get(key);
    if (until === undefined) return null;
    this.asks.delete(key);
    const bg = this.deps.background();
    if (until < this.deps.now() || bg?.kind !== 'window') return null;
    return this.deps.sources.grant(bg.sourceId);
  }

  close(): void {
    this.stop();
    this.asks.clear();
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.following = null;
  }

  private set(next: LiveWindowStatus): void {
    if (next.state === this.status.state && next.name === this.status.name) return;
    this.status = next;
    if (next.state === 'gone') this.deps.log('warn', 'The window on the screens was closed or hidden');
    this.deps.changed(next);
  }
}
