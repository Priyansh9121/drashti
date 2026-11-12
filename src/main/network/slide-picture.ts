import { nativeStepTiming, stepTiming } from '../../shared/deck-show';
import { playingNow } from '../../shared/engine/playing';
import type { EngineState, LowerThirdLayer } from '../../shared/engine/state';
import { animationById, animationLength, cutIntoUnits } from '../../shared/lower-third-animations';
import { shownLines } from '../../shared/lower-thirds';
import { playbackAtMs, playbackSpanMs } from '../../shared/media';
import { SLOW_ZOOM_MS, type Transition } from '../../shared/model';
import { PIP_OUT_MS, pipSwapMs } from '../../shared/pip';

const timeOf = (transition: Transition | undefined) =>
  transition?.kind === 'zoom'
    ? Math.max(transition.durationMs, transition.spanMs ?? SLOW_ZOOM_MS)
    : (transition?.durationMs ?? 0);

function lowerThirdMs(layer: LowerThirdLayer, phase: 'in' | 'out'): number {
  const animation = animationById(
    phase === 'out' ? (layer.outAnimation ?? layer.animation) : layer.animation,
  );
  return animationLength(animation, phase, cutIntoUnits(shownLines(layer.lines), animation).units);
}

/** When the timed changes on the screens will have ended. A live source may keep moving. */
export function slidePictureReadyAt(state: EngineState, now: number): number {
  const { slide, background, pip, lowerThird, ticker, timer } = state.layers;
  if (
    ticker ||
    timer ||
    slide?.timer ||
    background?.kind === 'input' ||
    background?.kind === 'window' ||
    pip?.source.kind === 'input' ||
    pip?.source.kind === 'window' ||
    (lowerThird?.look.motion && lowerThird.look.motion !== 'none')
  )
    return Infinity;
  const native = slide ? nativeStepTiming(slide) : null;
  const baked = slide ? stepTiming(slide) : null;
  if (baked?.step.holdId && !baked.still) return Infinity;
  const click = native ?? baked;
  const fade = background && 'fade' in background ? background.fade : undefined;
  const pipMs = pipSwapMs(['bold']);
  let readyAt = Math.max(
    now,
    slide ? slide.shownAt + timeOf(slide.transition) : now,
    click?.endsAt ?? now,
    click?.drashti ? click.shownAt + timeOf(click.drashti.transition) : now,
    fade ? fade.at + fade.durationMs : now,
    state.slideOff ? state.slideOff.at + timeOf(state.slideOff.layer.transition) : now,
    pip ? Math.max(pip.shownAt, pip.changed?.at ?? 0) + pipMs : now,
    state.pipOff ? state.pipOff.at + PIP_OUT_MS.bold : now,
    lowerThird ? lowerThird.shownAt + lowerThirdMs(lowerThird, 'in') : now,
    state.lowerThirdOff ? state.lowerThirdOff.at + lowerThirdMs(state.lowerThirdOff.layer, 'out') : now,
  );
  for (const video of playingNow(state)) {
    if (video.ref.layer === 'audio' || video.sound || video.paused) continue;
    if (!video.durationMs || video.clock.loop) return Infinity;
    readyAt = Math.max(
      readyAt,
      now +
        playbackSpanMs(video.clock.clip, video.durationMs).end -
        playbackAtMs(video.clock, video.durationMs, now),
    );
  }
  return readyAt;
}

export async function waitForSlidePicture(state: () => EngineState, now: () => number): Promise<boolean> {
  const at = now();
  const delay = slidePictureReadyAt(state(), at) - at;
  if (delay > 3_000) return false;
  if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
  const then = now();
  return slidePictureReadyAt(state(), then) <= then;
}
