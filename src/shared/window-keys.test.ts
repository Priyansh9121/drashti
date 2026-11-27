import { describe, expect, it } from 'vitest';
import { KEYMAP, keyText } from './keymap';
import { editorKeys, KEY_WINDOWS, keysOn, WINDOW_KEYS } from './window-keys';

/*
 * Every Drashti window's own keys (alpha.24: the manual's "Every other window’s keys", written from WINDOW_KEYS and
 * checked by src/main/keys-manual.test.ts), and how each computer writes the keys they hold: Apple silicon and Intel
 * Macs alike (both darwin), and Windows.
 */

describe('every window’s own keys', () => {
  it('are each in a window the manual has a section for, once each, with a key or a word that there is none', () => {
    const seen = new Set<string>();
    for (const e of WINDOW_KEYS) {
      expect(KEY_WINDOWS, e.what).toContain(e.window);
      const id = `${e.window} › ${e.what}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
      expect(keysOn(e, 'win32').length + keysOn(e, 'darwin').length, id).toBeGreaterThan(0);
      // Words people read: typographic apostrophes, no full stop at the end.
      expect(e.what, id).not.toMatch(/'|\.$/u);
    }
    // Every section holds keys of its own (the operator window's besides KEYMAP's show keys).
    for (const w of KEY_WINDOWS)
      expect(
        WINDOW_KEYS.some((e) => e.window === w),
        w,
      ).toBe(true);
    expect(KEYMAP.length).toBeGreaterThan(0);
  });

  it('writes the keys of the other windows as each computer shows them', () => {
    expect(keyText('Escape', 'darwin')).toBe('Esc');
    expect(keyText('Escape', 'win32')).toBe('Esc');
    expect(keyText('Enter', 'win32')).toBe('Enter');
    expect(keyText('Enter', 'darwin')).toBe('↩');
    expect(keyText('Mod+Enter', 'darwin')).toBe('⌘↩');
    expect(keyText('Mod+Enter', 'win32')).toBe('Ctrl+Enter');
    expect(keyText('Shift+Enter', 'darwin')).toBe('⇧↩');
    expect(keyText('ContextMenu', 'win32')).toBe('Menu');
    // A modifier held on its own (while dragging, or with the arrows).
    expect(keyText('Alt', 'darwin')).toBe('⌥');
    expect(keyText('Alt', 'win32')).toBe('Alt');
    expect(keyText('Shift', 'darwin')).toBe('⇧');
    expect(keyText('Shift', 'win32')).toBe('Shift');
    expect(keyText('Mod+=', 'darwin')).toBe('⌘=');
    expect(keyText('Mod+-', 'win32')).toBe('Ctrl+-');
    expect(keyText('Ctrl+Mod+F', 'darwin')).toBe('⌃⌘F');
    expect(keyText('Mod+Alt+H', 'darwin')).toBe('⌥⌘H');
    expect(keyText('Alt+F4', 'win32')).toBe('Alt+F4');
  });

  // The slide editor's buttons and tooltips show its keys from WINDOW_KEYS' own list (keyplat R5: "Back out" said ⇧Tab
  // on Windows, which writes Shift+Tab).
  it('gives the slide editor’s buttons their keys as each computer writes them', () => {
    const shown = (name: Parameters<typeof editorKeys>[0], platform: string) =>
      keyText(editorKeys(name, platform)[0] ?? '', platform);
    expect(shown('outdent', 'win32')).toBe('Shift+Tab');
    expect(shown('outdent', 'darwin')).toBe('⇧Tab');
    expect(shown('indent', 'win32')).toBe('Tab');
    expect(shown('save', 'darwin')).toBe('⌘S');
    expect(shown('save', 'win32')).toBe('Ctrl+S');
    expect(shown('find', 'win32')).toBe('Ctrl+F');
    expect(shown('undo', 'darwin')).toBe('⌘Z');
    expect(shown('redo', 'darwin')).toBe('⇧⌘Z');
    expect(shown('redo', 'win32')).toBe('Ctrl+Y');
  });
});
