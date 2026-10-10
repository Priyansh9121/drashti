import { describe, expect, it } from 'vitest';
import {
  acceleratorFor,
  actionFor,
  KEY_GROUPS,
  KEYMAP,
  keyMatches,
  keyText,
  shortcutText,
  toAccelerator,
} from './keymap';

const press = (
  key: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('keymap', () => {
  it('uses each key for at most one action', () => {
    const seen = new Map<string, string>();
    for (const b of KEYMAP) {
      for (const k of b.keys) {
        expect(seen.get(k.toUpperCase()), `${k} is bound twice`).toBeUndefined();
        seen.set(k.toUpperCase(), b.action);
      }
    }
  });

  it('moves with the arrow keys, space and page keys', () => {
    for (const key of ['ArrowRight', 'ArrowDown', ' ', 'PageDown'])
      expect(actionFor(press(key), 'darwin')).toBe('next');
    for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp'])
      expect(actionFor(press(key), 'win32')).toBe('previous');
  });

  it('jumps playlist items with Shift and an arrow key', () => {
    expect(actionFor(press('ArrowRight', { shiftKey: true }), 'darwin')).toBe('nextItem');
    expect(actionFor(press('ArrowDown', { shiftKey: true }), 'win32')).toBe('nextItem');
    expect(actionFor(press('ArrowLeft', { shiftKey: true }), 'darwin')).toBe('previousItem');
    expect(actionFor(press('ArrowUp', { shiftKey: true }), 'win32')).toBe('previousItem');
    expect(shortcutText('nextItem', 'darwin')).toBe('⇧→');
    expect(shortcutText('previousItem', 'win32')).toBe('Shift+←');
  });

  it('shows and hides the logo with L', () => {
    expect(actionFor(press('l'), 'darwin')).toBe('toggleLogo');
    expect(actionFor(press('L', { shiftKey: true }), 'win32')).toBe('toggleLogo');
  });

  it('maps the clear keys and black-out', () => {
    expect(actionFor(press('F1'), 'darwin')).toBe('clearAll');
    expect(actionFor(press('F2'), 'darwin')).toBe('clearSlide');
    expect(actionFor(press('b'), 'win32')).toBe('toggleBlackout');
    expect(actionFor(press('B', { shiftKey: true }), 'win32')).toBe('toggleBlackout');
    expect(actionFor(press('.'), 'darwin')).toBe('toggleBlackout');
  });

  it('respects modifiers', () => {
    expect(actionFor(press('ArrowRight', { metaKey: true }), 'darwin')).toBeNull();
    expect(actionFor(press(' ', { shiftKey: true }), 'darwin')).toBeNull();
    expect(actionFor(press('b', { ctrlKey: true }), 'win32')).toBeNull();
    expect(actionFor(press('S', { metaKey: true, shiftKey: true }), 'darwin')).toBe('openScreens');
    expect(actionFor(press('S', { ctrlKey: true, shiftKey: true }), 'win32')).toBe('openScreens');
    expect(actionFor(press('S', { ctrlKey: true, shiftKey: true }), 'darwin')).toBeNull();
    expect(keyMatches(press('x'), 'X', 'darwin')).toBe(true);
  });

  it('ignores keys that are not bound', () => {
    expect(actionFor(press('q'), 'darwin')).toBeNull();
    expect(actionFor(press('Enter'), 'darwin')).toBeNull();
  });

  it('describes shortcuts for people', () => {
    expect(shortcutText('next', 'darwin')).toBe('→');
    expect(shortcutText('clearSlide', 'win32')).toBe('F2');
    expect(shortcutText('toggleBlackout', 'darwin')).toBe('B');
    expect(shortcutText('openScreens', 'darwin')).toBe('⌘⇧S');
    expect(shortcutText('openScreens', 'win32')).toBe('Ctrl+Shift+S');
  });

  it('has an uncover shortcut that also works outside the app', () => {
    const b = KEYMAP.find((x) => x.action === 'uncoverControls');
    expect(b?.global).toBe(true);
    expect(actionFor(press('u', { metaKey: true, shiftKey: true }), 'darwin')).toBe('uncoverControls');
    expect(actionFor(press('U', { ctrlKey: true, shiftKey: true }), 'win32')).toBe('uncoverControls');
    expect(acceleratorFor('uncoverControls')).toBe('CommandOrControl+Shift+U');
  });

  it('turns bindings into Electron accelerators', () => {
    expect(toAccelerator('Mod+Shift+S')).toBe('CommandOrControl+Shift+S');
    expect(toAccelerator('F2')).toBe('F2');
    expect(acceleratorFor('next')).toBe('ArrowRight');
  });

  // The keys sheet (Help > Keyboard Shortcuts…, Session 25) is built from KEYMAP, grouped by what the
  // operator is doing: every action once, so it can never drift from the keys.
  it('puts every action in the keys sheet, once, and nothing that is not a key', () => {
    const listed = KEY_GROUPS.flatMap((g) => g.actions);
    expect([...listed].sort()).toEqual(KEYMAP.map((b) => b.action).sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const g of KEY_GROUPS) expect(g.actions.length).toBeGreaterThan(0);
  });

  it('writes each key as the computer shows it', () => {
    expect(keyText('Mod+F', 'darwin')).toBe('⌘F');
    expect(keyText('Mod+F', 'win32')).toBe('Ctrl+F');
    expect(keyText('Alt+ArrowUp', 'darwin')).toBe('⌥↑');
    expect(keyText('Alt+ArrowUp', 'win32')).toBe('Alt+↑');
    expect(keyText('PageDown', 'win32')).toBe('Page Down');
    expect(keyText('?', 'darwin')).toBe('?');
    expect(actionFor(press('?', { shiftKey: true }), 'darwin')).toBe('showKeys');
  });
});
