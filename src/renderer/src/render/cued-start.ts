import type { EngineState } from '../../../shared/engine/state';

/** Hold the already drawn scene locally until Go, without duplicating its payload on the wire. */
export class CuedStartKeeper {
  private previous: EngineState | null = null;
  private held: { id: string; before: EngineState } | null = null;

  at(state: EngineState | null, now: number): EngineState | null {
    if (!state) {
      this.previous = null;
      this.held = null;
      return null;
    }
    const start = state.videoStart;
    const bg = state.layers.background;
    if (
      !start ||
      bg?.kind !== 'media' ||
      bg.media !== 'video' ||
      bg.cueId !== start.id ||
      now >= start.at ||
      state.stopped ||
      state.blackout ||
      state.wallpaper
    ) {
      this.previous = state;
      this.held = null;
      return state;
    }
    if (this.held?.id !== start.id && this.previous?.videoCue?.id === start.id)
      this.held = { id: start.id, before: this.previous };
    this.previous = state;
    const before = this.held?.before;
    const cue = before?.videoCue;
    if (!before || !cue) return state;
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
