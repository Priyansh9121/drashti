import { matchDisplays } from '../../shared/display-match';
import type { DisplayInfo, DisplayKey, ScreenConfig, ScreenStatus } from '../../shared/screens';

/** The parts of an output window the manager needs. */
export interface OutputWindow {
  readonly webContentsId: number;
  setBounds(bounds: DisplayInfo['bounds']): void;
  close(): void;
  isDestroyed(): boolean;
}

export interface OutputManagerDeps {
  listDisplays(): DisplayInfo[];
  screens(): ScreenConfig[];
  saveDisplayKey(screenId: string, key: DisplayKey): void;
  openWindow(screen: ScreenConfig, display: DisplayInfo): OutputWindow;
  /** Called after every reconcile, so the operator and outputs can refresh. */
  onChange(): void;
}

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
  private statuses: ScreenStatus[] = [];

  constructor(private readonly deps: OutputManagerDeps) {}

  reconcile(): void {
    const displays = this.deps.listDisplays();
    const screens = this.deps.screens();
    const assigned = screens.filter(
      (s): s is ScreenConfig & { displayKey: DisplayKey } => s.enabled && s.displayKey !== null,
    );
    const matches = matchDisplays(
      assigned.map((s) => ({ screenId: s.id, key: s.displayKey })),
      displays,
    );

    // Close windows whose screen is gone, disabled, unmatched or matched elsewhere.
    for (const [screenId, entry] of this.open) {
      const displayId = matches.get(screenId);
      if (
        entry.window.isDestroyed() ||
        displayId === undefined ||
        displayId === null ||
        displayId !== entry.displayId
      ) {
        if (!entry.window.isDestroyed()) entry.window.close();
        this.open.delete(screenId);
      }
    }

    for (const screen of assigned) {
      const displayId = matches.get(screen.id);
      const display = displays.find((d) => d.id === displayId);
      if (!display) continue;
      // Remember the display's current fingerprint so the next start matches exactly.
      if (!sameKey(screen.displayKey, display.key)) this.deps.saveDisplayKey(screen.id, display.key);
      const entry = this.open.get(screen.id);
      if (entry) entry.window.setBounds(display.bounds);
      else this.open.set(screen.id, { window: this.deps.openWindow(screen, display), displayId: display.id });
    }

    this.statuses = screens.map((s) => {
      if (!s.enabled) return { screenId: s.id, state: 'disabled', displayId: null };
      if (!s.displayKey) return { screenId: s.id, state: 'unassigned', displayId: null };
      const entry = this.open.get(s.id);
      return entry
        ? { screenId: s.id, state: 'showing', displayId: entry.displayId }
        : { screenId: s.id, state: 'missing-display', displayId: null };
    });
    this.deps.onChange();
  }

  status(): ScreenStatus[] {
    return this.statuses;
  }

  /** The screen an output window shows, looked up by its webContents id. */
  screenIdFor(webContentsId: number): string | undefined {
    for (const [screenId, entry] of this.open)
      if (entry.window.webContentsId === webContentsId) return screenId;
    return undefined;
  }

  windows(): { screenId: string; window: OutputWindow; displayId: number }[] {
    return [...this.open].map(([screenId, e]) => ({ screenId, window: e.window, displayId: e.displayId }));
  }

  closeAll(): void {
    for (const entry of this.open.values()) if (!entry.window.isDestroyed()) entry.window.close();
    this.open.clear();
  }
}
