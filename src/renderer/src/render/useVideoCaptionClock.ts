import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import { playingNow } from '../../../shared/engine/playing';
import type { CaptionScreen } from '../../../shared/captions';
import type { ActualVideoClock } from '../../../shared/video-caption-display';
import { captionAt, type VideoCaptionCue } from '../../../shared/video-captions';
import { watchVideoClock } from './video-caption-clock';

/** One Scene's element, so two previews or output canvases on one page never borrow each other's clock. */
export function useVideoCaptionClock(
  state: EngineState,
  screen: CaptionScreen,
  root?: RefObject<HTMLDivElement | null>,
): ActualVideoClock | null {
  const playing = useMemo(
    () =>
      playingNow(state).find(
        (p) =>
          p.ref.layer !== 'audio' && !p.sound && !p.clock.seek?.waiting && state.videoCaptions?.[p.mediaId],
      ) ?? null,
    // Only fields that can change what video plays or its selected track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.layers.background, state.layers.slide, state.layers.pip, state.videoCaptions],
  );
  const chosen = playing ? state.videoCaptions?.[playing.mediaId] : undefined;
  const [actual, setActual] = useState<{
    chosen: typeof chosen;
    playing: typeof playing;
    clock: ActualVideoClock;
  } | null>(null);
  useEffect(() => {
    const canvas = root?.current;
    if (!canvas || !playing || !chosen || screen === 'stage') return;
    let attached: HTMLVideoElement | null = null;
    let stop: (() => void) | null = null;
    let previous: VideoCaptionCue | null | undefined;
    const attach = () => {
      const video =
        [...canvas.querySelectorAll<HTMLVideoElement>('video[data-caption-media]')].find(
          (v) =>
            v.dataset['captionMedia'] === playing.mediaId &&
            v.dataset['captionStartedAt'] === String(playing.clock.startedAt),
        ) ?? null;
      if (video === attached) return;
      stop?.();
      attached = video;
      previous = undefined;
      if (!video) {
        setActual(null);
        return;
      }
      stop = watchVideoClock(video, (sourceMs) => {
        // Sound and picture… (alpha.20): the captions' own delay against the picture.
        const cue =
          sourceMs === null
            ? null
            : captionAt(chosen.track.cues, sourceMs, playing.clock.clip, chosen.delayMs ?? 0);
        // At video-frame frequency, only a new line/gap changes React state.
        if (cue === previous) return;
        previous = cue;
        setActual(
          sourceMs === null
            ? null
            : { chosen, playing, clock: { mediaId: playing.mediaId, sourceMs, clip: playing.clock.clip } },
        );
      });
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(canvas, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-caption-media', 'data-caption-started-at'],
    });
    return () => {
      observer.disconnect();
      stop?.();
    };
  }, [chosen, playing, root, screen]);
  return actual && actual.chosen === chosen && actual.playing === playing ? actual.clock : null;
}
