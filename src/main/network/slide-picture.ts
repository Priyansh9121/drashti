import { AUDIENCE_TIMER_FADE_MS } from '../../shared/audience-timer';
import { nativeStepTiming, stepTiming } from '../../shared/deck-show';
import { playingNow } from '../../shared/engine/playing';
import type { EngineState, LowerThirdLayer, MessageItem } from '../../shared/engine/state';
import { DEFAULT_LIVE_GROUP_LOOK, shows } from '../../shared/looks';
import { animationById, animationLength, cutIntoUnits } from '../../shared/lower-third-animations';
import { shownLines } from '../../shared/lower-thirds';
import { playbackAtMs, playbackSpanMs } from '../../shared/media';
import { messageAnimation } from '../../shared/message-look';
import { SLOW_ZOOM_MS, type Transition } from '../../shared/model';
import { ZOOM_GLIDE_MS } from '../../shared/picture-look';
import { PIP_OUT_MS, pipSwapMs } from '../../shared/pip';
import { LOWER_THIRD_MAX_LINES } from '../../shared/program';
import { type ChosenWallpaper, wallpaperFrame } from '../../shared/wallpapers';

/*
 * When a phone's Save may capture a deck's click (Session 57, C6, and its review): never while anything on the hall
 * screens moves, nor when the engine is to change them by itself within the capture's time. Each by the engine's
 * clock, as the screens draw it; where only the screens know the movement (render/), the longer of Calm's and Bold's.
 */

/** The longest a phone's Save waits for the hall screens to settle. */
export const SETTLE_MS = 3_000;
/** The capture's own time limit (pdf-copy-session.ts). */
export const CAPTURE_MS = 8_000;
/** The network's process waits 10 s for Main's answer (worker/run.ts): a phone's Save is answered within 9. */
export const ANSWER_MS = 9_000;

/** The band of standard messages comes in over Calm's 250 ms or Bold's 300 (render/entrance.ts). */
const BANNER_IN_MS = 300;
/**
 * A key and fill pair's lower third (render/lower-third-motion.ts): coming in or changing, Bold's with six lines the
 * longest (Calm's change takes 400 ms); and going out.
 */
const SLIDE_LOWER_THIRD_MS = { in: 120 + (LOWER_THIRD_MAX_LINES - 1) * 60 + 360, out: 310 };

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

/** A message's in or out, its words cut into units as the screens cut them (render/HallMessages.tsx). */
function messageMs(message: MessageItem, phase: 'in' | 'out'): number {
  const animation = messageAnimation(message.look);
  let units = 0;
  for (const part of message.parts ?? [{ kind: 'text' as const, text: message.text }])
    if (part.kind === 'text') units += cutIntoUnits([part.text], animation).units;
    else if (animation.unit !== 'box') units++;
  return animationLength(animation, phase, units);
}

/** The chosen wallpaper is on a hall screen: under the Wallpaper, or on a group's screens with nothing up there. */
function wallpaperShows(state: EngineState): boolean {
  if (state.wallpaper) return true;
  const { background, slide, pip } = state.layers;
  // A group the state does not list draws with the defaults (shared/looks.ts groupLookIn); the slides in the box show
  // only with the slide (render/Scene.tsx).
  return [DEFAULT_LIVE_GROUP_LOOK, ...Object.values(state.look.groups)].some(
    (group) =>
      (background === null || !shows(group, 'background')) &&
      (slide === null || !shows(group, 'slide')) &&
      (pip === null || pip.source.kind === 'slides' || !shows(group, 'pip')),
  );
}

/** The chosen wallpaper where it shows and goes round (one picture never changes), else null. */
function wallpaperGoingRound(state: EngineState): ChosenWallpaper | null {
  const wallpaper = state.chosenWallpaper;
  return wallpaper && wallpaper.pictures.length > 1 && wallpaperShows(state) ? wallpaper : null;
}

/** A wallpaper's pictures' time each, and its fade (shared/wallpapers.ts wallpaperFrame). */
function wallpaperTimes(
  wallpaper: ChosenWallpaper,
  now: number,
): { each: number; fade: number; start: number } {
  const each = Math.max(1, wallpaper.secondsEach) * 1000;
  const fade = Math.min(Math.max(0, wallpaper.fadeMs), each / 2);
  const start = wallpaper.since + Math.floor(Math.max(0, now - wallpaper.since) / each) * each;
  return { each, fade, start };
}

/** When the timed changes on the screens will have ended. A live source may keep moving. */
export function slidePictureReadyAt(state: EngineState, now: number): number {
  const { slide, background, pip, lowerThird, ticker, timer, messages } = state.layers;
  if (
    ticker ||
    timer ||
    slide?.timer ||
    background?.kind === 'input' ||
    background?.kind === 'window' ||
    pip?.source.kind === 'input' ||
    pip?.source.kind === 'window' ||
    (lowerThird?.look.motion && lowerThird.look.motion !== 'none') ||
    // A message's live timer changes every second.
    messages.some((m) => m.parts?.some((part) => part.kind === 'timer'))
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
    // A timer for the audience fading out (render/AudienceTimer.tsx), and the live zoom's glide: a pinch or a drag,
    // from the window or a phone, starts it again.
    state.timerOff ? state.timerOff.at + AUDIENCE_TIMER_FADE_MS : now,
    state.liveZoom ? state.liveZoom.at + ZOOM_GLIDE_MS : now,
  );
  // Messages with a look of their own come in and go out (render/HallMessages.tsx); the band of the standard ones
  // comes in from when the first of them went up (render/Scene.tsx MessageBanner), simply there for one put back.
  for (const message of messages)
    if (message.look && message.shownAt !== undefined)
      readyAt = Math.max(readyAt, message.shownAt + messageMs(message, 'in'));
  for (const off of state.messagesOff ?? [])
    if (off.message.look && !messages.some((m) => m.id === off.message.id))
      readyAt = Math.max(readyAt, off.at + messageMs(off.message, 'out'));
  const standard = messages.filter((m) => !m.look);
  if (standard.length > 0 && standard.every((m) => m.shownAt !== undefined))
    readyAt = Math.max(readyAt, Math.min(...standard.map((m) => m.shownAt ?? now)) + BANNER_IN_MS);
  // A key and fill pair draws the slide's words as a lower third that moves by itself.
  if (Object.values(state.look.groups).some((g) => g.slides === 'lowerThird' && shows(g, 'slide')))
    readyAt = Math.max(
      readyAt,
      slide ? slide.shownAt + SLIDE_LOWER_THIRD_MS.in : now,
      state.slideOff ? state.slideOff.at + SLIDE_LOWER_THIRD_MS.out : now,
    );
  // The chosen wallpaper fading into its next picture, where it shows.
  const wallpaper = wallpaperGoingRound(state);
  if (wallpaper && (wallpaperFrame(wallpaper, now)?.fade ?? 0) > 0) {
    const { each, start } = wallpaperTimes(wallpaper, now);
    readyAt = Math.max(readyAt, start + each);
  }
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

/** When the engine next changes the screens by itself; Infinity when nothing is due. Not looked at yet (red). */
export function nextScheduledChange(_state: EngineState, _now: number): number {
  return Infinity;
}

/** Wait for the screens to settle; then when the capture must be over by, or null for the slide as it starts. */
export async function waitForSlidePicture(
  state: () => EngineState,
  now: () => number,
): Promise<number | null> {
  const at = now();
  const delay = slidePictureReadyAt(state(), at) - at;
  if (delay > SETTLE_MS) return null;
  if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
  const then = now();
  return slidePictureReadyAt(state(), then) <= then ? then + CAPTURE_MS : null;
}
