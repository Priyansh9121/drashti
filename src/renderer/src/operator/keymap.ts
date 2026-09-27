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
 */
export type OperatorAction =
  | 'next'
  | 'previous'
  | 'clearAll'
  | 'clearSlide'
  | 'clearBackground'
  | 'clearProps'
  | 'clearMessages'
  | 'clearAudio'
  | 'clearMasks'
  | 'toggleBlackout'
  | 'openScreens';

export interface KeyBinding {
  action: OperatorAction;
  keys: readonly string[];
  /** Short name for buttons and the shortcut legend. */
  label: string;
}

export const KEYMAP: readonly KeyBinding[] = [
  { action: 'next', keys: ['ArrowRight', 'ArrowDown', 'Space', 'PageDown'], label: 'Next slide' },
  { action: 'previous', keys: ['ArrowLeft', 'ArrowUp', 'PageUp'], label: 'Previous slide' },
  { action: 'clearAll', keys: ['F1'], label: 'Clear all' },
  { action: 'clearSlide', keys: ['F2'], label: 'Clear slide' },
  { action: 'clearBackground', keys: ['F3'], label: 'Clear background' },
  { action: 'clearProps', keys: ['F4'], label: 'Clear props' },
  { action: 'clearMessages', keys: ['F5'], label: 'Clear messages' },
  { action: 'clearAudio', keys: ['F6'], label: 'Clear audio' },
  { action: 'clearMasks', keys: ['F7'], label: 'Clear masks' },
  { action: 'toggleBlackout', keys: ['B', '.'], label: 'Black-out' },
  { action: 'openScreens', keys: ['Mod+Shift+S'], label: 'Screens' },
];

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
