import type { LayerName } from '../../../shared/engine/state';
import type { OperatorAction } from '../../../shared/keymap';

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
