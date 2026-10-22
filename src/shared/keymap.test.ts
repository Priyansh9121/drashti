import { describe, expect, it } from 'vitest';
import {
  acceleratorFor,
  actionFor,
  KEY_GROUPS,
  KEYMAP,
  keyMatches,
  keyText,
  PAGE_KEYMAP,
  shortcutText,
  SIMPLE_KEYMAP,
  SINGLE_KEYS,
  toAccelerator,
  withoutSingleKeys,
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

  // Session 50: the keys the mandir's operators already press (their Presentation and Screens menus, seen 22 Oct
  // 2026). F5 and F6, and F7 and F8, changed places from Drashti's own; F12 is the logo beside L; Mod+1 and
  // Mod+2 turn the Audience and Stage screens off and on.
  it('uses the keys the operators already press', () => {
    const at = (key: string) => actionFor(press(key), 'win32');
    expect([at('F1'), at('F2'), at('F3'), at('F4')]).toEqual([
      'clearAll',
      'clearSlide',
      'clearBackground',
      'clearProps',
    ]);
    expect(at('F5')).toBe('clearAudio');
    expect(at('F6')).toBe('clearMessages');
    expect(at('F7')).toBe('clearTicker');
    expect(at('F8')).toBe('clearMasks');
    expect(at('F12')).toBe('toggleLogo');
    expect(actionFor(press('l'), 'darwin')).toBe('toggleLogo');
    expect(actionFor(press('1', { metaKey: true }), 'darwin')).toBe('toggleAudience');
    expect(actionFor(press('2', { metaKey: true }), 'darwin')).toBe('toggleStage');
    expect(actionFor(press('1', { ctrlKey: true }), 'win32')).toBe('toggleAudience');
    expect(actionFor(press('2', { ctrlKey: true }), 'win32')).toBe('toggleStage');
    // Not asked: Alt+← and Alt+→ and Mod+0 stay free, and a plain 1 or 2 does nothing.
    expect(actionFor(press('ArrowLeft', { altKey: true }), 'win32')).toBeNull();
    expect(actionFor(press('ArrowRight', { altKey: true }), 'darwin')).toBeNull();
    expect(actionFor(press('0', { metaKey: true }), 'darwin')).toBeNull();
    expect(actionFor(press('1'), 'darwin')).toBeNull();
    expect(shortcutText('toggleAudience', 'darwin')).toBe('⌘1');
    expect(shortcutText('toggleStage', 'win32')).toBe('Ctrl+2');
    expect(shortcutText('toggleLogo', 'win32')).toBe('F12');
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

  // WCAG 2.1.4 (Session 37): a key of one character with no Cmd, Ctrl or Alt acts on its own, so an admin
  // can turn them off. A new one must be added here on purpose: the switch names them.
  it('knows its single-letter keys: B, ., L and ?, and only those', () => {
    expect(SINGLE_KEYS).toEqual(['B', '.', 'L', '?']);
  });

  it('without its single-letter keys, B, ., L and ? do nothing, in Pro and Simple Mode, and every other key works', () => {
    for (const [keymap, platform] of [
      [withoutSingleKeys(PAGE_KEYMAP), 'darwin'],
      [withoutSingleKeys(SIMPLE_KEYMAP), 'win32'],
    ] as const) {
      expect(actionFor(press('b'), platform, keymap)).toBeNull();
      expect(actionFor(press('B', { shiftKey: true }), platform, keymap)).toBeNull();
      expect(actionFor(press('.'), platform, keymap)).toBeNull();
      expect(actionFor(press('l'), platform, keymap)).toBeNull();
      expect(actionFor(press('?', { shiftKey: true }), platform, keymap)).toBeNull();
      expect(actionFor(press('ArrowRight'), platform, keymap)).toBe('next');
      expect(actionFor(press('PageUp'), platform, keymap)).toBe('previous');
      expect(actionFor(press(' '), platform, keymap)).toBe('next');
      expect(actionFor(press('F1'), platform, keymap)).toBe('clearAll');
      // The logo keeps F12 (Session 50): a named key, never acted on by a word said.
      expect(actionFor(press('F12'), platform, keymap)).toBe('toggleLogo');
      expect(actionFor(press('Escape'), platform, keymap)).toBe('stopRepeat');
    }
    // Keys with Cmd or Ctrl stay: they never act by a word said or a key brushed.
    const pro = withoutSingleKeys(PAGE_KEYMAP);
    expect(actionFor(press('f', { metaKey: true }), 'darwin', pro)).toBe('findInLibrary');
    expect(actionFor(press('U', { ctrlKey: true, shiftKey: true }), 'win32', pro)).toBe('uncoverControls');
    // What the window shows beside a button follows: no key for Black-out or the list of keys, and F12 for the
    // Logo.
    const all = withoutSingleKeys(KEYMAP);
    expect(shortcutText('toggleBlackout', 'darwin', all)).toBe('');
    expect(shortcutText('toggleLogo', 'win32', all)).toBe('F12');
    expect(shortcutText('showKeys', 'darwin', all)).toBe('');
    expect(shortcutText('next', 'darwin', all)).toBe('→');
    expect(shortcutText('clearAll', 'win32', all)).toBe('F1');
  });

  it('leaves a keymap without single-letter keys as it was, binding for binding', () => {
    const library = KEYMAP.filter((b) => b.scope === 'library');
    expect(withoutSingleKeys(library)).toEqual(library);
    // The Logo keeps its binding with F12 alone (Session 50); every other binding is as it was.
    const logo = KEYMAP.find((b) => b.action === 'toggleLogo');
    for (const b of withoutSingleKeys(KEYMAP))
      if (b.action === 'toggleLogo') expect(b).toEqual({ ...logo, keys: ['F12'] });
      else expect(KEYMAP).toContain(b);
    expect(withoutSingleKeys(KEYMAP).map((b) => b.action)).toEqual(
      KEYMAP.filter((b) => !['toggleBlackout', 'showKeys'].includes(b.action)).map((b) => b.action),
    );
  });
});
