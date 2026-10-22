/**
 * Every operator keyboard shortcut, in one place.
 *
 * The keys are the ones the mandir's operators already press (Session 50): their presentation program's
 * Presentation and Screens menus, photographed on 22 Oct 2026. F1 to F4 were already the same; F5 (sound)
 * and F6 (messages), and F7 (the ticker, their "announcements") and F8 (masks), changed places from
 * Drashti's own; F12 is the logo, beside L; Mod+1 and Mod+2 turn the Audience and Stage screens off and on.
 * Nothing else in the app hard-codes a key.
 *
 * Key names are KeyboardEvent.key values, except "Space". Letters match
 * either case (with Cmd, Ctrl or Alt, Shift as the binding has it). "Mod+"
 * means Cmd on macOS and Ctrl on Windows.
 *
 * Bindings marked `global` also work when Drashti is not the active app
 * (the main process registers them while they are needed), so they still
 * work when an output window covers the operator window.
 */
export type OperatorAction =
  | 'next'
  | 'previous'
  | 'nextItem'
  | 'previousItem'
  | 'clearAll'
  | 'clearSlide'
  | 'clearBackground'
  | 'clearProps'
  | 'clearMessages'
  | 'clearTicker'
  | 'clearAudio'
  | 'clearMasks'
  | 'toggleBlackout'
  | 'toggleLogo'
  | 'toggleAudience'
  | 'toggleStage'
  | 'stopRepeat'
  | 'openScreens'
  | 'uncoverControls'
  | 'removeSelected'
  | 'moveItemUp'
  | 'moveItemDown'
  | 'findInLibrary'
  | 'undo'
  | 'showKeys';

export interface KeyBinding {
  action: OperatorAction;
  keys: readonly string[];
  /** Short name for buttons and the shortcut legend. */
  label: string;
  /** Also registered system-wide by the main process while it is needed. */
  global?: boolean;
  /** Only while a list (presentations, playlists, a playlist's items) has the keyboard focus. */
  scope?: 'library';
  /**
   * Handled by the application menu, not by the page: text fields keep
   * their own meaning for the key (Undo in a field undoes typing).
   */
  menuOnly?: boolean;
  /**
   * Shown beside its item in the application menu, and still the page's to act on (Session 51: ⌘1 and ⌘2 beside
   * View › Audience and Stage). Windows' menu shows it without binding it (registerAccelerator: false); the
   * Mac's acts on any key it shows that the page leaves alone, so the page takes every press of it, the ones it
   * lets go by (held, in a field, under a dialog) included: each press acts once, by the page.
   */
  shownInMenu?: boolean;
}

export const KEYMAP: readonly KeyBinding[] = [
  { action: 'next', keys: ['ArrowRight', 'ArrowDown', 'Space', 'PageDown'], label: 'Next slide' },
  { action: 'previous', keys: ['ArrowLeft', 'ArrowUp', 'PageUp'], label: 'Previous slide' },
  // The first slide of the next or previous playlist item (headers and placeholders are stepped over).
  { action: 'nextItem', keys: ['Shift+ArrowRight', 'Shift+ArrowDown'], label: 'Next item' },
  { action: 'previousItem', keys: ['Shift+ArrowLeft', 'Shift+ArrowUp'], label: 'Previous item' },
  { action: 'clearAll', keys: ['F1'], label: 'Clear all' },
  { action: 'clearSlide', keys: ['F2'], label: 'Clear slide' },
  { action: 'clearBackground', keys: ['F3'], label: 'Clear background' },
  { action: 'clearProps', keys: ['F4'], label: 'Clear props' },
  { action: 'clearAudio', keys: ['F5'], label: 'Clear audio' },
  { action: 'clearMessages', keys: ['F6'], label: 'Clear messages' },
  // The announcements ticker (Session 10).
  { action: 'clearTicker', keys: ['F7'], label: 'Clear ticker' },
  { action: 'clearMasks', keys: ['F8'], label: 'Clear masks' },
  { action: 'toggleBlackout', keys: ['B', '.'], label: 'Black-out' },
  // The logo instead of the picture, and back (the prop marked as the logo in Pro Mode): F12, as the operators
  // press it, and L as before.
  { action: 'toggleLogo', keys: ['F12', 'L'], label: 'Logo' },
  // This computer's audience screens (key and fill too), or its stage screens, off and on (Session 50): off
  // gives their displays back to the computer; the show carries on. View › Audience and Stage show them.
  { action: 'toggleAudience', keys: ['Mod+1'], label: 'Audience on or off', shownInMenu: true },
  { action: 'toggleStage', keys: ['Mod+2'], label: 'Stage on or off', shownInMenu: true },
  // Repeat Slides going round stops, its slide staying up (Session 26d). Not while a dialog, a menu, the
  // slide editor or a field has the keyboard: they keep Esc for themselves.
  { action: 'stopRepeat', keys: ['Escape'], label: 'Stop Repeat Slides' },
  { action: 'openScreens', keys: ['Mod+Shift+S'], label: 'Screens' },
  // Turns off any output covering the operator window. Not Ctrl+Shift+Esc (Windows Task Manager)
  // and not plain Esc (too easy to press by accident when a single screen is covered on purpose).
  { action: 'uncoverControls', keys: ['Mod+Shift+U'], label: 'Uncover the controls', global: true },
  // Removing presentations or playlists asks first; Undo brings back any removal. In Simple Mode,
  // which removes nothing, Undo puts back what Clear all took down.
  { action: 'removeSelected', keys: ['Delete', 'Backspace'], label: 'Remove', scope: 'library' },
  // A playlist's chosen item up or down a place, as its Up and Down buttons do (Session 25): no one has to drag.
  { action: 'moveItemUp', keys: ['Alt+ArrowUp'], label: 'Move up', scope: 'library' },
  { action: 'moveItemDown', keys: ['Alt+ArrowDown'], label: 'Move down', scope: 'library' },
  { action: 'findInLibrary', keys: ['Mod+F'], label: 'Search' },
  { action: 'undo', keys: ['Mod+Z'], label: 'Undo', menuOnly: true },
  // The keys sheet (Help > Keyboard Shortcuts…, Session 25): Pro Mode only, as no field has the focus.
  { action: 'showKeys', keys: ['?'], label: 'This list of keys' },
];

/**
 * The keys sheet, built from KEYMAP and grouped by what the operator is doing (Session 25): every
 * action once (a unit test checks), so the sheet never drifts from the keys.
 */
export const KEY_GROUPS: readonly { title: string; actions: readonly OperatorAction[] }[] = [
  { title: 'Running the show', actions: ['next', 'previous', 'nextItem', 'previousItem', 'stopRepeat'] },
  {
    title: 'Clearing the screens',
    actions: [
      'clearAll',
      'clearSlide',
      'clearBackground',
      'clearProps',
      'clearAudio',
      'clearMessages',
      'clearTicker',
      'clearMasks',
    ],
  },
  { title: 'Covering the picture', actions: ['toggleBlackout', 'toggleLogo'] },
  {
    title: 'The library and playlists',
    actions: ['findInLibrary', 'moveItemUp', 'moveItemDown', 'removeSelected', 'undo'],
  },
  {
    title: 'Screens, and this list',
    actions: ['openScreens', 'toggleAudience', 'toggleStage', 'uncoverControls', 'showKeys'],
  },
];

/** Keys the page listens for everywhere (not scoped to a list, not owned by the menu). */
export const PAGE_KEYMAP: readonly KeyBinding[] = KEYMAP.filter((b) => !b.scope && !b.menuOnly);
/** Keys that only work while a list has the focus. */
export const LIBRARY_KEYMAP: readonly KeyBinding[] = KEYMAP.filter((b) => b.scope === 'library');
/**
 * Keys Simple Mode listens for: the page's keys and Undo (which puts back what Clear all took
 * down). The Edit menu still owns Undo's key, and tells the page when it is chosen.
 */
export const SIMPLE_KEYMAP: readonly KeyBinding[] = KEYMAP.filter((b) => !b.scope);

/**
 * A key of one character with no Cmd, Ctrl or Alt (Shift or not): B, ., L and ?. WCAG 2.1.4 calls these
 * character key shortcuts. They act wherever the window has the keyboard, so a word said to speech software,
 * or a key brushed, could black out the hall: an admin can turn them off (Help › Keyboard Shortcuts…,
 * Session 37). Every other key has Cmd, Ctrl or Alt, is a named key (arrows, Space, F1…), or works only in a
 * list with the keyboard.
 */
export function isSingleKey(binding: string): boolean {
  const { key, mod, alt } = parse(binding);
  return key.length === 1 && !mod && !alt;
}

/** The single-letter keys, in the keymap's order: B, ., L and ?. */
export const SINGLE_KEYS: readonly string[] = KEYMAP.flatMap((b) => b.keys.filter(isSingleKey));

/** The single-letter keys in words, as the switch and the guides name them: "B, ., L and ?". */
export const SINGLE_KEYS_TEXT = `${SINGLE_KEYS.slice(0, -1).join(', ')} and ${SINGLE_KEYS.at(-1) ?? ''}`;

const withoutSingle = new WeakMap<readonly KeyBinding[], readonly KeyBinding[]>();

/**
 * The keymap with its single-letter keys taken out, as when they are turned off: an action left with no
 * key goes, and every other binding stays as it was. Asked again for the same keymap, the same answer.
 */
export function withoutSingleKeys(keymap: readonly KeyBinding[]): readonly KeyBinding[] {
  const known = withoutSingle.get(keymap);
  if (known) return known;
  const left = keymap.flatMap((b) => {
    const keys = b.keys.filter((k) => !isSingleKey(k));
    if (keys.length === b.keys.length) return [b];
    return keys.length > 0 ? [{ ...b, keys }] : [];
  });
  withoutSingle.set(keymap, left);
  return left;
}

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

function parse(binding: string): { key: string; mod: boolean; shift: boolean; alt: boolean } {
  const parts = binding.split('+');
  const key = parts.pop() ?? '';
  return { key, mod: parts.includes('Mod'), shift: parts.includes('Shift'), alt: parts.includes('Alt') };
}

function normalise(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Does this key press trigger this binding key? */
export function keyMatches(input: KeyInput, binding: string, platform: string): boolean {
  const want = parse(binding);
  const mod = platform === 'darwin' ? input.metaKey : input.ctrlKey;
  const otherMod = platform === 'darwin' ? input.ctrlKey : input.metaKey;
  if (mod !== want.mod || otherMod || input.altKey !== want.alt) return false;
  const key = normalise(input.key);
  // Shift only matters when the binding asks for it, for named keys (Shift+Space is not Space), and for a letter
  // with Cmd, Ctrl or Alt (Session 51: Shift+Cmd+Z is Redo's key, not Mod+Z). A letter alone matches with Shift
  // or without (Caps Lock, Shift held), as a digit or "?" does: some keyboards need Shift to type them.
  const letterWithMod = (want.mod || want.alt) && /^[A-Z]$/u.test(key);
  if (want.shift !== input.shiftKey && (want.shift || key.length > 1 || letterWithMod)) return false;
  return key === normalise(want.key);
}

/** The action a key press triggers, if any. */
export function actionFor(
  input: KeyInput,
  platform: string,
  keymap: readonly KeyBinding[] = KEYMAP,
): OperatorAction | null {
  for (const b of keymap) if (b.keys.some((k) => keyMatches(input, k, platform))) return b.action;
  return null;
}

/** A binding's key, written for people as this computer shows it: "→", "Page Down", "⌘⇧S" or "Ctrl+Shift+S". */
export function keyText(binding: string, platform: string): string {
  const { key, mod, shift, alt } = parse(binding);
  const names: Record<string, string> = {
    ArrowRight: '→',
    ArrowLeft: '←',
    ArrowUp: '↑',
    ArrowDown: '↓',
    PageDown: 'Page Down',
    PageUp: 'Page Up',
  };
  const name = names[key] ?? key;
  if (platform === 'darwin') return `${mod ? '⌘' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${name}`;
  return [mod ? 'Ctrl' : '', alt ? 'Alt' : '', shift ? 'Shift' : '', name].filter(Boolean).join('+');
}

/** The first key of an action, written for people, e.g. "F2", "Space", "⌘⇧S" or "Ctrl+Shift+S". */
export function shortcutText(
  action: OperatorAction,
  platform: string,
  keymap: readonly KeyBinding[] = KEYMAP,
): string {
  const first = keymap.find((b) => b.action === action)?.keys[0];
  return first ? keyText(first, platform) : '';
}

/** Electron accelerator for a binding key, e.g. "Mod+Shift+U" -> "CommandOrControl+Shift+U". */
export function toAccelerator(binding: string): string {
  return binding
    .split('+')
    .map((part) => (part === 'Mod' ? 'CommandOrControl' : part === 'Space' ? 'Space' : part))
    .join('+');
}

/** The first key of an action as an Electron accelerator. */
export function acceleratorFor(
  action: OperatorAction,
  keymap: readonly KeyBinding[] = KEYMAP,
): string | null {
  const first = keymap.find((b) => b.action === action)?.keys[0];
  return first ? toAccelerator(first) : null;
}
