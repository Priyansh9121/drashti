import type { MenuItemConstructorOptions } from 'electron';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { KeyBinding, KeyInput, OperatorAction } from '../shared/keymap';
import { acceleratorFor, actionFor, KEYMAP, SIMPLE_KEYMAP, toAccelerator } from '../shared/keymap';
import type { OperatorMode } from '../shared/mode';
import type { MenuActions, NodeMenuActions } from './menu';
import { installMenu, installNodeMenu } from './menu';

/*
 * One press, one action (Session 50; its gaps closed in Session 51). The page answers the keymap's keys
 * (shared/keymap.ts), the ones the operators already press among them: F5 to F8 (moved in Session 50), F12 for
 * the logo, Cmd+1 and Cmd+2 (Ctrl+1 and Ctrl+2 on Windows) for the Audience and Stage screens. No menu of a
 * packaged Drashti answers one of them as well: no item in Main's menus or a node's, in Pro or Simple Mode, on
 * the Mac or on Windows, with diagnostics on or off, by its own accelerator or by its role's (the keys Electron
 * gives the role), but the item that is that key's own action's (OWN). Every key of the keymap is checked, each
 * menu key pressed as the page's own keyMatches hears it, whatever spelling it is written in. Nothing else built
 * in Drashti answers the operators' keys either: no key that works system-wide, and no key handler of a
 * window's own. Electron's menu is stood in for, so each menu is read just as it is built.
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
const PLATFORMS = ['darwin', 'win32'] as const;

/** The operators' keys, and the action the keymap gives each. */
const THEIRS: readonly { key: string; action: OperatorAction }[] = [
  { key: 'F5', action: 'clearAudio' },
  { key: 'F6', action: 'clearMessages' },
  { key: 'F7', action: 'clearTicker' },
  { key: 'F8', action: 'clearMasks' },
  { key: 'F12', action: 'toggleLogo' },
  { key: 'Mod+1', action: 'toggleAudience' },
  { key: 'Mod+2', action: 'toggleStage' },
];

/**
 * The only items that may answer a key the page answers: that key's own action's, by id (a role's key by its
 * role). Every other key of the keymap, F12 among them, belongs to no item.
 */
const OWN: Partial<Record<OperatorAction, readonly string[]>> = {
  // The menu's key (the keymap's menuOnly): the page leaves Mod+Z to Edit › Undo, Main's or a node's.
  undo: ['undo'],
  // Whichever hears it first uncovers the controls, and that is all it does (system-wide too while covered).
  uncoverControls: ['uncover-controls'],
  // Shown without being bound (Session 51): Windows' menu leaves them unbound (registerAccelerator: false);
  // the Mac's binds every key it shows, so the page takes every press of them first (the keymap's shownInMenu).
  toggleAudience: ['screen-switch-audience'],
  toggleStage: ['screen-switch-stage'],
};

/** The keys Electron gives a role's items, each item named by its own role. */
type RoleKeys = Record<Platform, readonly (readonly [role: string, accelerator: string])[]>;
const both = (...keys: (readonly [string, string])[]): RoleKeys => ({ darwin: keys, win32: keys });

/**
 * The Electron whose roles' keys ROLE_KEYS has: its major, as a patch keeps them. A newer major fails the test until
 * they are read again.
 */
const ELECTRON_MAJOR = 44;

/**
 * The keys Electron gives each role these menus use, on the Mac and on Windows, copied by hand from Electron 44.4.5's
 * own menu-item roles; a submenu role's are its items'. A role not here fails the test: look up its keys first.
 */
const ROLE_KEYS: Record<string, RoleKeys> = {
  // About, Services, Hide, Hide Others, Show All and Quit (the Mac's only).
  appmenu: both(['hide', 'Command+H'], ['hideothers', 'Command+Alt+H'], ['quit', 'CommandOrControl+Q']),
  // Undo, Redo, Cut, Copy, Paste, Paste and Match Style (the Mac's), Delete and Select All, then the
  // Mac's Substitutions and Speech, which have no keys.
  editmenu: {
    darwin: [
      ['undo', 'CommandOrControl+Z'],
      ['redo', 'Shift+CommandOrControl+Z'],
      ['cut', 'CommandOrControl+X'],
      ['copy', 'CommandOrControl+C'],
      ['paste', 'CommandOrControl+V'],
      ['pasteandmatchstyle', 'Cmd+Option+Shift+V'],
      ['selectall', 'CommandOrControl+A'],
    ],
    win32: [
      ['undo', 'CommandOrControl+Z'],
      ['redo', 'Control+Y'],
      ['cut', 'CommandOrControl+X'],
      ['copy', 'CommandOrControl+C'],
      ['paste', 'CommandOrControl+V'],
      ['selectall', 'CommandOrControl+A'],
    ],
  },
  // Minimize, Zoom and Bring All to Front on the Mac; Minimize and Close on Windows.
  windowmenu: {
    darwin: [['minimize', 'CommandOrControl+M']],
    win32: [
      ['minimize', 'CommandOrControl+M'],
      ['close', 'CommandOrControl+W'],
    ],
  },
  help: both(),
  cut: both(['cut', 'CommandOrControl+X']),
  copy: both(['copy', 'CommandOrControl+C']),
  paste: both(['paste', 'CommandOrControl+V']),
  pasteandmatchstyle: {
    darwin: [['pasteandmatchstyle', 'Cmd+Option+Shift+V']],
    win32: [['pasteandmatchstyle', 'Shift+CommandOrControl+V']],
  },
  delete: both(),
  selectall: both(['selectall', 'CommandOrControl+A']),
  togglefullscreen: {
    darwin: [['togglefullscreen', 'Control+Command+F']],
    win32: [['togglefullscreen', 'F11']],
  },
  minimize: both(['minimize', 'CommandOrControl+M']),
  zoom: both(),
  front: both(),
  close: both(['close', 'CommandOrControl+W']),
  toggledevtools: {
    darwin: [['toggledevtools', 'Alt+Command+I']],
    win32: [['toggledevtools', 'Ctrl+Shift+I']],
  },
};

/** Each way Electron writes a modifier, as the key pressed on `platform`. */
const MODIFIERS: Record<string, (platform: Platform) => string> = {
  commandorcontrol: (platform) => (platform === 'darwin' ? 'Cmd' : 'Ctrl'),
  cmdorctrl: (platform) => (platform === 'darwin' ? 'Cmd' : 'Ctrl'),
  command: () => 'Cmd',
  cmd: () => 'Cmd',
  super: () => 'Cmd',
  meta: () => 'Cmd',
  control: () => 'Ctrl',
  ctrl: () => 'Ctrl',
  alt: () => 'Alt',
  option: () => 'Alt',
  altgr: () => 'Alt',
  shift: () => 'Shift',
};

/**
 * Other names for one key: Electron's (Up, Esc, Return, Plus) and the keymap's (KeyboardEvent.key, as
 * ArrowUp), and the number pad's digits and point, which type what the main keys do (the page hears "1" from
 * either 1).
 */
const SAME_KEY: Record<string, string> = {
  UP: 'ARROWUP',
  DOWN: 'ARROWDOWN',
  LEFT: 'ARROWLEFT',
  RIGHT: 'ARROWRIGHT',
  ESC: 'ESCAPE',
  RETURN: 'ENTER',
  SPACEBAR: 'SPACE',
  PLUS: '+',
  NUMDEC: '.',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, d) => [`NUM${String(d)}`, String(d)])),
};

/** A character typed with Shift on a US keyboard, as Electron reads it: "?" is Shift and "/". */
const SHIFTED: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
  '~': '`',
};

/**
 * A press on `platform`, however it is written (an Electron accelerator, or a keymap key through toAccelerator):
 * its modifiers, in any case and by any of their names, in one order, then its key by one name.
 */
function pressed(accelerator: string, platform: Platform): string {
  const parts = accelerator.split('+');
  const written = (parts.pop() ?? '').toUpperCase();
  const key = SAME_KEY[written] ?? written;
  const mods = new Set(parts.map((part) => MODIFIERS[part.toLowerCase()]?.(platform) ?? part));
  const unshifted = SHIFTED[key];
  if (unshifted !== undefined) mods.add('Shift');
  return [...[...mods].sort(), unshifted ?? key].join('+');
}

/** KeyboardEvent.key of a named key, by the one name pressed() gives it. */
const EVENT_KEY: Record<string, string> = {
  ARROWUP: 'ArrowUp',
  ARROWDOWN: 'ArrowDown',
  ARROWLEFT: 'ArrowLeft',
  ARROWRIGHT: 'ArrowRight',
  ESCAPE: 'Escape',
  ENTER: 'Enter',
  SPACE: ' ',
  TAB: 'Tab',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete',
  INSERT: 'Insert',
  HOME: 'Home',
  END: 'End',
  PAGEUP: 'PageUp',
  PAGEDOWN: 'PageDown',
};

/** What a key types with Shift on a US keyboard: "/" types "?". */
const TYPED_WITH_SHIFT: Record<string, string> = Object.fromEntries(
  Object.entries(SHIFTED).map(([typed, key]) => [key, typed]),
);

/**
 * A press (as pressed() writes it) as the page's keydown event has it, on a US keyboard: "Cmd+Shift+Z" is Z
 * with Cmd and Shift down, "Shift+/" is "?". The page's own keyMatches then says whether it answers the press.
 */
function eventFor(press: string): KeyInput {
  const parts = press.split('+');
  const key = parts.pop() ?? '';
  const shiftKey = parts.includes('Shift');
  const typed = shiftKey ? (TYPED_WITH_SHIFT[key] ?? key) : key;
  return {
    key: EVENT_KEY[typed] ?? typed,
    metaKey: parts.includes('Cmd'),
    ctrlKey: parts.includes('Ctrl'),
    altKey: parts.includes('Alt'),
    shiftKey,
  };
}

/** A key a menu shows: its item, the key as pressed, and whether that item answers it on this system. */
interface MenuKey {
  /** The item's id, or the role Electron gives the key to. */
  item: string;
  /** Where it is, for a failure's message: "View › Audience". */
  where: string;
  key: string;
  /** Told not to bind its key (registerAccelerator: false). */
  unbound: boolean;
  /** Answers its key: Windows' menu leaves an unbound key alone, and Electron has no such thing on the Mac. */
  answers: boolean;
}

/** Every key a menu shows, by an item's own accelerator, or else its role's. */
function keysOf(template: readonly MenuItemConstructorOptions[], platform: Platform): MenuKey[] {
  const found: MenuKey[] = [];
  const walk = (items: readonly MenuItemConstructorOptions[], under: string) => {
    for (const item of items) {
      const where = `${under}${item.label ?? item.role ?? item.id ?? ''}`;
      // Read as given: a key from a part this test does not name would be a stand-in, never a string.
      const accelerator: unknown = item.accelerator;
      if (accelerator !== undefined) expect(typeof accelerator, `${where}: its key, as given`).toBe('string');
      if (typeof accelerator === 'string') {
        const unbound = item.registerAccelerator === false;
        found.push({
          item: item.id ?? item.role ?? where,
          where,
          key: pressed(accelerator, platform),
          unbound,
          answers: !unbound || platform === 'darwin',
        });
      } else if (item.role !== undefined) {
        const role = ROLE_KEYS[item.role.toLowerCase()];
        expect(role, `the keys Electron gives the ${item.role} role`).toBeDefined();
        for (const [own, key] of role?.[platform] ?? [])
          found.push({
            item: own,
            where: `${where} › ${own}`,
            key: pressed(key, platform),
            unbound: false,
            answers: true,
          });
      }
      // Every submenu is read: a list of items, never something else this test would pass over.
      const submenu: unknown = item.submenu;
      if (submenu !== undefined) expect(Array.isArray(submenu), `${where}: its submenu, read`).toBe(true);
      if (Array.isArray(item.submenu)) walk(item.submenu, `${where} › `);
    }
  };
  walk(template, '');
  return found;
}

/**
 * Whatever a menu asks of a part this test does not name (a later session's): another stand-in, never a
 * key. So the menus still build as they grow, every key in them is checked all the same, and an item made
 * from such a part fails ("its key, as given") until the part is named here.
 */
const standIn: unknown = new Proxy(() => standIn, {
  get: (_target, key): unknown => {
    // Never a promise; in words, none; spread or gone through, one more stand-in, so a list of items made from it
    // holds an item whose key cannot be read, never an empty list passed over.
    if (key === 'then') return undefined;
    if (key === Symbol.iterator) return () => [standIn][Symbol.iterator]();
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
    screenSwitches: { on: { audience: true, stage: true }, toggle: () => undefined },
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

/**
 * The keys the window under each menu answers: Pro Mode's page and its lists (all but Undo, the menu's), Simple
 * Mode's page (Undo too: Put it back), and a node's, whose window answers none: the operators' keys all the same,
 * as an operator there would press them.
 */
const HEARD: Record<'pro' | 'simple' | 'node', readonly KeyBinding[]> = {
  pro: KEYMAP.filter((b) => b.menuOnly !== true),
  simple: SIMPLE_KEYMAP,
  node: KEYMAP.filter((b) => THEIRS.some((t) => t.action === b.action)),
};

interface BuiltMenu {
  menu: string;
  /** Main's, not a node's. */
  main: boolean;
  /** The keys its window answers. */
  heard: readonly KeyBinding[];
  template: MenuItemConstructorOptions[];
}

/**
 * Every menu Drashti can have on `platform`: Main's in each mode and a node's, diagnostics off and on.
 */
function everyMenu(platform: Platform): BuiltMenu[] {
  return on(platform, () => {
    const out: BuiltMenu[] = [];
    const take = (menu: string, heard: 'pro' | 'simple' | 'node') => {
      const template = menus.built.pop();
      expect(template, menu).toBeDefined();
      if (template) out.push({ menu, main: heard !== 'node', heard: HEARD[heard], template });
    };
    for (const diagnostics of [false, true]) {
      const also = diagnostics ? ', diagnostics on' : '';
      for (const mode of ['pro', 'simple'] as const) {
        installMenu(mainActions(mode, platform, diagnostics));
        take(`Main's menu in ${mode} mode${also}`, mode);
      }
      installNodeMenu(nodeActions(platform, diagnostics));
      take(`a node's menu${also}`, 'node');
    }
    return out;
  });
}

/** Every key every menu shows on `platform` (all six menus read), with the menu it is in. */
function everyKey(platform: Platform): (MenuKey & Omit<BuiltMenu, 'template'>)[] {
  const all = everyMenu(platform);
  expect(all).toHaveLength(6);
  return all.flatMap(({ template, ...menu }) => keysOf(template, platform).map((k) => ({ ...k, ...menu })));
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

/** Each line of code (not a comment) of the source files, with where it is. */
const codeLines = () =>
  sources(src).flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line, i) => ({ path, line, at: `${relative(src, path)}:${String(i + 1)} ${line.trim()}` }))
      .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/u.test(line)),
  );

/**
 * A line of code naming F12, or 1 or 2 as a key: in a string, alone or after modifiers, as an accelerator or a
 * keymap writes it ("F12", "Shift+F12", "CommandOrControl+1", "Ctrl+2"); as a key handler compares it (e.key,
 * e.code's "Digit1" and "Numpad1", the old key codes 123, 49 and 50); or as the slide editor's ProseMirror keymap
 * writes it ("Mod-1").
 */
const NAMES_THEM = [
  /['"`](?:[A-Za-z]+\+)*F12['"`]/u,
  /['"`](?:[A-Za-z]+\+)+[12]['"`]/u,
  /\b(?:Digit|Numpad)[12]\b/u,
  /\.key\b.*['"`][12]['"`]|['"`][12]['"`].*\.key\b/u,
  /\.(?:keyCode|which)\s*[!=]==?\s*(?:123|49|50)\b|\b(?:123|49|50)\s*[!=]==?\s*[\w.]+\.(?:keyCode|which)\b/u,
  /['"`](?:(?:Shift|Alt|Mod|Ctrl|Cmd|Meta)-)+[12]['"`]/u,
];

describe('one press, one action: the menus never answer a key the page answers (Sessions 50 and 51)', () => {
  it('has the operators’ keys in the keymap: F5 to F8, F12 for the Logo, Mod+1 and Mod+2 for the Audience and Stage screens', () => {
    for (const { key, action } of THEIRS)
      expect(KEYMAP.find((b) => b.action === action)?.keys, action).toContain(key);
  });

  it(`reads the roles’ keys from the Electron Drashti is built with (${String(ELECTRON_MAJOR)}.x)`, () => {
    const pkg = JSON.parse(readFileSync(join(src, '..', 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    // Its major only (as written, 44.4.5, or as a range, ^44.4.5): a patch keeps the roles' keys.
    const major = /^[\^~]?(\d+)\./u.exec(pkg.devDependencies?.['electron'] ?? '')?.[1];
    expect(
      major,
      'a new major of Electron: read its roles’ keys again (ROLE_KEYS), then say which major they are',
    ).toBe(String(ELECTRON_MAJOR));
  });

  it.each(PLATFORMS)(
    'no menu item answers a key the page answers, but that key’s own action’s item (%s)',
    (platform) => {
      const keys = everyKey(platform);
      // Every key is read: the menus' own (Undo, Reload, Uncover the controls) and their roles' (Copy, Minimize).
      const mod = platform === 'darwin' ? 'Cmd' : 'Ctrl';
      expect(keys.map((k) => k.key)).toEqual(
        expect.arrayContaining([`${mod}+Z`, `${mod}+R`, `${mod}+Shift+U`, `${mod}+C`, `${mod}+M`]),
      );
      // Each key a menu answers, pressed: the page's own keyMatches says what its window does with it.
      const twice = keys
        .filter((k) => k.answers)
        .flatMap(({ menu, heard, item, where, key }) => {
          const action = actionFor(eventFor(key), platform, heard);
          return action && !(OWN[action] ?? []).includes(item)
            ? [`${menu}: ${where} answers ${key}, which the page answers too (${action})`]
            : [];
        });
      expect(twice).toEqual([]);
    },
  );

  it.each(PLATFORMS)(
    'Audience and Stage show Mod+1 and Mod+2 unbound, the page’s keys: Windows leaves them to the page, and on the Mac the page takes every press of them first (%s)',
    (platform) => {
      const keys = everyKey(platform);
      const unbound = keys.filter((k) => k.unbound);
      // In Main's Pro Mode menu, diagnostics off and on.
      expect(unbound.map((k) => `${k.where} ${k.key}`).sort()).toEqual(
        Array.from({ length: 2 }, () => [
          `View › Audience ${pressed(toAccelerator('Mod+1'), platform)}`,
          `View › Stage ${pressed(toAccelerator('Mod+2'), platform)}`,
        ])
          .flat()
          .sort(),
      );
      for (const k of unbound) {
        // Its own action's key, which the page takes every press of (on the Mac the menu binds it all the same).
        const action = actionFor(eventFor(k.key), platform);
        const binding = KEYMAP.find((b) => b.action === action && (OWN[b.action] ?? []).includes(k.item));
        expect(binding, `${k.where}: its own action’s key`).toBeDefined();
        expect(binding?.shownInMenu, `${k.where}: the page takes every press of ${k.key}`).toBe(true);
        expect(binding?.menuOnly, `${k.where}: the page’s key`).toBeUndefined();
        expect(k.answers).toBe(platform === 'darwin');
      }
    },
  );

  it.each(PLATFORMS)(
    'the keys the page leaves to the menu are its own items’, in Pro and Simple Mode: Edit › Undo’s Mod+Z (%s)',
    (platform) => {
      const left = KEYMAP.filter((b) => b.menuOnly === true);
      expect(left.length).toBeGreaterThan(0);
      for (const { menu, template } of everyMenu(platform).filter((m) => m.main)) {
        const answered = keysOf(template, platform).filter((k) => k.answers);
        for (const b of left)
          expect(
            answered.some(
              (a) =>
                (OWN[b.action] ?? []).includes(a.item) &&
                actionFor(eventFor(a.key), platform, [b]) === b.action,
            ),
            `${menu}: ${b.label} answered by its own item`,
          ).toBe(true);
      }
    },
  );

  it('none of the operators’ keys works system-wide (Windows keeps F12 for debuggers: it is never a system-wide key)', () => {
    const global = KEYMAP.filter((b) => b.global === true).flatMap((b) => b.keys);
    expect(global.length).toBeGreaterThan(0);
    expect(global.filter((key) => THEIRS.some((t) => t.key === key))).toEqual([]);
  });

  it('builds every menu in menu.ts, read here, and registers no system-wide key but the keymap’s', () => {
    // Only the main process can make a menu or a system-wide key (a page cannot import Electron).
    const main = join(src, 'main');
    const menuFile = join(main, 'menu.ts');
    const builds = /\b(?:buildFromTemplate|setApplicationMenu|new MenuItem)\b|\.setMenu\(/u;
    // globalShortcut is given the keymap's keys (acceleratorFor), never one written out.
    const writesOut = /globalShortcut\.register(?:All)?\(\s*['"`[]/u;
    const found = codeLines()
      .filter(({ path }) => path.startsWith(`${main}${sep}`))
      .filter(({ path, line }) => (builds.test(line) && path !== menuFile) || writesOut.test(line))
      .map(({ at }) => at);
    expect(found).toEqual([]);
  });

  it('fails on a list of items made from a part it does not name, never passing it over', () => {
    // A later session's part, say a list of items the menu spreads in: one stand-in, whose key cannot be read.
    const later = standIn as { items: readonly MenuItemConstructorOptions[] };
    expect(() => keysOf([{ label: 'Later', submenu: [...later.items] }], 'darwin')).toThrow(
      /its key, as given/u,
    );
  });

  it('the code check reads every way a line can name F12, or 1 or 2 as a key', () => {
    const names = (line: string) => NAMES_THEM.some((n) => n.test(line));
    for (const line of [
      "if (e.key === 'F12') toggle();",
      "{ label: 'Logo', accelerator: 'Shift+F12' }",
      "globalShortcut.register('CommandOrControl+1', turn);",
      "{ label: 'Stage', accelerator: 'CmdOrCtrl+2' }",
      "{ accelerator: 'Ctrl+1' }",
      "if (input.control && input.key === '1') turn();",
      "if (e.code === 'Digit2' || e.code === 'Numpad2') turn();",
      'if (event.keyCode === 123) return;',
      'if (49 === e.which) turn();',
      "keys: { 'Mod-1': heading }",
    ])
      expect(names(line), line).toBe(true);
    for (const line of [
      'const step = 1;',
      'items.slice(0, 2)',
      "accelerator: 'F11'",
      "padStart(2, '0')",
      "const version = '1.2';",
      'width: 123,',
    ])
      expect(names(line), line).toBe(false);
  });

  it('no window’s own key handler answers F12, or 1 or 2 with Cmd or Ctrl: only the keymap names them', () => {
    const keymap = join(src, 'shared', 'keymap.ts');
    const found = codeLines()
      .filter(({ path, line }) => path !== keymap && NAMES_THEM.some((names) => names.test(line)))
      .map(({ at }) => at);
    expect(found).toEqual([]);
  });
});
