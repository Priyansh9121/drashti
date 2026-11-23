import type { EngineState, SlideLayer } from './engine/state';
import type { RenderSlide } from './model';
import { checkedTranslationView, type TranslationDestination } from './prepared-translation-view';

const originalSlides = new WeakMap<RenderSlide, RenderSlide>();
const cache = new WeakMap<RenderSlide, Map<string, RenderSlide>>();
function outputSlide(slide: RenderSlide, destination: TranslationDestination, hidden = false): RenderSlide {
  slide = originalSlides.get(slide) ?? slide;
  if (hidden) return slide;
  const key = JSON.stringify(destination);
  let views = cache.get(slide);
  if (!views) {
    views = new Map();
    cache.set(slide, views);
  }
  let view = views.get(key);
  if (!view) {
    view = checkedTranslationView(slide, destination);
    if (view !== slide) originalSlides.set(view, slide);
    if (views.size >= 256) views.clear();
    views.set(key, view);
  }
  return view;
}
/** Checked saved text only: no asynchronous work, no engine and no dependency of Next. */
export function preparedOutputState(state: EngineState, destination: TranslationDestination): EngineState {
  const layer = (value: SlideLayer | null): SlideLayer | null => {
    if (!value) return value;
    const slide = outputSlide(value.slide, destination, state.translationHidden === true);
    return slide === value.slide ? value : { ...value, slide };
  };
  const slide = layer(state.layers.slide);
  const old = state.slideOff ? layer(state.slideOff.layer) : null;
  const next =
    state.next?.kind === 'slide'
      ? outputSlide(state.next.slide, destination, state.translationHidden === true)
      : null;
  if (
    slide === state.layers.slide &&
    old === (state.slideOff?.layer ?? null) &&
    (state.next?.kind !== 'slide' || next === state.next.slide)
  )
    return state;
  return {
    ...state,
    layers: slide === state.layers.slide ? state.layers : { ...state.layers, slide },
    slideOff: state.slideOff && old ? { ...state.slideOff, layer: old } : null,
    next: state.next?.kind === 'slide' && next ? { ...state.next, slide: next } : state.next,
  };
}

/** Reserve competing bands. Video subtitles keep their own precedence and never share translation space. */
export function translationBottom(state: EngineState, height: number): number {
  let edge = height;
  if (state.layers.ticker) edge = Math.min(edge, height * 0.9);
  if (state.layers.messages.length || state.layers.lowerThird) edge = Math.min(edge, height * 0.7);
  if (state.captions?.lines.length || Object.keys(state.videoCaptions ?? {}).length)
    edge = Math.min(edge, height * 0.65);
  return edge;
}
