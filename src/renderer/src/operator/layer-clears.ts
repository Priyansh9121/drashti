import type { LayerName } from '../../../shared/engine/state';
import type { OperatorAction } from '../../../shared/keymap';

/*
 * The layer bar's clears, left to right (LayerBar.tsx draws them, each with its icon and its key from the keymap),
 * in the order of their keys (Session 51): Slide F2, Background F3, Props F4, Audio F5, Messages F6, Ticker F7 and
 * Masks F8, so the bar reads as the keyboard does. Session 50 had moved the keys to the ones the operators already
 * press and left the buttons where they were. Here on their own so a unit test holds the order to the keys.
 */
export const LAYER_CLEARS = [
  { action: 'clearSlide', layer: 'slide', label: 'Slide' },
  { action: 'clearBackground', layer: 'background', label: 'Background' },
  { action: 'clearProps', layer: 'props', label: 'Props' },
  { action: 'clearAudio', layer: 'audio', label: 'Audio' },
  { action: 'clearMessages', layer: 'messages', label: 'Messages' },
  { action: 'clearTicker', layer: 'ticker', label: 'Ticker' },
  { action: 'clearMasks', layer: 'masks', label: 'Masks' },
] as const satisfies readonly { action: OperatorAction; layer: LayerName; label: string }[];

/** A layer the bar has a clear for. */
export type ClearedLayer = (typeof LAYER_CLEARS)[number]['layer'];
