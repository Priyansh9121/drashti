import { startLivePlayback } from '../render/live-playback';

/*
 * A stream link's sound in the hall (alpha.20, the playback set's slice 8): the audio player's element joined with the
 * link's pictures and kept on the engine's time as they are (render/live-playback.ts: at normal speed always). Behind
 * its pictures (its sound card's clock ran slow), it joins again; and a moment after its player gives up (Chromium's
 * player for a live stream can fail as it begins, code 4, and has nothing to play after), it joins again too, as a
 * screen's picture does (render/LinkView.tsx), never leaving the hall silent while the link plays on (CI
 * x54-1121-004746-1596).
 */

/** How long after its player gives up it joins again (a screen's picture: the same). */
export const LINK_SOUND_AGAIN_MS = 1000;

export interface LinkSound {
  /** Lets go of the stream and the decoder. */
  stop: () => void;
  /** Joins again now (every page starting again together). */
  resync: () => void;
}

export function startLinkSound(el: HTMLMediaElement, linkId: string): LinkSound {
  let stopLive: () => void = () => undefined;
  let again: ReturnType<typeof setTimeout> | null = null;
  let on = true;
  let joinAtMoment = false;
  const live = (): void => {
    stopLive = startLivePlayback(el, {
      linkId,
      audible: true,
      joinAtMoment,
      onBehind: () => {
        resync();
      },
      onError: () => {
        if (!on || again) return;
        again = setTimeout(() => {
          again = null;
          if (on) resync();
        }, LINK_SOUND_AGAIN_MS);
      },
    });
  };
  const resync = (): void => {
    if (again) clearTimeout(again);
    again = null;
    stopLive();
    joinAtMoment = true;
    live();
  };
  live();
  return {
    stop: () => {
      on = false;
      if (again) clearTimeout(again);
      again = null;
      stopLive();
    },
    resync,
  };
}
