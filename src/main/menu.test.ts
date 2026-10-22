import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { KEYMAP, toAccelerator } from '../shared/keymap';
import type { ScreenSwitch } from '../shared/screen-switches';
import { installMenu, type MenuActions } from './menu';

/*
 * View › Audience and View › Stage (Session 50): Pro Mode's, ticked while on, each choosing its own switch. They
 * carry no accelerator: Mod+1 and Mod+2 are the page's keys (shared/keymap.ts), so one press is acted on once,
 * by the page, and never by the menu as well (Electron hands the menu every key the page leaves alone, a field
 * or a dialog having the keyboard included). Electron's menu is stood in for.
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

describe('View › Audience and Stage (Session 50)', () => {
  it('are in Pro Mode’s View menu, ticked as they stand, each choosing its own switch', () => {
    const { chosen } = setUp('pro', { audience: false, stage: true });
    const view = built.at(-1)?.find((m) => m.label === 'View');
    const ids = Array.isArray(view?.submenu) ? view.submenu.map((i) => i.id) : [];
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
  });

  it('carry no accelerator, and no item has Mod+1 or Mod+2: the page acts on each press once', () => {
    setUp('pro');
    expect(item('screen-switch-audience')?.accelerator).toBeUndefined();
    expect(item('screen-switch-stage')?.accelerator).toBeUndefined();
    const keys = KEYMAP.filter((b) => b.action === 'toggleAudience' || b.action === 'toggleStage').flatMap(
      (b) => b.keys.map(toAccelerator),
    );
    expect(keys).toEqual(['CommandOrControl+1', 'CommandOrControl+2']);
    const taken = items().flatMap((i) => (typeof i.accelerator === 'string' ? [i.accelerator] : []));
    for (const key of [...keys, 'CmdOrCtrl+1', 'CmdOrCtrl+2']) expect(taken).not.toContain(key);
  });

  it('are not in Simple Mode’s menu, where they could only be turned on (its status bar does that)', () => {
    setUp('simple', { audience: false, stage: false });
    expect(item('screen-switch-audience')).toBeUndefined();
    expect(item('screen-switch-stage')).toBeUndefined();
  });
});

function setUp(mode: 'pro' | 'simple', on = { audience: true, stage: true }) {
  const made = actions(mode, on);
  installMenu(made.a);
  return made;
}
