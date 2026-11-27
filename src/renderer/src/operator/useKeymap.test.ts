import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OperatorAction } from '../../../shared/keymap';
import { PAGE_KEYMAP } from '../../../shared/keymap';
import type { KeyPress } from './useKeymap';
import { keyListener, shortcutKey } from './useKeymap';

/*
 * The operator window's keys as its listener takes them: a press runs its action once, and is taken; a held
 * key, a field, a dialog or a control that used the key itself lets the show's keys go by. The page is stood
 * in for: an element class for the fields, and a document with a dialog open or not.
 */

/** A stand-in for the page's elements: a field is one with a field's tag name, or one that is editable. */
class StandInElement {
  constructor(
    readonly tagName: string,
    readonly isContentEditable = false,
  ) {}
}

let dialogOpen = false;

beforeEach(() => {
  dialogOpen = false;
  Object.assign(globalThis, {
    HTMLElement: StandInElement,
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

const typingIn = (tagName: string) => ({ target: new StandInElement(tagName) });

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
    expect(ran).toEqual(['toggleWallpaper', 'clearAudio', 'toggleAudience', 'openScreens']);
    expect(presses.map((p) => p.taken)).toEqual([true, true, true, true]);
  });

  it('lets the show’s keys go by on a held key, in a field, while composing and under a dialog: none runs, none is taken', () => {
    const { ran, onKey } = listening('win32');
    const presses = [
      new Press('F2', { repeat: true }),
      new Press('F2', typingIn('INPUT')),
      new Press('F7', typingIn('TEXTAREA')),
      new Press('F8', typingIn('SELECT')),
      new Press('F6', { target: new StandInElement('DIV', true) }),
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

  // A Gujarati or Hindi keyboard layout (alpha.24, keyplat R6): the B key types "વ", and the keymap answers its place
  // (shared/keymap.ts). Typed into a field (the library's search box, the words editor, a slide's words) it is a
  // letter, never Black-out, Search, Audience or Stage, as the Latin keys are there; on the window it acts as B does.
  it.each(['darwin', 'win32'] as const)(
    'runs B, Search, Audience and Stage from a Gujarati or Hindi layout on the window, and never from a field (%s)',
    (platform) => {
      const mod = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
      const gujarati = (more: Partial<Omit<KeyPress, 'key' | 'preventDefault'>> = {}) => [
        new Press('વ', { code: 'KeyB', ...more }),
        new Press('ब', { code: 'KeyB', shiftKey: true, ...more }),
        new Press('િ', { code: 'KeyF', ...mod, ...more }),
        new Press('૧', { code: 'Digit1', ...mod, ...more }),
        new Press('२', { code: 'Digit2', ...mod, ...more }),
      ];
      const fields = [
        typingIn('INPUT'), // the library's search box, a playlist's Find
        typingIn('TEXTAREA'), // the words editor
        { target: new StandInElement('DIV', true) }, // a slide's words, being typed
      ];
      const { ran, onKey } = listening(platform);
      const typed = fields.flatMap((field) => gujarati(field));
      for (const p of typed) onKey(p);
      expect(ran).toEqual([]);
      // A letter typed is never taken (it reaches the field); Cmd or Ctrl with 1 or 2 is, as with the Latin keys.
      expect(typed.filter((p) => p.taken).map((p) => p.key)).toEqual(['૧', '२', '૧', '२', '૧', '२']);
      const onWindow = gujarati();
      for (const p of onWindow) onKey(p);
      expect(ran).toEqual([
        'toggleBlackout',
        'toggleBlackout',
        'findInLibrary',
        'toggleAudience',
        'toggleStage',
      ]);
    },
  );

  // View › Audience and Stage show ⌘1 and ⌘2  // View › Audience and Stage show ⌘1 and ⌘2 (Ctrl+1 and Ctrl+2) beside them (Session 51). Windows' menu shows a
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

/** A button, as the page has it: a show control (data-show-control: a slide's row, Black-out, Next) or not. */
class StandInButton extends StandInElement {
  disabled = false;
  constructor(
    readonly name: string,
    readonly showControl = false,
    readonly spaceNext = false,
  ) {
    super('BUTTON');
  }
  closest(selector: string): StandInButton | null {
    return (selector === '[data-show-control]' && this.showControl) ||
      (selector === '[data-space-next]' && this.spaceNext)
      ? this
      : null;
  }
}

// Space on a focused button (a25 item 1; the release lead's B, as lead 2 scoped it): a button the keyboard put the
// focus on (Tab, or a move the page made from there: focus-origin.ts) is pressed by Space, as on any page, so Space on
// a Tab-focused "?" opens it. Never a show control's (a slide's row, a playlist's item, Next, Black-out, the clears):
// there Space stays Next, as the operators press it. A button a click focused keeps Space = Next too, so Space never
// presses Black-out, Clear all or Oops again.
describe('Space on a focused button', () => {
  const ask = new StandInButton('What is this? Stream');
  const dismiss = new StandInButton('Dismiss the screens line');
  const slideRow = new StandInButton('Slide 3', true);
  const blackout = new StandInButton('Black-out', true);
  const byKeyboard = new Set<unknown>([ask, dismiss, slideRow]);
  const listen = (platform: 'darwin' | 'win32') => {
    const ran: OperatorAction[] = [];
    const onKey = keyListener(
      platform,
      PAGE_KEYMAP,
      (action) => {
        ran.push(action);
      },
      (target) => byKeyboard.has(target),
    );
    return { ran, onKey };
  };

  it.each(['darwin', 'win32'] as const)(
    'presses a button the keyboard put the focus on: Space is let go by to it, and no Next runs (%s)',
    (platform) => {
      const { ran, onKey } = listen(platform);
      const presses = [new Press(' ', { target: ask }), new Press(' ', { target: dismiss })];
      for (const p of presses) onKey(p);
      expect(ran).toEqual([]);
      expect(presses.map((p) => p.taken)).toEqual([false, false]);
    },
  );

  it('stays Next on a show control, even one the keyboard put the focus on (a slide’s row)', () => {
    const { ran, onKey } = listen('win32');
    const p = new Press(' ', { target: slideRow });
    onKey(p);
    expect(ran).toEqual(['next']);
    expect(p.taken).toBe(true);
  });

  it.each(['Sound on', 'Simple Mode', 'Pro Mode'])(
    'stays Next on the keyboard-focused %s switch, taking both presses so it never switches',
    (name) => {
      const button = new StandInButton(name, false, true);
      const ran: OperatorAction[] = [];
      const onKey = keyListener(
        'win32',
        PAGE_KEYMAP,
        (action) => ran.push(action),
        () => true,
      );
      const presses = [new Press(' ', { target: button }), new Press(' ', { target: button })];
      for (const p of presses) onKey(p);
      expect(ran).toEqual(['next', 'next']);
      expect(presses.map((p) => p.taken)).toEqual([true, true]);
    },
  );

  it('stays Next on a button a click focused: Black-out, or a "?" clicked', () => {
    const { ran, onKey } = listen('darwin');
    const clickedAsk = new StandInButton('What is this? LIVE');
    const presses = [new Press(' ', { target: blackout }), new Press(' ', { target: clickedAsk })];
    for (const p of presses) onKey(p);
    expect(ran).toEqual(['next', 'next']);
    expect(presses.map((p) => p.taken)).toEqual([true, true]);
  });

  it('leaves the other keys as they were on a button the keyboard focused: → and Page Down are Next', () => {
    const { ran, onKey } = listen('win32');
    const presses = [new Press('ArrowRight', { target: ask }), new Press('PageDown', { target: ask })];
    for (const p of presses) onKey(p);
    expect(ran).toEqual(['next', 'next']);
    expect(presses.map((p) => p.taken)).toEqual([true, true]);
  });
});

// A window's own keys outside the keymap (alpha.24, hunt S3-3: the slide editor's Save, Find, Undo and Redo, the
// Access List's Find): with a Gujarati or Hindi layout, Ctrl with the S key says "સ"; read as the S in its place on the
// keyboard, as the keymap's own keys are (keyplat). With Cmd or Ctrl, anywhere but an IME's composition, as a Latin
// layout's Save and Find act while typing too (the release lead, 27 Nov: else an operator types Gujarati words, presses
// Ctrl+S and believes they saved); a letter alone never in a field or an editable box, as keyplat's B; and a Latin
// layout's press always as it is.
describe('the key a window’s own shortcut reads (shortcutKey)', () => {
  it('reads another script’s letter as the Latin one in its place, outside a field', () => {
    expect(shortcutKey({ key: 'સ', code: 'KeyS', target: new StandInElement('DIV') })).toBe('S');
    expect(
      shortcutKey({ key: 'ॆ', code: 'KeyZ', isComposing: false, target: new StandInElement('BODY') }),
    ).toBe('Z');
    // React's event, whose native event says whether an IME is composing; and one with no target.
    expect(shortcutKey({ key: 'ય', code: 'KeyY', nativeEvent: { isComposing: false } })).toBe('Y');
    expect(shortcutKey({ key: 'અ', code: 'KeyA' })).toBe('A');
  });

  it('never in a field, an editable box or an IME’s composition', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(shortcutKey({ key: 'સ', code: 'KeyS', target: new StandInElement(tag) }), tag).toBe('સ');
    expect(shortcutKey({ key: 'સ', code: 'KeyS', target: new StandInElement('DIV', true) })).toBe('સ');
    expect(shortcutKey({ key: 'સ', code: 'KeyS', isComposing: true })).toBe('સ');
    expect(shortcutKey({ key: 'સ', code: 'KeyS', nativeEvent: { isComposing: true } })).toBe('સ');
  });

  it('leaves every Latin layout’s press as it is, in a field or not', () => {
    for (const target of [new StandInElement('DIV'), new StandInElement('INPUT'), undefined])
      for (const [key, code] of [
        ['s', 'KeyS'],
        ['S', 'KeyS'],
        ['z', 'KeyY'],
        ['y', 'KeyZ'],
        ['é', 'Digit2'],
        ['Enter', 'Enter'],
      ] as const)
        expect(shortcutKey({ key, code, target })).toBe(key);
  });

  it('with Cmd or Ctrl, reads it in a field and an editable box too, as a Latin layout’s Save and Find act there', () => {
    const boxes = [
      new StandInElement('INPUT'),
      new StandInElement('TEXTAREA'),
      new StandInElement('DIV', true),
    ];
    for (const command of [{ ctrlKey: true }, { metaKey: true }])
      for (const target of boxes) {
        expect(shortcutKey({ key: 'સ', code: 'KeyS', ...command, target }), target.tagName).toBe('S');
        expect(shortcutKey({ key: 'ફ', code: 'KeyF', ...command, target }), target.tagName).toBe('F');
      }
    // A Latin layout's Cmd/Ctrl+S in a box is its own S, as before.
    expect(shortcutKey({ key: 's', code: 'KeyS', ctrlKey: true, target: boxes[2] })).toBe('s');
  });

  it('never during an IME’s composition, Cmd or Ctrl held or not: isComposing, or the composing key code 229', () => {
    for (const target of [new StandInElement('DIV'), new StandInElement('DIV', true)])
      for (const composing of [
        { isComposing: true },
        { keyCode: 229 },
        { nativeEvent: { isComposing: true } },
        { nativeEvent: { keyCode: 229 } },
      ])
        expect(
          shortcutKey({ key: 'સ', code: 'KeyS', ctrlKey: true, target, ...composing }),
          JSON.stringify(composing),
        ).toBe('સ');
  });

  it('a letter alone (B and the like) keeps the field guard: in a field or a box it is the letter typed', () => {
    for (const target of [
      new StandInElement('INPUT'),
      new StandInElement('TEXTAREA'),
      new StandInElement('SELECT'),
      new StandInElement('DIV', true),
    ])
      expect(shortcutKey({ key: 'વ', code: 'KeyB', target }), target.tagName).toBe('વ');
    expect(shortcutKey({ key: 'વ', code: 'KeyB', target: new StandInElement('DIV') })).toBe('B');
  });

  it('never with Alt or Option: they type characters, not a shortcut’s letter (hunt3fix review SHOULD-1)', () => {
    // A Mac's Option+Z types "Ω" and Option+P "π" on its U.S. layout; Windows' AltGr (Ctrl+Alt) types a layout's own.
    expect(shortcutKey({ key: 'Ω', code: 'KeyZ', metaKey: true, altKey: true })).toBe('Ω');
    expect(shortcutKey({ key: 'π', code: 'KeyP', altKey: true, target: new StandInElement('DIV') })).toBe(
      'π',
    );
    expect(shortcutKey({ key: 'ૐ', code: 'KeyX', ctrlKey: true, altKey: true })).toBe('ૐ');
    expect(shortcutKey({ key: 'Ω', code: 'KeyZ', metaKey: true, altKey: false })).toBe('Z');
  });
});
