import {
  type EngineState,
  isLayerEmpty,
  LAYER_NAMES,
  type LayerName,
  type Layers,
  type MessageItem,
  type PropItem,
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
        inputMissing,
        fileMissing,
        soundMissing,
        clips,
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
      // The video input its cue named that is not on this computer (Session 51): as its cues found it now, or,
      // when they did not run, as the slide up said.
      const missing =
        inputMissing === undefined ? (samePlace ? current.inputMissing : undefined) : inputMissing;
      // The same for its background cue's file that is missing (Session 52), and its sound cue's (Session 53).
      const gone = fileMissing === undefined ? (samePlace ? current.fileMissing : undefined) : fileMissing;
      const unheard =
        soundMissing === undefined ? (samePlace ? current.soundMissing : undefined) : soundMissing;
      // Its videos' points as the library has them now (Session 52): new ones are new content, as an edit is.
      const sameSlide =
        samePlace &&
        current.notes === notes &&
        sameData(current.slide, slide) &&
        current.inputMissing === (missing ?? undefined) &&
        current.fileMissing === (gone ?? undefined) &&
        current.soundMissing === (unheard ?? undefined) &&
        sameData(current.clips, clips);
      if (sameCursor && sameSlide) return state;
      // New content for the live slide (an edit or a re-import) keeps its time, so its videos carry on,
      // and how it came on (a dissolve is not run again).
      const shownAt = samePlace ? current.shownAt : at;
      const came = samePlace ? current.transition : transition;
      return {
        ...state,
        live: sameCursor ? live : { presentationId, slideIndex, slideCount, arrangementId, playlist },
        // A slide up again: nothing is leaving any more (Session 27).
        slideOff: null,
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
                ...(missing ? { inputMissing: missing } : {}),
                ...(gone ? { fileMissing: gone } : {}),
                ...(unheard ? { soundMissing: unheard } : {}),
                ...(clips ? { clips } : {}),
              },
            },
      };
    }
    case 'slide/put':
      // In the slide's place, the live position as it was; a slide up again: nothing is leaving any more.
      return sameData(state.layers.slide, action.layer) && state.slideOff === null
        ? state
        : { ...state, slideOff: null, layers: { ...state.layers, slide: action.layer } };
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
    case 'idle/run':
      return { ...state, idle: { ...state.idle, startedAt: action.startedAt } };
    case 'idle/set':
      return { ...state, idle: { ...action.content, startedAt: state.idle.startedAt } };
    case 'quote/set':
      return { ...state, quote: action.quote };
    case 'calendar/set':
      return { ...state, calendar: action.calendar };
    case 'cue/set':
      return { ...state, cue: action.cue };
    case 'next/set':
      return sameData(state.next, action.next) ? state : { ...state, next: action.next };
    case 'upcoming/set':
      return sameData(state.upcoming, action.upcoming) ? state : { ...state, upcoming: action.upcoming };
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
    case 'layer/clear': {
      const cleared = clearLayer(state, action.layer);
      // The lower third taken off on its own (Session 44): its out plays from then, as hiding it does.
      if (action.layer === 'lowerThird')
        return cleared === state || !state.layers.lowerThird || action.at === undefined
          ? cleared
          : { ...cleared, lowerThirdOff: { layer: state.layers.lowerThird, at: action.at } };
      // The picture-in-picture box taken off on its own (Session 50): its out plays from then, as Take off's does.
      if (action.layer === 'pip')
        return cleared === state || !state.layers.pip || action.at === undefined
          ? cleared
          : { ...cleared, pipOff: { layer: state.layers.pip, at: action.at } };
      // The slide taken off on its own, and when: a lower third leaves with a short fade (Session 27).
      const off = state.layers.slide;
      if (action.layer !== 'slide' || cleared === state || !off || action.at === undefined) return cleared;
      return { ...cleared, slideOff: { layer: off, at: action.at } };
    }
    case 'layers/clearAll': {
      // Everything at once, and at once: no lower third fades, a Look's or one of the Lower Thirds (Session 44),
      // and no picture-in-picture box plays its out (Session 50).
      const cleared = LAYER_NAMES.reduce<EngineState>((s, layer) => clearLayer(s, layer), state);
      return cleared.slideOff === null && cleared.lowerThirdOff === null && cleared.pipOff === null
        ? cleared
        : { ...cleared, slideOff: null, lowerThirdOff: null, pipOff: null };
    }
    case 'lowerThird/show': {
      // The same one again (its words or look changed while up) keeps its time: its in does not play again.
      const was = state.layers.lowerThird;
      const layer = was?.id === action.layer.id ? { ...action.layer, shownAt: was.shownAt } : action.layer;
      if (sameData(was, layer) && state.lowerThirdOff === null) return state;
      return { ...withLayers(state, { lowerThird: layer }), lowerThirdOff: null };
    }
    case 'lowerThird/hide': {
      const was = state.layers.lowerThird;
      if (!was) return state;
      return { ...withLayers(state, { lowerThird: null }), lowerThirdOff: { layer: was, at: action.at } };
    }
    case 'pip/set':
      // A box up (Session 50): nothing is leaving any more.
      return sameData(state.layers.pip, action.layer) && state.pipOff === null
        ? state
        : { ...withLayers(state, { pip: action.layer }), pipOff: null };
    case 'pip/hide': {
      const was = state.layers.pip;
      if (!was) return state;
      return { ...withLayers(state, { pip: null }), pipOff: { layer: was, at: action.at } };
    }
    case 'blackout/set':
      return state.blackout === action.on ? state : { ...state, blackout: action.on };
    case 'logo/set': {
      if (action.prop === null) return state.logo === null ? state : { ...state, logo: null };
      // Its videos play from when it went up; the same logo again keeps its time (Session 27).
      const shownAt =
        state.logo?.id === action.prop.id ? state.logo.shownAt : (action.prop.shownAt ?? action.at);
      const logo: PropItem = shownAt === undefined ? action.prop : { ...action.prop, shownAt };
      return sameData(state.logo, logo) ? state : { ...state, logo };
    }
    case 'show/put':
      return state.live === action.live && state.layers === action.layers
        ? state
        : {
            ...state,
            live: action.live,
            layers: action.layers,
            // A lower third put back is up again: no out plays (Session 44); a box too (Session 50).
            lowerThirdOff: action.layers.lowerThird ? null : state.lowerThirdOff,
            pipOff: action.layers.pip ? null : state.pipOff,
          };
    case 'background/set':
      return sameData(state.layers.background, action.background)
        ? state
        : withLayers(state, { background: action.background });
    case 'audio/set':
      return sameData(state.layers.audio, action.audio) ? state : withLayers(state, { audio: action.audio });
    case 'mask/set':
      return sameData(state.layers.masks, action.mask) ? state : withLayers(state, { masks: action.mask });
    case 'advance/set':
      return sameData(state.autoAdvance, action.autoAdvance)
        ? state
        : { ...state, autoAdvance: action.autoAdvance };
    case 'repeat/set':
      return sameData(state.repeat, action.repeat) ? state : { ...state, repeat: action.repeat };
    case 'pictures/set':
      return sameData(state.pictures, action.pictures) ? state : { ...state, pictures: action.pictures };
    case 'zoom/set':
      return sameData(state.liveZoom, action.liveZoom) ? state : { ...state, liveZoom: action.liveZoom };
    case 'prop/show': {
      // Its videos play from when it went up; one already up keeps its time (Session 27).
      const was = state.layers.props.find((p) => p.id === action.prop.id);
      const shownAt = was?.shownAt ?? action.prop.shownAt ?? action.at;
      const prop: PropItem = shownAt === undefined ? action.prop : { ...action.prop, shownAt };
      const props = upsert(state.layers.props, prop);
      return props ? withLayers(state, { props }) : state;
    }
    case 'prop/hide': {
      if (!state.layers.props.some((p) => p.id === action.propId)) return state;
      return withLayers(state, { props: state.layers.props.filter((p) => p.id !== action.propId) });
    }
    case 'message/show': {
      // Its time on the screens: one already up keeps its own (an update never plays the entrance again).
      const was = state.layers.messages.find((m) => m.id === action.message.id);
      const shownAt = was?.shownAt ?? action.message.shownAt ?? action.at;
      const message: MessageItem = shownAt === undefined ? action.message : { ...action.message, shownAt };
      const messages = upsert(state.layers.messages, message);
      return messages ? withLayers(state, { messages }) : state;
    }
    case 'message/hide': {
      if (!state.layers.messages.some((m) => m.id === action.messageId)) return state;
      return withLayers(state, { messages: state.layers.messages.filter((m) => m.id !== action.messageId) });
    }
    case 'ticker/show': {
      const items = upsert(state.layers.ticker?.items ?? [], action.item);
      // The words start again; the band keeps the time it came up (its entrance plays once, Session 27).
      const shownAt = state.layers.ticker ? state.layers.ticker.shownAt : action.at;
      return items
        ? withLayers(state, {
            ticker:
              shownAt === undefined
                ? { items, startedAt: action.at }
                : { items, startedAt: action.at, shownAt },
          })
        : state;
    }
    case 'ticker/hide': {
      const ticker = state.layers.ticker;
      if (!ticker?.items.some((i) => i.id === action.itemId)) return state;
      const items = ticker.items.filter((i) => i.id !== action.itemId);
      const kept =
        ticker.shownAt === undefined
          ? { items, startedAt: action.at }
          : { items, startedAt: action.at, shownAt: ticker.shownAt };
      return withLayers(state, { ticker: items.length > 0 ? kept : null });
    }
    case 'ticker/set':
      return sameData(state.layers.ticker, action.ticker)
        ? state
        : withLayers(state, { ticker: action.ticker });
    case 'look/set':
      return sameData(state.look, action.look) ? state : { ...state, look: action.look };
  }
}
