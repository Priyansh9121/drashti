import type { Layers } from '../../shared/engine/state';
import type { ClockStyle } from '../../shared/format';
import type { OutputContext, ScreenGroupConfig } from '../../shared/screens';
import type { LiveUnseen } from '../../shared/studio-live';
import { secureWebPreferences } from '../windows/web-preferences';
import type { CapturedImage } from './studio-live';

/*
 * Live's copy (alpha.23; lead 2's choice A for the owner's Live behind the Lower Thirds studio's preview, answered for
 * him overnight): with no audience screen showing on this computer (one display, or only nodes' screens), Live's still
 * comes from the screens' own page (output.html?liveCopy=1) drawn off screen in a window of its own, 960 x 540 and
 * about once a second, muted, as the first audience group draws the show. It is opened only when Live asks for a still
 * (Live chosen, the studio in sight, no hall screen here) and closed on every other change: another backdrop, the
 * studio minimized or closed (Simple Mode and quitting close it), a hall screen showing. With a hall screen here
 * nothing changes: the still is taken from that screen, as in alpha.22.
 *
 * It is no screen, as the Stage preview is not (index.ts): never counted, never reporting (each output report is
 * refused from any page but a screen's), never sent to a node, never waited for by a video cue, and never warming up
 * (its page loads with warmUp=skip: at a frame a second a warm-up would take many seconds). It cannot open a video
 * input or capture another app's window (only the screens' and the operator's pages may), so with one of those live
 * the studio says so (`unseenInCopy`). It costs, while open, one more decode of a playing video and a small picture
 * drawn once a second; nothing at all while closed.
 */

/** Its size inside: the studio's preview is at most about 900 points wide. */
export const LIVE_COPY_SIZE = { width: 960, height: 540 } as const;
/** The longest Live waits for its first picture after it opens (its page loading) before saying there is none. */
export const LIVE_COPY_FIRST_MS = 5000;
/** Frames a second it draws: Live takes a still about once a second. */
export const LIVE_COPY_FPS = 1;
/** Its page's query, by which tests (and its address in the log) tell it from a screen's. */
export const LIVE_COPY_QUERY = 'liveCopy';
/** The id its context gives it: no screen has it (screens' ids are made by the library). */
export const LIVE_COPY_SCREEN_ID = 'live-copy';

/** The part of its window Live needs. */
export interface LiveCopyWindow {
  /** Its last picture drawn, or null before its first. */
  latest(): CapturedImage | null;
  isDestroyed(): boolean;
  close(): void;
}

export interface LiveCopyDeps {
  /** Open its window (`gone`: its page stopped); null while Drashti quits (a window made then would stop the quit). */
  open(gone: () => void): LiveCopyWindow | null;
  log(line: string): void;
  /** This computer's clock (ms). */
  now?(): number;
}

/** Its window is open and has not drawn yet (its page loading): Live sends nothing meanwhile. */
export const WAITING = 'waiting';

export class LiveCopy {
  private win: LiveCopyWindow | null = null;
  /** When its window opened (this computer's clock). */
  private openedAt = 0;
  /** Its page stopped (a crash): not opened again until it is closed (Live chosen again, or the studio back). */
  private failed = false;

  constructor(private readonly deps: LiveCopyDeps) {}

  /** Whether its window is open now. */
  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  /**
   * No hall screen here, Live wants a still: its last picture, the window opened first if need be. Before its first
   * picture, `WAITING` (for at most LIVE_COPY_FIRST_MS after it opened), then none.
   */
  still(): CapturedImage | typeof WAITING | null {
    if (this.failed) return null;
    const open = this.win;
    if (open && !open.isDestroyed()) return open.latest() ?? this.waiting();
    const win: LiveCopyWindow | null = this.deps.open(() => {
      if (this.win === win) this.gone();
    });
    this.win = win;
    if (!win) return null;
    this.openedAt = this.now();
    this.deps.log(
      'Live behind the Lower Thirds studio: no hall screen on this computer, so its copy of the audience picture is drawn off screen (960 x 540, once a second, muted)',
    );
    return win.latest() ?? this.waiting();
  }

  private waiting(): typeof WAITING | null {
    return this.now() - this.openedAt < LIVE_COPY_FIRST_MS ? WAITING : null;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Every other change (Live stopped or paused, a hall screen showing): closed at once. */
  close(): void {
    this.failed = false;
    const win = this.win;
    this.win = null;
    if (!win || win.isDestroyed()) return;
    win.close();
    this.deps.log('Live’s copy closed');
  }

  private gone(): void {
    this.failed = true;
    const win = this.win;
    this.win = null;
    if (win && !win.isDestroyed()) win.close();
    this.deps.log('Live’s copy stopped: Live says "No live picture to show" until it is chosen again');
  }
}

/**
 * The copy's context, as an output's (shared/screens.ts): the first audience group's look, on its first screen's
 * canvas and scaling (1920 x 1080, fitted, with none), drawn plainly (no screen's geometry or grid), on Main's own
 * clock, with no display; an id no screen has.
 */
export function liveCopyContext(
  groups: readonly ScreenGroupConfig[],
  clockStyle?: ClockStyle,
): OutputContext {
  const group = groups.find((g) => g.role === 'audience');
  const first = group?.screens[0];
  return {
    screenId: LIVE_COPY_SCREEN_ID,
    screenName: 'Live copy',
    groupId: group?.id ?? '',
    groupName: group?.name ?? 'Audience',
    role: 'audience',
    feed: null,
    canvasWidth: first?.canvasWidth ?? 1920,
    canvasHeight: first?.canvasHeight ?? 1080,
    scaling: first?.scaling ?? 'fit',
    display: null,
    ...(clockStyle ? { clockStyle } : {}),
  };
}

/** What is live that the copy cannot draw (it is no screen): a video input, or another app's window, in either place. */
export function unseenInCopy(layers: Pick<Layers, 'background' | 'pip'>): LiveUnseen[] {
  const kinds = [layers.background?.kind, layers.pip?.source.kind];
  const unseen: LiveUnseen[] = [];
  for (const kind of kinds)
    if ((kind === 'input' || kind === 'window') && !unseen.includes(kind)) unseen.push(kind);
  return unseen;
}

/** Its window: off screen (its pictures handed to the main process), never shown or focusable, not in the taskbar. */
export function liveCopyOptions() {
  return {
    show: false,
    width: LIVE_COPY_SIZE.width,
    height: LIVE_COPY_SIZE.height,
    useContentSize: true,
    title: 'Drashti – Live copy',
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#000000',
    webPreferences: {
      ...secureWebPreferences(),
      offscreen: true,
      // Never slowed down for being out of sight: it is never in sight.
      backgroundThrottling: false,
    },
  };
}

/** Its page's query: the screens' page as Live's copy, drawn at once without a warm-up. */
export function liveCopyQuery(): Record<string, string> {
  return { [LIVE_COPY_QUERY]: '1', warmUp: 'skip' };
}
