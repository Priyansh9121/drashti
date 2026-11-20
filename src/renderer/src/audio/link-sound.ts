import { startLivePlayback } from '../render/live-playback';

/*
 * A stream link's sound in the hall (alpha.20, the playback set's slice 8): the audio player's element joined with the
 * link's pictures and kept on the engine's time as they are (render/live-playback.ts: at normal speed always). Behind
 * its pictures (its sound card's clock ran slow), it joins again.
 */

export interface LinkSound {
  /** Lets go of the stream and the decoder. */
  stop: () => void;
  /** Joins again now (every page starting again together). */
  resync: () => void;
}

export function startLinkSound(el: HTMLMediaElement, linkId: string): LinkSound {
  let stopLive: () => void = () => undefined;
  const live = (): void => {
    stopLive = startLivePlayback(el, {
      linkId,
      audible: true,
      onBehind: () => {
        resync();
      },
    });
  };
  const resync = (): void => {
    stopLive();
    live();
  };
  live();
  return {
    stop: () => {
      stopLive();
    },
    resync,
  };
}
