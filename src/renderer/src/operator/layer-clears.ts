import type { LayerName, Layers } from '../../../shared/engine/state';
import { isLayerEmpty } from '../../../shared/engine/state';
import type { KeyBinding, OperatorAction } from '../../../shared/keymap';
import { KEYMAP } from '../../../shared/keymap';

/*
 * The layer bar's clears, left to right (LayerBar.tsx draws them, each with its icon and its key from the keymap),
 * in the order of their keys (Session 51): Slide F2, Background F3, Audio F5, Messages F6 and Ticker F7, so the bar
 * reads as the keyboard does (Session 55, Part 13: Props F4 and Masks F8 went with Props and Masks, and F4 and F8 do
 * nothing now). Session 50 had moved the keys to the ones the operators already press and left the buttons where
 * they were. Here on their own so a unit test holds the order to the keys.
 */
export const LAYER_CLEARS = [
  { action: 'clearSlide', layer: 'slide', label: 'Slide' },
  { action: 'clearBackground', layer: 'background', label: 'Background' },
  { action: 'clearAudio', layer: 'audio', label: 'Audio' },
  { action: 'clearMessages', layer: 'messages', label: 'Messages' },
  { action: 'clearTicker', layer: 'ticker', label: 'Ticker' },
] as const satisfies readonly { action: OperatorAction; layer: LayerName; label: string }[];

/** A layer the bar has a clear for. */
export type ClearedLayer = (typeof LAYER_CLEARS)[number]['layer'];

/*
 * What is up, at a glance (alpha.24, the owner's calmer window): a clear is lit (its words and key, LIVE's edge and
 * dot) while its layer has something on the screens, and compact (its icon alone, its words and key in its tooltip)
 * while it has nothing, or before the show's state is known. It keeps its place either way (LayerBar.tsx), and turns
 * lit or compact at once, in the same frame as the screens, nothing moving with it (a show control's state).
 */
export type ClearLook = 'lit' | 'compact';

export function clearLook(layers: Layers | null | undefined, layer: ClearedLayer): ClearLook {
  return layers && !isLayerEmpty(layers, layer) ? 'lit' : 'compact';
}

/**
 * The keys an action answers to now, as aria-keyshortcuts names them ("F2", "B ."), for a screen reader: a compact
 * clear shows no key and the others' keys may be unseen (Help off), so the bar's buttons say them this way too. None
 * while it has no key (Black-out with the single-letter keys off).
 */
export function ariaKeys(
  action: OperatorAction,
  platform: string,
  keymap: readonly KeyBinding[] = KEYMAP,
): string | undefined {
  const keys = keymap.find((b) => b.action === action)?.keys ?? [];
  const mod = platform === 'darwin' ? 'Meta' : 'Control';
  const named = keys.map((k) => k.replace(/\bMod\b/u, mod));
  return named.length > 0 ? named.join(' ') : undefined;
}

/**
 * Put it back's keys for a screen reader (clearroom, from lead 2's uibar re-review): in Simple Mode Undo puts back
 * what Clear all took down, so its Put it back names Undo's key (Mod+Z as each system has it); Pro Mode's Undo brings
 * back a removal, so its Put it back has none.
 */
export function putBackKeys(
  simple: boolean,
  platform: string,
  keymap: readonly KeyBinding[] = KEYMAP,
): string | undefined {
  return simple ? ariaKeys('undo', platform, keymap) : undefined;
}
