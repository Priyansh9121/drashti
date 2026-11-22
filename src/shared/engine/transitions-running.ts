import type { EngineState } from './state';

/**
 * When the screens' transitions running at `now` end (the engine's clock, ms), or null when none runs: the slide
 * coming on by a dissolve, a fade through black or a slide in (from its shownAt for its duration), and the background's
 * dissolve from the one before (from its fade's start for its duration). A new picture's display copy waits for it
 * (alpha.21, Q60-59 A: made during a hall dissolve, its work held up the hall's frames).
 */
export function transitionsEndAt(state: EngineState | null, now: number): number | null {
  if (!state) return null;
  let end = -Infinity;
  const slide = state.layers.slide;
  if (slide?.transition && slide.transition.durationMs > 0)
    end = Math.max(end, slide.shownAt + slide.transition.durationMs);
  const background = state.layers.background;
  const fade = background && 'fade' in background ? background.fade : undefined;
  if (fade) end = Math.max(end, fade.at + fade.durationMs);
  return end > now ? end : null;
}
