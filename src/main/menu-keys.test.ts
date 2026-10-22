import type { MenuItemConstructorOptions } from 'electron';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { OperatorAction } from '../shared/keymap';
import { acceleratorFor, KEYMAP, toAccelerator } from '../shared/keymap';
import type { OperatorMode } from '../shared/mode';
import type { MenuActions, NodeMenuActions } from './menu';
import { installMenu, installNodeMenu } from './menu';

/*
 * The keys the operators already press (Session 50): F12 puts the logo up, and Cmd+1 and Cmd+2 (Ctrl+1 and
 * Ctrl+2 on Windows) turn the Audience and Stage screens off and on. Nothing else in a packaged Drashti answers
 * them: no item in Main's menus or a node's, in Pro or Simple Mode, on the Mac or on Windows, with diagnostics
 * on or off, by its own accelerator or by its role's (the keys Electron gives the role), except the logo's and
 * the Audience and Stage screens' own; no key that works system-wide; and no key handler of a window's own.
 * Electron's menu is stood in for, so each menu is read just as it is built.
 */

const menus = vi.hoisted(() => ({ built: [] as MenuItemConstructorOptions[][] }));
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      menus.built.push(template);
      return template;
    },
    setApplicationMenu: () => undefined,
  },
}));

type Platform = 'darwin' | 'win32';

/** The keys checked here, the action the keymap gives each, and the words that name that action's own items. */
const THEIRS: readonly { key: string; action: OperatorAction; own: RegExp }[] = [
  { key: 'F12', action: 'toggleLogo', own: /\blogo\b/iu },
  { key: 'Mod+1', action: 'toggleAudience', own: /\baudience\b/iu },
  { key: 'Mod+2', action: 'toggleStage', own: /\bstage\b/iu },
];

const both = (...keys: string[]): Record<Platform, readonly string[]> => ({ darwin: keys, win32: keys });

/**
 * The keys Electron gives each role these menus use, on the Mac and on Windows, as Electron 44.4.5 has them (its
 * own menu-item roles); a submenu role's are its items'. A role not here fails the test: look up its keys first.
 */
const ROLE_KEYS: Record<string, Record<Platform, readonly string[]>> = {
  // About, Services, Hide, Hide Others, Show All and Quit (the Mac's only).
  appmenu: both('Command+H', 'Command+Alt+H', 'CommandOrControl+Q'),
  // Undo, Redo, Cut, Copy, Paste, Paste and Match Style (the Mac's), Delete and Select All, then the Mac's
  // Substitutions and Speech, which have no keys.
  editmenu: {
    darwin: [
      'CommandOrControl+Z',
      'Shift+CommandOrControl+Z',
      'CommandOrControl+X',
      'CommandOrControl+C',
      'CommandOrControl+V',
      'Cmd+Option+Shift+V',
      'CommandOrControl+A',
    ],
    win32: [
      'CommandOrControl+Z',
      'Control+Y',
      'CommandOrControl+X',
      'CommandOrControl+C',
      'CommandOrControl+V',
      'CommandOrControl+A',
    ],
  },
  // Minimize, Zoom and Bring All to Front on the Mac; Minimize and Close on Windows.
  windowmenu: { darwin: ['CommandOrControl+M'], win32: ['CommandOrControl+M', 'CommandOrControl+W'] },
  help: both(),
  cut: both('CommandOrControl+X'),
  copy: both('CommandOrControl+C'),
  paste: both('CommandOrControl+V'),
  pasteandmatchstyle: { darwin: ['Cmd+Option+Shift+V'], win32: ['Shift+CommandOrControl+V'] },
  delete: both(),
  selectall: both('CommandOrControl+A'),
  togglefullscreen: { darwin: ['Control+Command+F'], win32: ['F11'] },
  minimize: both('CommandOrControl+M'),
  zoom: both(),
  front: both(),
  close: both('CommandOrControl+W'),
  toggledevtools: { darwin: ['Alt+Command+I'], win32: ['Ctrl+Shift+I'] },
};

/** An accelerator as the keys pressed on `platform`: its modifiers in one order, then its key. */
function pressed(accelerator: string, platform: Platform): string {
  const parts = accelerator.split('+');
  const key = (parts.pop() ?? '').toUpperCase();
  const mods = parts.map((part) => {
    const p = part.toLowerCase();
    if (p === 'commandorcontrol' || p === 'cmdorctrl') return platform === 'darwin' ? 'Cmd' : 'Ctrl';
    if (p === 'command' || p === 'cmd' || p === 'super' || p === 'meta') return 'Cmd';
    if (p === 'control' || p === 'ctrl') return 'Ctrl';
    if (p === 'alt' || p === 'option' || p === 'altgr') return 'Alt';
    return part;
  });
  return [...[...new Set(mods)].sort(), key].join('+');
}

/** Every key a menu answers, and the item that answers it: by the item's own accelerator, or else its role's. */
function keysOf(
  template: readonly MenuItemConstructorOptions[],
  platform: Platform,
): { item: string; key: string }[] {
  const found: { item: string; key: string }[] = [];
  const walk = (items: readonly MenuItemConstructorOptions[]) => {
    for (const item of items) {
      const name = item.label ?? item.role ?? item.id ?? '';
      if (typeof item.accelerator === 'string')
        found.push({ item: name, key: pressed(item.accelerator, platform) });
      else if (item.role !== undefined) {
        const role = ROLE_KEYS[item.role.toLowerCase()];
        expect(role, `the keys Electron gives the ${item.role} role`).toBeDefined();
        for (const key of role?.[platform] ?? []) found.push({ item: name, key: pressed(key, platform) });
      }
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return found;
}

/**
 * Whatever a menu asks of a part this test does not name (a later session's): another stand-in, never a key. So
 * the menus still build as they grow, and every key in them is checked all the same.
 */
const standIn: unknown = new Proxy(() => standIn, {
  get: (_target, key): unknown => {
    // Never a promise; spread, an empty list; in words, none.
    if (key === 'then') return undefined;
    if (key === Symbol.iterator) return () => [][Symbol.iterator]();
    if (key === Symbol.toPrimitive) return () => '';
    return standIn;
  },
});

/** `known`, with a stand-in for every other part. */
const withStandIns = <T extends object>(known: Partial<T>): T =>
  new Proxy(known, {
    get: (target, key): unknown => (key in target ? target[key as keyof T] : standIn),
  }) as T;

/** Main's menu as the main process gives it: the keymap's keys for Undo and Uncover the controls. */
const mainActions = (mode: OperatorMode, platform: Platform, diagnostics: boolean): MenuActions =>
  withStandIns<MenuActions>({
    mode,
    undo: { accelerator: acceleratorFor('undo'), run: () => undefined },
    redo: { run: () => undefined },
    uncoverControls: { accelerator: acceleratorFor('uncoverControls'), run: () => undefined },
    priority: platform === 'win32' ? { ahead: false, toggle: () => undefined } : null,
    extras: { shown: false, toggle: () => undefined },
    safeAreas: { shown: false, toggle: () => undefined },
    appearance: {
      choices: [{ id: 'follow', label: 'Follow the Computer' }],
      chosen: 'follow',
      choose: () => undefined,
      open: () => undefined,
    },
    diagnostics: diagnostics ? (standIn as MenuActions['diagnostics']) : null,
  });

const nodeActions = (platform: Platform, diagnostics: boolean): NodeMenuActions =>
  withStandIns<NodeMenuActions>({
    priority: platform === 'win32' ? { ahead: false, toggle: () => undefined } : null,
    diagnostics: diagnostics ? (standIn as NodeMenuActions['diagnostics']) : null,
  });

/** `run` as on `platform`: the menus ask process.platform as they are built. */
function on<T>(platform: Platform, run: () => T): T {
  const was = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return run();
  } finally {
    if (was) Object.defineProperty(process, 'platform', was);
  }
}

/** Every menu Drashti can have on `platform`: Main's in each mode, and a node's, with diagnostics off and on. */
function everyMenu(platform: Platform): { menu: string; template: MenuItemConstructorOptions[] }[] {
  return on(platform, () => {
    const out: { menu: string; template: MenuItemConstructorOptions[] }[] = [];
    const take = (menu: string) => {
      const template = menus.built.pop();
      expect(template, menu).toBeDefined();
      if (template) out.push({ menu, template });
    };
    for (const diagnostics of [false, true]) {
      const also = diagnostics ? ', diagnostics on' : '';
      for (const mode of ['pro', 'simple'] as const) {
        installMenu(mainActions(mode, platform, diagnostics));
        take(`Main's menu in ${mode} mode${also}`);
      }
      installNodeMenu(nodeActions(platform, diagnostics));
      take(`a node's menu${also}`);
    }
    return out;
  });
}

const src = join(__dirname, '..');

/** Every source file under `dir` but the tests. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe('F12, Cmd+1 and Cmd+2 (Ctrl+1 and Ctrl+2 on Windows): only the logo’s and the screens’ keys (Session 50)', () => {
  it('are the keymap’s keys for the Logo and for the Audience and Stage screens', () => {
    for (const { key, action } of THEIRS)
      expect(KEYMAP.find((b) => b.action === action)?.keys, action).toContain(key);
  });

  it.each(['darwin', 'win32'] as const)(
    'no menu item answers them but the Logo’s and the Audience and Stage screens’ own (%s)',
    (platform) => {
      const all = everyMenu(platform);
      expect(all).toHaveLength(6);
      const keys = all.flatMap(({ menu, template }) =>
        keysOf(template, platform).map((k) => ({ ...k, menu })),
      );
      // Every key is read: the menus' own (Undo, Reload, Uncover the controls) and their roles' (Copy, Minimize).
      const mod = platform === 'darwin' ? 'Cmd' : 'Ctrl';
      expect(keys.map((k) => k.key)).toEqual(
        expect.arrayContaining([`${mod}+Z`, `${mod}+R`, `${mod}+Shift+U`, `${mod}+C`, `${mod}+M`]),
      );
      const taken = keys.flatMap(({ menu, item, key }) =>
        THEIRS.filter((t) => pressed(toAccelerator(t.key), platform) === key && !t.own.test(item)).map(
          (t) => `${menu}: ${item} answers ${t.key}`,
        ),
      );
      expect(taken).toEqual([]);
    },
  );

  it('none of them works system-wide (Windows keeps F12 for debuggers: it is never a system-wide key)', () => {
    const global = KEYMAP.filter((b) => b.global === true).flatMap((b) => b.keys);
    expect(global.length).toBeGreaterThan(0);
    expect(global.filter((key) => THEIRS.some((t) => t.key === key))).toEqual([]);
  });

  it('no window’s own key handler answers F12, or 1 or 2 with Cmd or Ctrl: only the keymap names them', () => {
    const keymap = join(src, 'shared', 'keymap.ts');
    const found = sources(src)
      .filter((path) => path !== keymap)
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, n: i + 1 }))
          // Code, not comments.
          .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/u.test(line))
          .filter(
            ({ line }) =>
              /['"`]F12['"`]/u.test(line) ||
              /\bDigit[12]\b/u.test(line) ||
              /\.key\b.*['"`][12]['"`]|['"`][12]['"`].*\.key\b/u.test(line),
          )
          .map(({ line, n }) => `${relative(src, path)}:${String(n)} ${line.trim()}`),
      );
    expect(found).toEqual([]);
  });
});
