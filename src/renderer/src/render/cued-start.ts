import type { EngineState } from '../../../shared/engine/state';

/** Every top-level field the same but videoStart, which Main's patch at Go clears (show-engine.ts scheduleVideoCue). */
function onlyStartCleared(last: EngineState, state: EngineState): boolean {
  if (state.videoStart || !last.videoStart) return false;
  const keys = new Set([...Object.keys(last), ...Object.keys(state)]) as Set<keyof EngineState>;
  for (const key of keys) if (key !== 'videoStart' && !Object.is(last[key], state[key])) return false;
  return true;
}

/** Hold the already drawn scene locally until Go, without duplicating its payload on the wire. */
export class CuedStartKeeper {
  private previous: EngineState | null = null;
  private held: { id: string; at: number; before: EngineState; lastRaw: EngineState } | null = null;

  /**
   * `holdPastGo` (the operator's LIVE preview alone, QA23-CUELIVE-1): whether, past its Go at `at`, cue `id` is still
   * held, its cued picture not started yet. Through that, LIVE keeps its scene until its picture has set its rate at Go,
   * whether its own Go-moment work or Main's patch at Go (clearing videoStart, nothing else) comes first; any other
   * change lets it go at once. A change Main makes between Go and its own patch at Go (a Next while Main is busy then)
   * keeps videoStart, so LIVE holds it too, until its picture's start: the rule every page has for a change before Go.
   * Left out (every other page): held until Go, as before.
   */
  constructor(private readonly holdPastGo?: (id: string, at: number, now: number) => boolean) {}

  /** The cue held now, and its Go (null with none). */
  holding(): { id: string; at: number } | null {
    return this.held ? { id: this.held.id, at: this.held.at } : null;
  }

  /**
   * `raw`: the engine's own state that `state` was drawn from (a page's prepared copy has new objects on every call
   * with translated slides around: a22-review-cuelive SHOULD-5); compared for Main's patch at Go.
   */
  at(state: EngineState | null, now: number, raw: EngineState | null = state): EngineState | null {
    if (!state) {
      this.previous = null;
      this.held = null;
      return null;
    }
    const start = state.videoStart;
    const bg = state.layers.background;
    const goPassed = (id: string, at: number) => now >= at && !(this.holdPastGo?.(id, at, now) ?? false);
    const held = this.held;
    if (
      held &&
      this.holdPastGo &&
      raw &&
      !start &&
      onlyStartCleared(held.lastRaw, raw) &&
      !goPassed(held.id, held.at)
    )
      return this.view(held.before, state);
    if (
      !start ||
      bg?.kind !== 'media' ||
      bg.media !== 'video' ||
      bg.cueId !== start.id ||
      goPassed(start.id, start.at) ||
      state.stopped ||
      state.blackout ||
      state.wallpaper
    ) {
      this.previous = state;
      this.held = null;
      return state;
    }
    if (this.held?.id !== start.id && this.previous?.videoCue?.id === start.id)
      this.held = { id: start.id, at: start.at, before: this.previous, lastRaw: raw ?? state };
    else if (this.held && this.holdPastGo) this.held = { ...this.held, at: start.at, lastRaw: raw ?? state };
    this.previous = state;
    return this.held ? this.view(this.held.before, state) : state;
  }

  /** The scene held: the one before the cue's Go, with the cue armed on the decoder (its own background). */
  private view(before: EngineState, state: EngineState): EngineState {
    const cue = before.videoCue;
    const bg = state.layers.background;
    if (!cue || bg?.kind !== 'media') return state;
    return {
      ...state,
      live: before.live,
      layers: {
        ...state.layers,
        background: before.layers.background,
        slide: before.layers.slide,
        pip: before.layers.pip,
        audio: before.layers.audio,
      },
      blackout: before.blackout,
      wallpaper: before.wallpaper,
      slideOff: before.slideOff,
      pipOff: before.pipOff,
      videoCaptions: before.videoCaptions,
      videoFiles: before.videoFiles,
      videoShapes: before.videoShapes,
      pictures: before.pictures,
      opaquePictures: before.opaquePictures,
      videoCue: { ...cue, background: { ...bg, media: 'video' } },
      // Arm the child with the pair now; its gains and activation still wait for the future Go.
      videoCrossfade: state.videoCrossfade,
      sound: before.sound
        ? { ...before.sound, ...(state.sound?.levels ? { levels: state.sound.levels } : {}) }
        : state.sound,
    };
  }
}
