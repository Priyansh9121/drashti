import { describe, expect, it, vi } from 'vitest';
import { accessListBounds, ownWindowKey } from './access-list-window';

/*
 * The Access List's window (Session 54, E4): the keys it keeps from the application menu, whose Undo and Redo act
 * on the operator window (a removal undone there, from a key pressed while typing a Gmail here), and its size.
 */

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), app: { isPackaged: false } }));

const press = (
  key: string,
  o: { meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean } = {},
) => ({
  type: 'keyDown' as const,
  key,
  meta: o.meta ?? false,
  control: o.control ?? false,
  alt: o.alt ?? false,
  shift: o.shift ?? false,
});

describe('the Access List’s own keys', () => {
  it('on a Mac: ⌘Z and ⇧⌘Z undo and redo here, ⌘W closes it, and ⌘1 and ⌘2 stop here', () => {
    expect(ownWindowKey(press('z', { meta: true }), 'darwin')).toBe('undo');
    expect(ownWindowKey(press('Z', { meta: true, shift: true }), 'darwin')).toBe('redo');
    expect(ownWindowKey(press('w', { meta: true }), 'darwin')).toBe('close');
    expect(ownWindowKey(press('1', { meta: true }), 'darwin')).toBe('stop');
    expect(ownWindowKey(press('2', { meta: true }), 'darwin')).toBe('stop');
    // Everything else goes on to the page and the menu as before: typing, copying, pasting, choosing all.
    for (const other of [
      press('z'),
      press('z', { control: true }),
      press('z', { meta: true, alt: true }),
      press('c', { meta: true }),
      press('v', { meta: true }),
      press('a', { meta: true }),
      press('y', { meta: true }),
    ])
      expect(ownWindowKey(other, 'darwin'), JSON.stringify(other)).toBeNull();
    expect(ownWindowKey({ ...press('z', { meta: true }), type: 'keyUp' }, 'darwin')).toBeNull();
  });

  it('on Windows: Ctrl+Z undoes here, Ctrl+Y and Ctrl+Shift+Z redo here, and Ctrl+W is the menu’s Close', () => {
    expect(ownWindowKey(press('z', { control: true }), 'win32')).toBe('undo');
    expect(ownWindowKey(press('y', { control: true }), 'win32')).toBe('redo');
    expect(ownWindowKey(press('Z', { control: true, shift: true }), 'win32')).toBe('redo');
    expect(ownWindowKey(press('1', { control: true }), 'win32')).toBe('stop');
    expect(ownWindowKey(press('w', { control: true }), 'win32')).toBeNull();
    expect(ownWindowKey(press('z', { meta: true }), 'win32')).toBeNull();
    expect(ownWindowKey(press('c', { control: true }), 'win32')).toBeNull();
  });
});

describe('the Access List’s size', () => {
  it('opens at 1280 × 800 in the middle of the controls’ display, or as large as its work area where smaller', () => {
    expect(accessListBounds({ x: 0, y: 25, width: 1920, height: 1055 })).toEqual({
      x: 320,
      y: 153,
      width: 1280,
      height: 800,
    });
    // CI's displays: 1024 wide.
    expect(accessListBounds({ x: 0, y: 0, width: 1024, height: 645 })).toEqual({
      x: 0,
      y: 0,
      width: 1024,
      height: 645,
    });
    expect(accessListBounds({ x: -1440, y: 0, width: 1440, height: 875 })).toEqual({
      x: -1360,
      y: 38,
      width: 1280,
      height: 800,
    });
  });
});
