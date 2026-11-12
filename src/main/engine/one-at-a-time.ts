import { type Playing, playingNow } from '../../shared/engine/playing';
import type { EngineState, VideoSeeks } from '../../shared/engine/state';
import { type PlaybackSeek, playbackAtMs, playbackSpanMs } from '../../shared/media';
import type { EngineAction } from './actions';

/*
 * LIVE shows one thing at a time (Session 56, the owner's words of 11 Nov 2026: "LIVE: only one at a time. A video takes
 * off the wallpaper and black-out, and the other way round. Fix it wherever two show together, in Simple and Pro Mode").
 * While the Wallpaper or Black-out is on, no video plays on the audience screens: until now both covered a video that
 * played on underneath, heard in the hall and its time running out unseen. The rule is kept here, once, for every change
 * the engine makes (show-engine.ts applyAt), so every way in comes through it: the window, a phone, Companion's API, MIDI,
 * the quick bar, Oops and Put it back, and restart recovery.
 *
 * - A video going up by the operator's own change (a command: a row's click, Next, Back, Media, a slide's background
 *   video or a video on the slide, a video input on the audience, Oops, Put it back, Play on its time bar) takes both
 *   covers off, so what was put up is seen.
 * - Wallpaper and Black-out each take the other off in the same change. An older save with both recovers Black-out.
 * - A cover going on (or a video the engine would bring up by itself under one: a slide moving on by itself, restart
 *   recovery of a file that held both) stops what plays: the background's video or video input comes off, as clearing
 *   the background does; a video on the slide up or in the picture-in-picture box waits where it is, paused, as the time
 *   bar's Pause holds it, with its slide or box under the cover, until Play.
 *
 * Music and sounds play on (they are heard, not seen; music under a video is Part 7's), and a picture or a slide stays
 * under a cover, back as it was when the cover comes off.
 */

/** The background's video file or video input up now, by what it is and when it went up; null for none. */
function backgroundVideo(state: EngineState): string | null {
  const bg = state.layers.background;
  if (bg?.kind === 'media' && bg.media === 'video') return `video:${bg.mediaId}@${String(bg.startedAt)}`;
  if (bg?.kind === 'input') return `input:${bg.inputId}@${String(bg.startedAt)}`;
  return null;
}

/** Whether a video is playing at `now`: not paused (nor waiting for its click), and not held at its end point. */
function playsNow(p: Playing, now: number): boolean {
  if (p.paused) return false;
  const d = p.durationMs;
  if (p.clock.loop || d === undefined || d <= 0) return true;
  return playbackAtMs(p.clock, d, now) < playbackSpanMs(p.clock.clip, d).end;
}

/** The videos playing on the slide up and in the picture-in-picture box at `now` (their time bars' rows). */
function videosPlaying(state: EngineState, now: number): Playing[] {
  return playingNow(state).filter(
    (p) => ((p.ref.layer === 'slide' && p.sound !== true) || p.ref.layer === 'pip') && playsNow(p, now),
  );
}

/** A video playing, by its place, its file and when it went up. */
const keyOf = (p: Playing): string => `${p.ref.layer}:${p.mediaId}@${String(p.clock.startedAt)}`;

/**
 * Where a playing video waits from `now`: where it is, paused, as the time bar's Pause holds it. Its length not known yet
 * (it went up a moment ago): as far in as it has played since it went up or last jumped.
 */
function pausedHere(p: Playing, now: number): PlaybackSeek {
  const d = p.durationMs;
  const { clock } = p;
  const toMs =
    d !== undefined && d > 0
      ? playbackAtMs(clock, d, now)
      : (clock.seek?.toMs ?? clock.clip?.startMs ?? 0) +
        Math.max(0, now - (clock.seek?.at ?? clock.startedAt));
  return { at: now, toMs, paused: true };
}

/** What stops every video under a cover (see above); none when nothing plays. */
function stopped(state: EngineState, now: number): EngineAction[] {
  const actions: EngineAction[] = [];
  if (backgroundVideo(state) !== null) actions.push({ type: 'layer/clear', layer: 'background' });
  const playing = videosPlaying(state, now);
  const slide = state.layers.slide;
  const onSlide = playing.filter((p) => p.ref.layer === 'slide');
  if (slide && onSlide.length > 0) {
    const seeks: VideoSeeks = { ...slide.seeks };
    for (const p of onSlide) seeks[p.mediaId] = pausedHere(p, now);
    actions.push({ type: 'slide/put', layer: { ...slide, seeks } });
  }
  const box = state.layers.pip;
  const inBox = playing.find((p) => p.ref.layer === 'pip');
  if (box && inBox)
    actions.push({
      type: 'pip/set',
      layer: { ...box, seeks: { ...box.seeks, [inBox.mediaId]: pausedHere(inBox, now) } },
    });
  return actions;
}

/** What puts something up on the audience's picture: a slide (a deck's click too), a background, or layers put back. */
const PUTS_UP: ReadonlySet<EngineAction['type']> = new Set([
  'slide/show',
  'slide/put',
  'background/set',
  'show/put',
]);

/**
 * Whether a change puts something up on the audience's picture (Session 56, the lead's open question to the owner,
 * slides and pictures): a slide (a click on the slide already up too, Next, Back, a deck's click, a timer shown alone),
 * a picture, a colour or another app's window as the background, or what Back, Oops and Put it back bring back; and
 * something is up there after it. Only the operator's own changes count (show-engine.ts: never the time bar's moves, a
 * jump to a marker or what the engine does by itself), and never what is heard or laid over the picture (a sound, a
 * message, a lower third, the ticker, the picture-in-picture box).
 */
export function putsUp(actions: readonly EngineAction[], next: EngineState): boolean {
  return (
    (next.layers.slide !== null || next.layers.background !== null) &&
    actions.some((a) => PUTS_UP.has(a.type))
  );
}

/** Both covers off. */
function coversOff(state: EngineState): EngineAction[] {
  const off: EngineAction[] = [];
  if (state.blackout) off.push({ type: 'blackout/set', on: false });
  if (state.wallpaper) off.push({ type: 'wallpaper/set', on: false });
  return off;
}

/**
 * What keeps LIVE to one thing at a time after a change from `prev` to `next` at `now` (see above): the covers taken off,
 * or what plays stopped; none while no video plays under a cover. `operator`: the operator's own change (a command's),
 * never one the engine makes by itself; `putUp`: it put a slide or a picture up (putsUp), which takes the covers off
 * too, so what is put up is always seen (the lead's open question: a cover going on keeps a slide or a picture under it).
 */
export function oneAtATime(
  prev: EngineState,
  next: EngineState,
  how: { operator: boolean; putUp: boolean },
  now: number,
): EngineAction[] {
  if (!next.blackout && !next.wallpaper) return [];
  const blackoutWentOn = next.blackout && !prev.blackout;
  const wallpaperWentOn = next.wallpaper && !prev.wallpaper;
  const coverWentOn = blackoutWentOn || wallpaperWentOn;
  if (how.operator && how.putUp && !coverWentOn) return coversOff(next);

  const actions: EngineAction[] = [];
  if (next.blackout && next.wallpaper) {
    // The new cover wins. For recovery with both covers, keep the one the audience saw.
    const wallpaperWins = how.operator && wallpaperWentOn && !blackoutWentOn;
    actions.push(wallpaperWins ? { type: 'blackout/set', on: false } : { type: 'wallpaper/set', on: false });
  }

  const bg = backgroundVideo(next);
  const playing = videosPlaying(next, now);
  if (bg === null && playing.length === 0) return actions;
  const before = new Set(videosPlaying(prev, now).map(keyOf));
  const cameUp = (bg !== null && bg !== backgroundVideo(prev)) || playing.some((p) => !before.has(keyOf(p)));
  if (how.operator && cameUp && !coverWentOn) return coversOff(next);
  return actions.concat(stopped(next, now));
}
