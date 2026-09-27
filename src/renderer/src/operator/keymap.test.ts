import { describe, expect, it } from 'vitest';
import { actionFor, KEYMAP, keyMatches, shortcutText } from './keymap';

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
});
