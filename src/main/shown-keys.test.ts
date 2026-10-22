import { describe, expect, it } from 'vitest';
import { choiceGuard, isShownMenuKey, REPEAT_CHOICE_MS } from './shown-keys';

/*
 * ⌘1 and ⌘2 beside View › Audience and Stage (Session 51), away from the operator window, which takes every press
 * of them itself. A Mac menu acts on any key it shows that a page leaves alone: Window for Zoom…, whose page has no
 * keys, stops them before its page and the menu see them (isShownMenuKey, for its before-input-event); and a choice
 * of Audience or Stage within 0.7 s of the last is a held key repeating (under one of the system's own boxes the
 * Mac's menu still answers them), let go by (choiceGuard).
 */

type Mods = Partial<{ meta: boolean; control: boolean; alt: boolean; shift: boolean }>;

/** A key press as Electron's before-input-event gives it. */
const input = (key: string, mods: Mods = {}, type = 'keyDown') => ({
  type,
  key,
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...mods,
});

describe('the keys the View menu shows, pressed in a window with no keys of its own', () => {
  it('are ⌘1 and ⌘2 on the Mac, Ctrl+1 and Ctrl+2 on Windows, going down (a held key’s repeats too)', () => {
    expect(isShownMenuKey(input('1', { meta: true }), 'darwin')).toBe(true);
    expect(isShownMenuKey(input('2', { meta: true }), 'darwin')).toBe(true);
    expect(isShownMenuKey(input('1', { control: true }), 'win32')).toBe(true);
    expect(isShownMenuKey(input('2', { control: true }), 'win32')).toBe(true);
    // A digit matches with Shift or without, as the window's own keys do: some keyboards need Shift for digits.
    expect(isShownMenuKey(input('1', { meta: true, shift: true }), 'darwin')).toBe(true);
  });

  it('are no other press: not a key let go, not 1 or 2 alone or with the other system’s key, not another key of the show’s or the menu’s', () => {
    expect(isShownMenuKey(input('1', { meta: true }, 'keyUp'), 'darwin')).toBe(false);
    expect(isShownMenuKey(input('1'), 'darwin')).toBe(false);
    expect(isShownMenuKey(input('1', { control: true }), 'darwin')).toBe(false);
    expect(isShownMenuKey(input('1', { meta: true }), 'win32')).toBe(false);
    expect(isShownMenuKey(input('1', { meta: true, alt: true }), 'darwin')).toBe(false);
    for (const key of ['3', '0', 'F12', 'F1', 'b', 'ArrowRight'])
      expect(isShownMenuKey(input(key, { meta: true }), 'darwin'), key).toBe(false);
    expect(isShownMenuKey(input('F12'), 'darwin')).toBe(false);
    // Reload (Cmd+R) and Uncover the controls (Cmd+Shift+U), the menu's own keys, go on to it.
    expect(isShownMenuKey(input('r', { meta: true }), 'darwin')).toBe(false);
    expect(isShownMenuKey(input('U', { meta: true, shift: true }), 'darwin')).toBe(false);
  });
});

describe('Audience or Stage chosen from the menu again within 0.7 s', () => {
  it('is a held key repeating, let go by however long it is held; a choice after a pause acts', () => {
    let now = 1_000_000;
    const acts = choiceGuard(REPEAT_CHOICE_MS, () => now);
    expect(acts()).toBe(true);
    // Held: the first repeat after the system's delay, then one every 30 ms for three seconds.
    const repeats: boolean[] = [];
    now += 250;
    repeats.push(acts());
    for (let i = 0; i < 100; i++) {
      now += 30;
      repeats.push(acts());
    }
    expect(repeats.filter((act) => act)).toEqual([]);
    // Let go, then chosen again 0.7 s after the last repeat: it acts.
    now += REPEAT_CHOICE_MS;
    expect(acts()).toBe(true);
    // No one chooses a menu item twice in 0.7 s: choices a second apart each act.
    now += 1000;
    expect(acts()).toBe(true);
    now += 1000;
    expect(acts()).toBe(true);
  });

  it('waits about 0.7 s, counted from the choice before, acted on or not', () => {
    expect(REPEAT_CHOICE_MS).toBe(700);
    let now = 0;
    const acts = choiceGuard(REPEAT_CHOICE_MS, () => now);
    expect(acts()).toBe(true);
    now += 699;
    expect(acts()).toBe(false);
    // 0.7 s after that one, which was let go by.
    now += 699;
    expect(acts()).toBe(false);
    now += 700;
    expect(acts()).toBe(true);
  });
});
