import { matchDisplays } from '../../shared/display-match';
import type { ScreenSwitch, ScreenSwitches } from '../../shared/screen-switches';
import type { DisplayInfo, DisplayKey, ScreenConfig, ScreenStatus } from '../../shared/screens';

/** The parts of an output window the manager needs. */
export interface OutputWindow {
  readonly webContentsId: number;
  setBounds(bounds: DisplayInfo['bounds']): void;
  close(): void;
  isDestroyed(): boolean;
  /** Out of sight while its display is away (Sessions 31–36, ROB-4)... */
  hide(): void;
  /** ...and shown again, without taking the focus, once it is back. */
  show(): void;
}

export interface OutputManagerDeps {
  listDisplays(): DisplayInfo[];
  screens(): ScreenConfig[];
  saveDisplayKey(screenId: string, key: DisplayKey): void;
  openWindow(screen: ScreenConfig, display: DisplayInfo): OutputWindow;
  /** Called after every reconcile, so the operator and outputs can refresh. */
  onChange(): void;
  /** An output's display went away: it is kept hidden a while (ROB-4). */
  onHeld?(screenId: string): void;
  /** An output kept through a display drop is back on its display, its page never loaded again (ROB-4). */
  onPutBack?(screenId: string): void;
  /** Do something after a while; the answer cancels it (tests give their own clock). */
  later?(fn: () => void, ms: number): () => void;
  /**
   * The switch a screen answers to, Audience or Stage (Session 50), from its group's role; null for none. Left
   * out (a node's own outputs), no switch covers any.
   */
  switchOf?(screen: ScreenConfig): ScreenSwitch | null;
}

/**
 * How long an output whose display went away is kept, hidden, for the display to come back (Sessions 31–36,
 * ROB-4): projectors and HDMI converters often drop for a second or two as they are switched or warm up.
 */
export const DISPLAY_DROP_MS = 10_000;

const realLater = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  return () => {
    clearTimeout(timer);
  };
};

const sameKey = (a: DisplayKey, b: DisplayKey) =>
  a.id === b.id &&
  a.label === b.label &&
  a.pixelWidth === b.pixelWidth &&
  a.pixelHeight === b.pixelHeight &&
  a.x === b.x &&
  a.y === b.y &&
  a.internal === b.internal;

/**
 * Keeps one output window per enabled, assigned screen whose display is
 * connected. Call reconcile() at startup, after every screen change and
 * whenever displays are added, removed or change resolution.
 */
export class OutputManager {
  private readonly open = new Map<string, { window: OutputWindow; displayId: number }>();
  /** Outputs whose display went away, hidden for DISPLAY_DROP_MS in case it comes back (ROB-4). */
  private readonly held = new Map<string, { window: OutputWindow; cancel: () => void }>();
  private statuses: ScreenStatus[] = [];
  /** Screens whose window the watchdog gave up on (Session 23): not "showing" until it reports again. */
  private readonly stopped = new Set<string>();
  /**
   * Audience and Stage turned off (Session 50): their screens' windows closed, their displays the computer's,
   * until on again. Kept here only, so every start has both on.
   */
  private readonly off = new Set<ScreenSwitch>();

  constructor(private readonly deps: OutputManagerDeps) {}

  /** Keep a window hidden while its display is away; closed if it is not back within DISPLAY_DROP_MS. */
  private hold(screenId: string, window: OutputWindow): void {
    window.hide();
    const cancel = (this.deps.later ?? realLater)(() => {
      if (this.held.get(screenId)?.window !== window) return;
      this.held.delete(screenId);
      if (!window.isDestroyed()) window.close();
      this.reconcile();
    }, DISPLAY_DROP_MS);
    this.held.set(screenId, { window, cancel });
    this.deps.onHeld?.(screenId);
  }

  private letGo(screenId: string): void {
    const held = this.held.get(screenId);
    if (!held) return;
    held.cancel();
    this.held.delete(screenId);
    if (!held.window.isDestroyed()) held.window.close();
  }

  /** Is this screen's switch off (Session 50)? */
  private switchedOff(screen: ScreenConfig): boolean {
    if (this.off.size === 0 || !this.deps.switchOf) return false;
    const which = this.deps.switchOf(screen);
    return which !== null && this.off.has(which);
  }

  reconcile(): void {
    const displays = this.deps.listDisplays();
    const screens = this.deps.screens();
    const assigned = screens.filter(
      (s): s is ScreenConfig & { displayKey: DisplayKey } => s.enabled && s.displayKey !== null,
    );
    // Matched with the rest, so each keeps its display while off and opens on it again (Session 50).
    const matches = matchDisplays(
      assigned.map((s) => ({ screenId: s.id, key: s.displayKey })),
      displays,
    );
    const off = new Set(assigned.filter((s) => this.switchedOff(s)).map((s) => s.id));
    const wanted = new Set(assigned.filter((s) => !off.has(s.id)).map((s) => s.id));

    // Close windows whose screen is gone, disabled, switched off (Session 50) or matched elsewhere. One whose
    // display went away, its screen still wanting it, is kept hidden a while instead (ROB-4).
    for (const [screenId, entry] of this.open) {
      const displayId = matches.get(screenId);
      if (!entry.window.isDestroyed() && displayId === entry.displayId && wanted.has(screenId)) continue;
      this.open.delete(screenId);
      if (entry.window.isDestroyed()) continue;
      if (wanted.has(screenId) && (displayId === undefined || displayId === null))
        this.hold(screenId, entry.window);
      else entry.window.close();
    }
    // A held window whose screen no longer wants a display (turned off, switched off, removed) closes now.
    for (const [screenId, held] of this.held)
      if (!wanted.has(screenId) || held.window.isDestroyed()) this.letGo(screenId);

    for (const screen of assigned) {
      if (off.has(screen.id)) continue;
      const displayId = matches.get(screen.id);
      const display = displays.find((d) => d.id === displayId);
      if (!display) continue;
      // Remember the display's current fingerprint so the next start matches exactly.
      if (!sameKey(screen.displayKey, display.key)) this.deps.saveDisplayKey(screen.id, display.key);
      const entry = this.open.get(screen.id);
      const held = this.held.get(screen.id);
      if (entry) entry.window.setBounds(display.bounds);
      else if (held) {
        // Its display is back within the grace: the same window, put back on it and shown, never reloaded.
        held.cancel();
        this.held.delete(screen.id);
        held.window.setBounds(display.bounds);
        held.window.show();
        this.open.set(screen.id, { window: held.window, displayId: display.id });
        this.deps.onPutBack?.(screen.id);
      } else
        this.open.set(screen.id, { window: this.deps.openWindow(screen, display), displayId: display.id });
    }

    // A window closed is no longer given up on: a new one starts afresh.
    for (const id of this.stopped) if (!this.open.has(id) && !this.held.has(id)) this.stopped.delete(id);
    this.statuses = screens.map((s) => {
      if (!s.enabled) return { screenId: s.id, state: 'disabled', displayId: null };
      if (!s.displayKey) return { screenId: s.id, state: 'unassigned', displayId: null };
      // Off on purpose (Session 50), with the display it opens on again.
      if (off.has(s.id))
        return { screenId: s.id, state: 'switched-off', displayId: matches.get(s.id) ?? null };
      const entry = this.open.get(s.id);
      if (entry && this.stopped.has(s.id))
        return { screenId: s.id, state: 'stopped', displayId: entry.displayId };
      return entry
        ? { screenId: s.id, state: 'showing', displayId: entry.displayId }
        : { screenId: s.id, state: 'missing-display', displayId: null };
    });
    this.deps.onChange();
  }

  /** The watchdog gave up on this screen's window, or it is drawing again (Session 23). */
  setStopped(screenId: string, stopped: boolean): void {
    if (this.stopped.has(screenId) === stopped) return;
    if (stopped) this.stopped.add(screenId);
    else this.stopped.delete(screenId);
    this.reconcile();
  }

  status(): ScreenStatus[] {
    return this.statuses;
  }

  /**
   * Audience or Stage off or on (Session 50): off closes this computer's windows it covers (a held one too), so
   * their displays go back to the computer; on opens them again, each on its own display. True when it changed.
   */
  setSwitch(which: ScreenSwitch, on: boolean): boolean {
    const isOn = !this.off.has(which);
    if (isOn === on) return false;
    if (on) this.off.delete(which);
    else this.off.add(which);
    this.reconcile();
    return true;
  }

  /** Which are on (Session 50): both, until one is turned off. */
  switches(): ScreenSwitches {
    return { audience: !this.off.has('audience'), stage: !this.off.has('stage') };
  }

  /** The screen an output window shows (or keeps through a display drop), looked up by its webContents id. */
  screenIdFor(webContentsId: number): string | undefined {
    for (const [screenId, entry] of [...this.open, ...this.held])
      if (entry.window.webContentsId === webContentsId) return screenId;
    return undefined;
  }

  windows(): { screenId: string; window: OutputWindow; displayId: number }[] {
    return [...this.open].map(([screenId, e]) => ({ screenId, window: e.window, displayId: e.displayId }));
  }

  closeAll(): void {
    for (const entry of this.open.values()) if (!entry.window.isDestroyed()) entry.window.close();
    this.open.clear();
    for (const screenId of [...this.held.keys()]) this.letGo(screenId);
  }
}
