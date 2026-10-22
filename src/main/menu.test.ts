import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { KEYMAP, toAccelerator } from '../shared/keymap';
import type { ScreenSwitch } from '../shared/screen-switches';
import { installMenu, type MenuActions } from './menu';

/*
 * View › Audience and View › Stage (Session 50): Pro Mode's, ticked while on, each choosing its own switch. They
 * show Mod+1 and Mod+2 (Session 51: ⌘1 and ⌘2, Ctrl+1 and Ctrl+2), the page's keys (shared/keymap.ts), without
 * binding them, so one press is acted on once, by the page, never by the menu as well: Windows' menu leaves a key
 * it shows unbound (registerAccelerator: false), and on the Mac, whose menu acts on any key it shows that the page
 * leaves alone, the page takes every press of them. Built as on the Mac and as on Windows; Electron's menu is
 * stood in for.
 */

const built: MenuItemConstructorOptions[][] = [];
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.push(template);
      return {};
    },
    setApplicationMenu: () => undefined,
  },
}));

const nothing = () => undefined;

function actions(mode: 'pro' | 'simple', on = { audience: true, stage: true }) {
  const chosen: ScreenSwitch[] = [];
  const a: MenuActions = {
    mode,
    switchMode: nothing,
    setUpScreens: nothing,
    zoomWindow: nothing,
    reloadOperator: nothing,
    undo: { accelerator: 'CommandOrControl+Z', run: nothing },
    redo: { run: nothing },
    uncoverControls: { accelerator: 'CommandOrControl+Shift+U', run: nothing },
    saveDiagnostics: nothing,
    importFromLink: nothing,
    backUpLibrary: nothing,
    restoreLibrary: nothing,
    useAsNode: nothing,
    rolesAndPins: nothing,
    scheduledBackups: nothing,
    eventsOut: nothing,
    dropFolder: nothing,
    checkForUpdates: nothing,
    keyboardShortcuts: nothing,
    guides: nothing,
    priority: null,
    extras: { shown: false, toggle: nothing },
    safeAreas: { shown: false, toggle: nothing },
    appearance: { choices: [], chosen: 'follow', choose: nothing, open: nothing },
    screenSwitches: {
      on,
      toggle: (which) => {
        chosen.push(which);
      },
    },
    diagnostics: null,
  };
  return { a, chosen };
}

/** Every item of the menu last built, submenus included. */
function items(): MenuItemConstructorOptions[] {
  const all: MenuItemConstructorOptions[] = [];
  const walk = (list: MenuItemConstructorOptions[]) => {
    for (const item of list) {
      all.push(item);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(built.at(-1) ?? []);
  return all;
}

const item = (id: string) => items().find((i) => i.id === id);

const PLATFORMS = ['darwin', 'win32'] as const;

/** `run` as on `platform`: the menu asks process.platform as it is built. */
function on<T>(platform: (typeof PLATFORMS)[number], run: () => T): T {
  const was = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return run();
  } finally {
    if (was) Object.defineProperty(process, 'platform', was);
  }
}

describe('View › Audience and Stage (Session 50)', () => {
  it.each(PLATFORMS)(
    'are in Pro Mode’s View menu, ticked as they stand, each choosing its own switch (%s)',
    (platform) => {
      const { chosen } = on(platform, () => setUp('pro', { audience: false, stage: true }));
      const view = built.at(-1)?.find((m) => m.label === 'View')?.submenu;
      const ids = Array.isArray(view) ? view.map((i) => i.id) : [];
      expect(ids).toContain('screen-switch-audience');
      expect(ids).toContain('screen-switch-stage');
      expect(item('screen-switch-audience')).toMatchObject({
        label: 'Audience',
        type: 'checkbox',
        checked: false,
      });
      expect(item('screen-switch-stage')).toMatchObject({ label: 'Stage', type: 'checkbox', checked: true });
      const click = (id: string) => {
        const c = item(id)?.click as ((...args: unknown[]) => void) | undefined;
        c?.();
      };
      click('screen-switch-stage');
      click('screen-switch-audience');
      expect(chosen).toEqual(['stage', 'audience']);
    },
  );

  // Session 51 (S2-6): the View menu shows the keys. menu-keys.test.ts checks no other item answers them.
  it.each(PLATFORMS)(
    'show the keymap’s Mod+1 and Mod+2 (⌘1 and ⌘2, Ctrl+1 and Ctrl+2) without binding them; the page takes every press of them (%s)',
    (platform) => {
      on(platform, () => setUp('pro'));
      expect(item('screen-switch-audience')).toMatchObject({
        accelerator: 'CommandOrControl+1',
        registerAccelerator: false,
      });
      expect(item('screen-switch-stage')).toMatchObject({
        accelerator: 'CommandOrControl+2',
        registerAccelerator: false,
      });
      for (const [id, action] of [
        ['screen-switch-audience', 'toggleAudience'],
        ['screen-switch-stage', 'toggleStage'],
      ] as const) {
        const binding = KEYMAP.find((b) => b.action === action);
        // The keymap's own key, and still the page's: never left to the menu.
        expect(item(id)?.accelerator).toBe(toAccelerator(binding?.keys[0] ?? ''));
        expect(binding?.menuOnly).toBeUndefined();
        // The Mac's menu binds every key it shows, so the page takes every press of these first.
        expect(binding?.shownInMenu).toBe(true);
      }
    },
  );

  it.each(PLATFORMS)(
    'are not in Simple Mode’s menu, where they could only be turned on (its status bar does that) (%s)',
    (platform) => {
      on(platform, () => setUp('simple', { audience: false, stage: false }));
      expect(item('screen-switch-audience')).toBeUndefined();
      expect(item('screen-switch-stage')).toBeUndefined();
    },
  );
});

function setUp(mode: 'pro' | 'simple', on = { audience: true, stage: true }) {
  const made = actions(mode, on);
  installMenu(made.a);
  return made;
}
