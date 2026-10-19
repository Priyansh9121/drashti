import type { BrowserWindow } from 'electron';
import type {
  Appearance,
  AppearanceNow,
  AppearanceView,
  InterfaceMotion,
} from '../../shared/appearance/appearances';
import { randomBytes } from 'node:crypto';
import { BUILT_IN, FOLLOW, followed, INTERFACE_MOTIONS } from '../../shared/appearance/appearances';
import {
  checkAccent,
  deriveAppearance,
  OWN_MAX,
  OWN_NAME_MAX,
  OWN_PREFIX,
  type OwnAppearance,
} from '../../shared/appearance/derive';
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
  /** Tests only (DRASHTI_TEST_APPEARANCE, never packaged): start in this appearance, kept or not (the guides' pictures in Black). */
  startIn?: string;
}

export class AppearanceService {
  private settings: AppearanceSettings;
  private computer: ComputerTheme | null = null;
  private readonly windows = new Set<AppearanceWindow>();
  private readonly listeners = new Set<(now: AppearanceNow) => void>();

  constructor(private readonly deps: AppearanceDeps) {
    this.settings = readAppearance(deps.userData, deps.say);
    if (deps.startIn && (deps.startIn === FOLLOW || this.list().some((a) => a.id === deps.startIn)))
      this.settings = { ...this.settings, choice: deps.startIn };
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

  /** Every appearance there is to choose, in the menu's order: the built-in ones, then this computer's own. */
  list(): readonly Appearance[] {
    return [...BUILT_IN, ...this.settings.own.map(deriveAppearance)];
  }

  /** This computer's own appearances (Session 40), as kept. */
  own(): readonly OwnAppearance[] {
    return this.settings.own;
  }

  /**
   * Make one's own from a name, a base and an accent, and choose it (Session 40). Every rule is measured here
   * too, whatever the window said: one that fails is refused in its words. The new one's id, or why not.
   */
  make(fields: Omit<OwnAppearance, 'id'>): { ok: true; id: string } | { ok: false; message: string } {
    const name = fields.name.trim();
    if (name === '' || name.length > OWN_NAME_MAX)
      return { ok: false, message: `Give it a name of up to ${String(OWN_NAME_MAX)} letters.` };
    if (this.list().some((a) => a.name.toLowerCase() === name.toLowerCase()))
      return { ok: false, message: `There is already one called “${name}”: give it another name.` };
    if (this.settings.own.length >= OWN_MAX)
      return {
        ok: false,
        message: `This computer keeps ${String(OWN_MAX)} of your own at most: delete one you no longer use first.`,
      };
    const check = checkAccent(fields.base, fields.accent);
    if (!check.ok) return { ok: false, message: check.why };
    const own: OwnAppearance = {
      id: `${OWN_PREFIX}${randomBytes(6).toString('hex')}`,
      name,
      base: fields.base,
      accent: fields.accent,
    };
    this.settings = { ...this.settings, own: [...this.settings.own, own], choice: own.id };
    this.keep();
    this.setNative();
    this.tell();
    this.deps.say(`Appearance: made “${name}” (${own.base}, ${own.accent}) and chose it`);
    return { ok: true, id: own.id };
  }

  /** Delete one's own; a built-in one can't be. If it was in use, this computer follows its own setting again. */
  remove(id: string): boolean {
    const gone = this.settings.own.find((o) => o.id === id);
    if (!gone) return false;
    const inUse = this.settings.choice === id;
    this.settings = {
      ...this.settings,
      own: this.settings.own.filter((o) => o.id !== id),
      choice: inUse ? FOLLOW : this.settings.choice,
    };
    this.keep();
    this.setNative();
    this.tell();
    this.deps.say(`Appearance: deleted “${gone.name}”${inUse ? '; following the computer again' : ''}`);
    return true;
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
      own: this.settings.own,
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

  /** Interface motion (Session 40): Calm, Lively or Off, for every one of Drashti's own windows at once. */
  setMotion(motion: string): boolean {
    if (!(INTERFACE_MOTIONS as readonly string[]).includes(motion)) return false;
    this.settings = { ...this.settings, motion: motion as InterfaceMotion };
    this.keep();
    this.tell();
    this.deps.say(`Appearance: interface motion ${motion}`);
    return true;
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
