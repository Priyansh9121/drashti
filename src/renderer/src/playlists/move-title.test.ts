import { describe, expect, it } from 'vitest';
import { moveTitle } from './move-title';

/*
 * The chosen playlist item's Up and Down say their key as this computer writes it (alpha.24, keyplat's words folded into
 * uitop; the owner: "shortcuts should be adaptable to mac, mac intel, and windows"): ⌥↑ on a Mac, Alt+↑ on Windows.
 */
describe('Up and Down a place', () => {
  it('name their key in the Mac’s way on a Mac (Intel too) and in Windows’ way on Windows', () => {
    expect(moveTitle(-1, 'darwin')).toBe('Up a place (⌥↑)');
    expect(moveTitle(1, 'darwin')).toBe('Down a place (⌥↓)');
    expect(moveTitle(-1, 'win32')).toBe('Up a place (Alt+↑)');
    expect(moveTitle(1, 'win32')).toBe('Down a place (Alt+↓)');
  });
});
