import type { LayerName, Layers } from '../../../shared/engine/state';
import { isLayerEmpty } from '../../../shared/engine/state';
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

/*
 * What is up, at a glance (alpha.24, the owner's calmer window): a clear is lit (its words and key, LIVE's edge and
 * dot) while its layer has something on the screens, and compact (its icon alone, its words and key in its tooltip)
 * while it has nothing, or before the show's state is known. It keeps its place either way (LayerBar.tsx).
 */
export type ClearLook = 'lit' | 'compact';

export function clearLook(layers: Layers | null | undefined, layer: ClearedLayer): ClearLook {
  return layers && !isLayerEmpty(layers, layer) ? 'lit' : 'compact';
}

/*
 * As a clear lights up or goes out it changes at once, in the same frame as the screens (Session 25); a trace in its
 * place (never the clear itself, a show control) grows from its icon to its lit size or shrinks back into the icon,
 * once. Nothing plays from the first state the window hears, while the window opens (ui/motion.ts: it opens
 * settled), or with interface motion Off or the computer set to reduce motion (`moves`); Calm and Lively both play it.
 */
export type ClearTrace = 'grow' | 'shrink';

export function clearTrace(
  was: ClearLook | null,
  now: ClearLook | null,
  can: { moves: boolean; opened: boolean },
): ClearTrace | null {
  if (was === null || now === null || was === now || !can.moves || !can.opened) return null;
  return now === 'lit' ? 'grow' : 'shrink';
}

/**
 * The trace's two frames: only transform and opacity (the graphics chip moves them without the page drawing again),
 * from the compact size to the lit one (`ratio`: the compact button's width over its room's) or back, fading out.
 */
export function traceFrames(trace: ClearTrace, ratio: number): { transform: string; opacity: number }[] {
  const small = Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, 1) : 1;
  const [from, to] = trace === 'grow' ? [small, 1] : [1, small];
  return [
    { transform: `scaleX(${String(from)})`, opacity: trace === 'grow' ? 0.35 : 0.6 },
    { transform: `scaleX(${String(to)})`, opacity: 0 },
  ];
}

/** Its time and curve, the names of tokens of the motion table (app.css): lighting up over --dur-move, going out quicker. */
export const TRACE_TIMING: Readonly<Record<ClearTrace, { time: string; curve: string }>> = {
  grow: { time: 'dur-move', curve: 'ease-out' },
  shrink: { time: 'dur-exit', curve: 'ease-in-out' },
};
