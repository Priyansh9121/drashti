import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OperatorAction } from '../../../shared/keymap';
import { PAGE_KEYMAP } from '../../../shared/keymap';
import type { KeyPress } from './useKeymap';
import { keyListener } from './useKeymap';

/*
 * The operator window's keys as its listener takes them: a press runs its action once, and is taken; a held
 * key, a field, a dialog or a control that used the key itself lets the show's keys go by. The page is stood
 * in for: an element class for the fields, and a document with a dialog open or not.
 */

/** A stand-in for the page's elements: a field is one with a field's tag name, or one that is editable. */
class Element {
  constructor(
    readonly tagName: string,
    readonly isContentEditable = false,
  ) {}
}

let dialogOpen = false;

beforeEach(() => {
  dialogOpen = false;
  Object.assign(globalThis, {
    HTMLElement: Element,
    document: {
      querySelector: (selector: string) => (selector === '[aria-modal="true"]' && dialogOpen ? {} : null),
    },
  });
});

afterEach(() => {
  delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
  delete (globalThis as { document?: unknown }).document;
});

/** A key press, as a KeyboardEvent has it, that remembers whether it was taken. */
class Press implements KeyPress {
  metaKey = false;
  ctrlKey = false;
  altKey = false;
  shiftKey = false;
  repeat = false;
  isComposing = false;
  defaultPrevented = false;
  target: unknown = null;
  taken = false;
  constructor(
    readonly key: string,
    more: Partial<Omit<KeyPress, 'key' | 'preventDefault'>> = {},
  ) {
    Object.assign(this, more);
  }
  preventDefault(): void {
    this.taken = true;
    this.defaultPrevented = true;
  }
}

/** The window's listener on `platform`, and the actions it has run. */
function listening(platform: 'darwin' | 'win32') {
  const ran: OperatorAction[] = [];
  const onKey = keyListener(platform, PAGE_KEYMAP, (action) => {
    ran.push(action);
  });
  return { ran, onKey };
}

const typingIn = (tagName: string) => ({ target: new Element(tagName) });

describe('the operator window’s keys, as its listener takes them', () => {
  it('runs the action of a press once, and takes the press', () => {
    const { ran, onKey } = listening('darwin');
    const presses = [
      new Press('F12'),
      new Press('F5'),
      new Press('1', { metaKey: true }),
      new Press('S', { metaKey: true, shiftKey: true }),
    ];
    for (const p of presses) onKey(p);
    expect(ran).toEqual(['toggleLogo', 'clearAudio', 'toggleAudience', 'openScreens']);
    expect(presses.map((p) => p.taken)).toEqual([true, true, true, true]);
  });

  it('lets the show’s keys go by on a held key, in a field, while composing and under a dialog: none runs, none is taken', () => {
    const { ran, onKey } = listening('win32');
    const presses = [
      new Press('F2', { repeat: true }),
      new Press('F2', typingIn('INPUT')),
      new Press('F7', typingIn('TEXTAREA')),
      new Press('F8', typingIn('SELECT')),
      new Press('F6', { target: new Element('DIV', true) }),
      new Press('F12', { isComposing: true }),
    ];
    for (const p of presses) onKey(p);
    dialogOpen = true;
    const underDialog = [new Press('F5'), new Press('F12'), new Press('ArrowRight')];
    for (const p of underDialog) onKey(p);
    expect(ran).toEqual([]);
    expect([...presses, ...underDialog].filter((p) => p.taken)).toEqual([]);
  });

  it('opens Screens and uncovers the controls under a dialog too', () => {
    const { ran, onKey } = listening('win32');
    dialogOpen = true;
    onKey(new Press('S', { ctrlKey: true, shiftKey: true }));
    onKey(new Press('U', { ctrlKey: true, shiftKey: true }));
    expect(ran).toEqual(['openScreens', 'uncoverControls']);
  });

  it('leaves alone a press a control already took, and a key it does not know', () => {
    const { ran, onKey } = listening('darwin');
    const used = new Press('ArrowRight', { defaultPrevented: true });
    const unknown = [new Press('q'), new Press('1'), new Press('1', { ctrlKey: true })];
    for (const p of [used, ...unknown]) onKey(p);
    expect(ran).toEqual([]);
    expect([used, ...unknown].filter((p) => p.taken)).toEqual([]);
  });

  // View › Audience and Stage show ⌘1 and ⌘2 (Ctrl+1 and Ctrl+2) beside them (Session 51). Windows' menu shows a
  // key without binding it (registerAccelerator: false), but the Mac's acts on any key it shows that the page
  // leaves alone: so the page takes every press of them, the ones it lets go by included, and each acts once.
  it.each([
    ['darwin', { metaKey: true }],
    ['win32', { ctrlKey: true }],
  ] as const)(
    'takes every press of Mod+1 and Mod+2, the keys View › Audience and Stage show, and runs none it lets go by (%s)',
    (platform, mod) => {
      const { ran, onKey } = listening(platform);
      const letGo = ['1', '2'].flatMap((key) => [
        new Press(key, { ...mod, repeat: true }),
        new Press(key, { ...mod, ...typingIn('INPUT') }),
        new Press(key, { ...mod, isComposing: true }),
      ]);
      for (const p of letGo) onKey(p);
      dialogOpen = true;
      const underDialog = [new Press('1', mod), new Press('2', mod)];
      for (const p of underDialog) onKey(p);
      expect(ran).toEqual([]);
      const all = [...letGo, ...underDialog];
      expect(all).toHaveLength(8);
      expect(all.filter((p) => !p.taken).map((p) => `${p.key}${p.repeat ? ' held' : ''}`)).toEqual([]);
      // A press a control already took stays as it was, and runs nothing.
      dialogOpen = false;
      const used = new Press('1', { ...mod, defaultPrevented: true });
      onKey(used);
      expect(ran).toEqual([]);
      expect(used.taken).toBe(false);
      // The keys the menu does not show are let go by as before.
      const f2 = new Press('F2', { repeat: true });
      onKey(f2);
      expect(f2.taken).toBe(false);
    },
  );
});
