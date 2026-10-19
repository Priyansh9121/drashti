import type { BrowserWindow } from 'electron';
import type { Appearance, AppearanceNow, AppearanceView } from '../../shared/appearance/appearances';
import { BUILT_IN, FOLLOW, followed } from '../../shared/appearance/appearances';
import { appearanceVars } from '../../shared/appearance/vars';
import { IPC } from '../../shared/ipc';
import { sendToPage } from '../windows/send';
import { readAppearance, writeAppearance, type AppearanceSettings } from './appearance-file';

/*
 * The appearance this computer shows (Sessions 39–40): Follow the computer (Black or White, as macOS or Windows
 * is set, changing when it changes, macOS's Auto too), or one chosen in View › Appearance. It is read before
 * any window is made, so each of Drashti's own windows (the operator window, the component gallery, a node's
 * window) opens on its appearance's colour, and its page draws in it from the start (the preload asks at once,
 * appearance:now). Choosing changes every one at once: the page's colours, the window's own colour, and the
 * native parts (menus, dialogs, title bars, scroll bars) through nativeTheme. The audience screens, the
 * stream's page and the stage display are never told.
 */

/** Electron's nativeTheme, as far as this needs it (easy to fake in tests). */
export interface ComputerTheme {
  themeSource: 'system' | 'light' | 'dark';
  readonly shouldUseDarkColors: boolean;
  on(event: 'updated', listener: () => void): unknown;
}

/** A window this tells: Drashti's own, never a screen's. */
export type AppearanceWindow = Pick<
  BrowserWindow,
  'setBackgroundColor' | 'isDestroyed' | 'webContents' | 'once'
>;

export interface AppearanceDeps {
  userData: string;
  say: (line: string) => void;
}

export class AppearanceService {
  private settings: AppearanceSettings;
  private computer: ComputerTheme | null = null;
  private readonly windows = new Set<AppearanceWindow>();
  private readonly listeners = new Set<(now: AppearanceNow) => void>();

  constructor(private readonly deps: AppearanceDeps) {
    this.settings = readAppearance(deps.userData, deps.say);
  }

  /** Once Electron is ready, before any window: the native parts follow, and so does Follow the computer. */
  start(computer: ComputerTheme): void {
    this.computer = computer;
    this.setNative();
    computer.on('updated', () => {
      // The computer turned light or dark (or Drashti set the source, which changes nothing here).
      if (this.settings.choice === FOLLOW) this.tell();
    });
  }

  /** Every appearance there is to choose, in the menu's order. */
  list(): readonly Appearance[] {
    return BUILT_IN;
  }

  /** FOLLOW, or the chosen appearance's id. */
  get choice(): string {
    return this.settings.choice;
  }

  /** The appearance shown now. */
  shown(): Appearance {
    const chosen =
      this.settings.choice === FOLLOW ? undefined : this.list().find((a) => a.id === this.settings.choice);
    return chosen ?? followed(this.computer?.shouldUseDarkColors ?? true);
  }

  /** What a page draws in now. */
  now(): AppearanceNow {
    const shown = this.shown();
    return { id: shown.id, base: shown.base, vars: appearanceVars(shown), motion: this.settings.motion };
  }

  view(): AppearanceView {
    return {
      choice: this.settings.choice,
      shown: this.shown().id,
      list: this.list(),
      motion: this.settings.motion,
    };
  }

  /** The colour a window of Drashti's own opens on: its appearance's window colour. */
  background(): string {
    return this.shown().colours.ink;
  }

  /** Choose FOLLOW or an appearance by its id; false for one there is not. */
  choose(choice: string): boolean {
    if (choice !== FOLLOW && !this.list().some((a) => a.id === choice)) return false;
    this.settings = { ...this.settings, choice };
    this.keep();
    this.setNative();
    this.tell();
    this.deps.say(
      `Appearance: ${choice === FOLLOW ? `Follow the computer (${this.shown().name})` : this.shown().name}`,
    );
    return true;
  }

  /** Hear of every change, after the windows (the menu's ticks follow it). */
  onChanged(listener: (now: AppearanceNow) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** One of Drashti's own windows: told of every change until it closes. */
  track(win: AppearanceWindow): void {
    this.windows.add(win);
    win.once('closed', () => {
      this.windows.delete(win);
    });
  }

  private keep(): void {
    try {
      writeAppearance(this.deps.userData, this.settings);
    } catch (error) {
      this.deps.say(`Appearance: the choice could not be kept for the next start (${String(error)})`);
    }
  }

  /** Menus, dialogs, title bars and scroll bars: the computer's own setting, or the appearance's base. */
  private setNative(): void {
    if (!this.computer) return;
    const source = this.settings.choice === FOLLOW ? 'system' : this.shown().base;
    if (this.computer.themeSource !== source) this.computer.themeSource = source;
  }

  private tell(): void {
    const now = this.now();
    const background = this.background();
    for (const win of this.windows) {
      if (win.isDestroyed()) continue;
      win.setBackgroundColor(background);
      sendToPage(win as BrowserWindow, IPC.appearance.changed, now);
    }
    for (const listener of this.listeners) listener(now);
  }
}
