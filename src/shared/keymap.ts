/**
 * Every operator keyboard shortcut, in one place.
 *
 * PROVISIONAL: these defaults follow common presentation software. Once the
 * operators' setup checklist (tools/audit/SETUP-CHECKLIST.md, section 3) is
 * back, change the keys below to match what they press in ProPresenter
 * today. Nothing else in the app hard-codes a key.
 *
 * Key names are KeyboardEvent.key values, except "Space". Letters match
 * either case. "Mod+" means Cmd on macOS and Ctrl on Windows.
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
  | 'openScreens'
  | 'uncoverControls'
  | 'removeSelected'
  | 'findInLibrary'
  | 'undo';

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
  { action: 'clearMessages', keys: ['F5'], label: 'Clear messages' },
  { action: 'clearAudio', keys: ['F6'], label: 'Clear audio' },
  { action: 'clearMasks', keys: ['F7'], label: 'Clear masks' },
  // The announcements ticker (Session 10).
  { action: 'clearTicker', keys: ['F8'], label: 'Clear ticker' },
  { action: 'toggleBlackout', keys: ['B', '.'], label: 'Black-out' },
  // The logo instead of the picture, and back (the prop marked as the logo in Pro Mode).
  { action: 'toggleLogo', keys: ['L'], label: 'Logo' },
  { action: 'openScreens', keys: ['Mod+Shift+S'], label: 'Screens' },
  // Turns off any output covering the operator window. Not Ctrl+Shift+Esc (Windows Task Manager)
  // and not plain Esc (too easy to press by accident when a single screen is covered on purpose).
  { action: 'uncoverControls', keys: ['Mod+Shift+U'], label: 'Uncover the controls', global: true },
  // Removing presentations or playlists asks first; Undo brings back any removal. In Simple Mode,
  // which removes nothing, Undo puts back what Clear all took down.
  { action: 'removeSelected', keys: ['Delete', 'Backspace'], label: 'Remove', scope: 'library' },
  { action: 'findInLibrary', keys: ['Mod+F'], label: 'Search' },
  { action: 'undo', keys: ['Mod+Z'], label: 'Undo', menuOnly: true },
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
  // Shift only matters when the binding asks for it, or for named keys (Shift+Space is not Space).
  if (want.shift !== input.shiftKey && (want.shift || key.length > 1)) return false;
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

/** The first key of an action, written for people, e.g. "F2", "Space", "⌘⇧S" or "Ctrl+Shift+S". */
export function shortcutText(
  action: OperatorAction,
  platform: string,
  keymap: readonly KeyBinding[] = KEYMAP,
): string {
  const first = keymap.find((b) => b.action === action)?.keys[0];
  if (!first) return '';
  const { key, mod, shift, alt } = parse(first);
  const arrows: Record<string, string> = { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓' };
  const name = arrows[key] ?? key;
  if (platform === 'darwin') return `${mod ? '⌘' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${name}`;
  return [mod ? 'Ctrl' : '', alt ? 'Alt' : '', shift ? 'Shift' : '', name].filter(Boolean).join('+');
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
