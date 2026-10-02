import {
  type EngineState,
  isLayerEmpty,
  LAYER_NAMES,
  type LayerName,
  type Layers,
} from '../../shared/engine/state';
import type { EngineAction } from './actions';

/** Deep equality for plain JSON data. */
export function sameData(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function withLayers(state: EngineState, layers: Partial<Layers>): EngineState {
  return { ...state, layers: { ...state.layers, ...layers } };
}

function clearLayer(state: EngineState, layer: LayerName): EngineState {
  if (isLayerEmpty(state.layers, layer)) return state;
  return withLayers(state, { [layer]: layer === 'props' || layer === 'messages' ? [] : null });
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] | null {
  const index = items.findIndex((i) => i.id === item.id);
  if (index === -1) return [...items, item];
  if (sameData(items[index], item)) return null;
  return items.map((i, n) => (n === index ? item : i));
}

/**
 * The show engine's pure state transition. Returns the same object when an
 * action changes nothing, so callers can skip broadcasting.
 */
export function reduce(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case 'slide/show': {
      const {
        presentationId,
        slideIndex,
        slideCount,
        arrangementId,
        playlist,
        slide,
        notes,
        at,
        transition,
      } = action;
      const live = state.live;
      const sameCursor =
        live.presentationId === presentationId &&
        live.slideIndex === slideIndex &&
        live.slideCount === slideCount &&
        live.arrangementId === arrangementId &&
        sameData(live.playlist, playlist);
      const current = state.layers.slide;
      const samePlace =
        current !== null && current.presentationId === presentationId && current.slideIndex === slideIndex;
      const sameSlide = samePlace && current.notes === notes && sameData(current.slide, slide);
      if (sameCursor && sameSlide) return state;
      // New content for the live slide (an edit or a re-import) keeps its time, so its videos carry on,
      // and how it came on (a dissolve is not run again).
      const shownAt = samePlace ? current.shownAt : at;
      const came = samePlace ? current.transition : transition;
      return {
        ...state,
        live: sameCursor ? live : { presentationId, slideIndex, slideCount, arrangementId, playlist },
        layers: sameSlide
          ? state.layers
          : {
              ...state.layers,
              slide: {
                presentationId,
                slideIndex,
                slide,
                shownAt,
                notes,
                ...(came ? { transition: came } : {}),
              },
            },
      };
    }
    case 'live/move': {
      const { slideIndex, slideCount, arrangementId } = action;
      const live = state.live;
      if (
        live.slideIndex === slideIndex &&
        live.slideCount === slideCount &&
        live.arrangementId === arrangementId
      )
        return state;
      const slide = state.layers.slide;
      return {
        ...state,
        live: { ...live, slideIndex, slideCount, arrangementId },
        layers:
          slide?.presentationId === live.presentationId && slide.slideIndex !== slideIndex
            ? { ...state.layers, slide: { ...slide, slideIndex } }
            : state.layers,
      };
    }
    case 'live/item': {
      const live = state.live;
      if (live.presentationId === null && sameData(live.playlist, action.playlist)) return state;
      return {
        ...state,
        live: {
          presentationId: null,
          slideIndex: null,
          slideCount: 0,
          arrangementId: null,
          playlist: action.playlist,
        },
      };
    }
    case 'next/set':
      return sameData(state.next, action.next) ? state : { ...state, next: action.next };
    case 'stage/message':
      return state.stageMessage === action.text ? state : { ...state, stageMessage: action.text };
    case 'timers/define': {
      const runs = new Map(state.timers.map((t) => [t.id, t]));
      const timers = action.timers.map((d) => {
        const was = runs.get(d.id);
        return { ...d, startedAt: was?.startedAt ?? null, elapsedMs: was?.elapsedMs ?? 0 };
      });
      return sameData(state.timers, timers) ? state : { ...state, timers };
    }
    case 'timer/run': {
      const { timerId, run } = action;
      const current = state.timers.find((t) => t.id === timerId);
      if (!current || (current.startedAt === run.startedAt && current.elapsedMs === run.elapsedMs))
        return state;
      return { ...state, timers: state.timers.map((t) => (t.id === timerId ? { ...t, ...run } : t)) };
    }
    case 'layer/clear':
      return clearLayer(state, action.layer);
    case 'layers/clearAll':
      return LAYER_NAMES.reduce<EngineState>((s, layer) => clearLayer(s, layer), state);
    case 'blackout/set':
      return state.blackout === action.on ? state : { ...state, blackout: action.on };
    case 'logo/set':
      if (action.prop === null) return state.logo === null ? state : { ...state, logo: null };
      return sameData(state.logo, action.prop) ? state : { ...state, logo: action.prop };
    case 'show/put':
      return state.live === action.live && state.layers === action.layers
        ? state
        : { ...state, live: action.live, layers: action.layers };
    case 'background/set':
      return sameData(state.layers.background, action.background)
        ? state
        : withLayers(state, { background: action.background });
    case 'audio/set':
      return sameData(state.layers.audio, action.audio) ? state : withLayers(state, { audio: action.audio });
    case 'mask/set':
      return sameData(state.layers.masks, action.mask) ? state : withLayers(state, { masks: action.mask });
    case 'prop/show': {
      const props = upsert(state.layers.props, action.prop);
      return props ? withLayers(state, { props }) : state;
    }
    case 'prop/hide': {
      if (!state.layers.props.some((p) => p.id === action.propId)) return state;
      return withLayers(state, { props: state.layers.props.filter((p) => p.id !== action.propId) });
    }
    case 'message/show': {
      const messages = upsert(state.layers.messages, action.message);
      return messages ? withLayers(state, { messages }) : state;
    }
    case 'message/hide': {
      if (!state.layers.messages.some((m) => m.id === action.messageId)) return state;
      return withLayers(state, { messages: state.layers.messages.filter((m) => m.id !== action.messageId) });
    }
  }
}
