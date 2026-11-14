import {
  type CSSProperties,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { nativeDeckMotion, type DeckMedia, type DeckSlide } from '../../../shared/deck';
import {
  deckSlideAt,
  deckStep,
  type DeckVideoTiming,
  lastStep,
  nativeStepTiming,
  type StepTiming,
  stepTiming,
  takingTime,
  videoShowsFrom,
} from '../../../shared/deck-show';
import type { SlideLayer } from '../../../shared/engine/state';
import type { RenderSlide } from '../../../shared/model';
import {
  mediaUrl,
  type PlaybackClip,
  type PlaybackSeek,
  playbackAtMs,
  playbackLeftMs,
  playbackSpanMs,
} from '../../../shared/media';
import { engineNow, onClockJump } from './clock';
import { NativeDeckMotion } from './NativeDeckElement';
import { PlacedInParent } from './Placed';
import { SlideView } from './SlideView';
import { useMediaAttempt } from './media-attempts';
import { useMediaUrl } from './media-urls';
import { catchUpLeftMs, type PlaybackCatchUp, startPlayback } from './playback';
import { PreviewPicture, usePreviewsOnly } from './previews';
import { SlideMovementContext } from './slide-timers';
import { transitionFrame } from './transition-frame';
import { wakeAt } from './wake-at';
import { type StageStill, stageStill } from './stage-deck';

/*
 * A deck's slide as the step showing draws it (Session 54, C2; shared/deck-show.ts), in the place of the slide's
 * picture: the step's clip played from the engine's time (its `stepAt`, less how far into it the step was shown from),
 * then its last frame held, or its hold going round; never a frame decided by this computer's own clock, so the hall's
 * screens, a node, the stream, key and fill, LIVE and the stage show the same step at the same moment (§40). Under it,
 * the step before's last frame, which the clip begins on, covers the moment the clip takes to load. A step with
 * Drashti's own transition goes from that last frame to its clip (over the step's own motion) or to its own last frame
 * (instead of it), frame by frame from the engine's time, as a slide's transition does. A phone draws no video: the
 * step before's last frame while the step moves, then its own, each a small preview.
 *
 * On the spot (Session 57, item 6: a click's clip began to load only at the press, 55-150 ms late and part-way in; a
 * slide's first, 0.2-1.1 s): while a step is up, the next click's clip waits loaded to its first frame, paused and out
 * of sight, and Next plays that very element (kept by its key); a slide's first clip is the one the outputs'
 * Preloader loaded and decoded ahead for the slide Next shows (DeckClipAhead), taken as it comes in. Nothing is loaded
 * twice.
 */

/** A picture or a video filling the box it is drawn in, fitted as the deck's picture is. */
const filling = (fit: CSSProperties['objectFit']): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: fit,
});

/** A still of the deck's (a step's last frame), from this computer's media or, on a node, its copy. */
function Still({
  mediaId,
  fit,
  holder,
  role,
}: {
  mediaId: string;
  fit: CSSProperties['objectFit'];
  /** Where the step keeps it, to show it or not frame by frame. */
  holder: RefObject<HTMLImageElement | null>;
  role: 'under' | 'last';
}) {
  const attempt = useMediaAttempt(mediaId);
  const urlOf = useMediaUrl();
  return (
    <img
      key={attempt}
      ref={holder}
      data-deck-still={role}
      data-media-id={mediaId}
      src={urlOf(mediaId, attempt)}
      alt=""
      draggable={false}
      style={{ ...filling(fit), opacity: 0 }}
    />
  );
}

/** What a step's video is to it: its clip, its hold, or the next click's clip waiting for Next. */
type StepVideoRole = 'clip' | 'hold' | 'preparing';

/** What a step's clip or hold tells it: it has its first frame (it can show), or it cannot be loaded or played. */
interface StepVideoTold {
  onFrame: () => void;
  onError: () => void;
}

/** The incoming layer can show the first clip once its start frame, including any initial seek, has decoded. */
export const DECK_FIRST_FRAME = 'drashti-deck-first-frame';
// A newly shown slide may wait for its first frame. An output joining a slide already on screen uses its clock.
const FRESH_DECK_ENTRY_MS = 500;
const FIRST_FRAME_WAIT_MS = 3000;
/**
 * The fastest a first clip whose first frame came in late plays to catch up on the engine's time (C3's review M1): a
 * tenth faster, which nobody sees, so every screen, the slide's sounds and the engine's next step meet again.
 */
const CATCH_UP_RATE = 1.1;
/**
 * How late a clip loaded ahead at its start frame may come and still play from where it waits (ms), as playback.ts
 * plays a file already where its clock is within that (Next's clip came so before C3, Session 58).
 */
const FROM_WHERE_IT_IS_MS = 50;

/** Why the Preloader holds a deck slide's first clip: the slide Next shows, or the one the operator points at. */
export type AheadFor = 'next' | 'pointed';

/** A deck slide's first clip the Preloader holds, loaded and decoded where its slide's step will start it. */
interface Ahead {
  url: string;
  video: HTMLVideoElement;
  /** Where in the clip it waits (ms): 0 for Next's, past the deck's own transition for a click's (a jump). */
  fromMs: number;
  taken: boolean;
}

/**
 * The first clips this page's Preloader loaded and decoded ahead (Session 57, item 6; C3, Session 58), until a slide's
 * step takes one (FirstClip): at most two, the slide Next shows and the slide the operator points at (a page has one
 * Preloader).
 */
const ahead = new Set<Ahead>();

/** Of the clips held ahead, the one of this file waiting at `fromMs` (ms) first, else any of that file. */
export function chooseAhead<T extends { url: string; fromMs: number }>(
  held: Iterable<T>,
  url: string,
  fromMs: number,
): T | undefined {
  const same = [...held].filter((a) => a.url === url);
  return same.find((a) => Math.abs(a.fromMs - fromMs) < 1) ?? same[0];
}

/**
 * How a slide's first clip starts (C3, Session 57; C3, Session 58), as its step mounts it `mountedAt` (the engine's
 * time) for a slide shown `shownAt`, `fromMs` into the clip. A screen joining a slide already up (`deadline` null)
 * plays it by the engine's time, as any clip. Fresh and cold, it is sought, paused, to that frame from the slide's
 * showing (and plays once the frame is in, catching up then). Loaded ahead at that frame (`warmed`) and mounted within
 * a moment of the slide's showing, it plays from there by the engine's time at once; more than a moment late, from
 * there at once all the same, catching up a tenth faster at most: a seek to where the clock is would be a wait for a
 * frame, the slide going away held meanwhile.
 */
export function firstClipStart(o: {
  deadline: number | null;
  warmed: boolean;
  shownAt: number;
  mountedAt: number;
  fromMs: number;
}): { seek?: PlaybackSeek; catchUp?: PlaybackCatchUp } {
  if (o.deadline === null) return {};
  if (!o.warmed) return { seek: { at: o.shownAt, toMs: o.fromMs, paused: true } };
  if (o.mountedAt - o.shownAt <= FROM_WHERE_IT_IS_MS) return {};
  return playingFrom(o.shownAt, o.fromMs, o.mountedAt);
}

/**
 * A first clip's clock as it plays from its frame (`fromMs` into it) at `at`, as late as the slide's showing makes it
 * (C3's review M1): its frame then, catching up a tenth faster at most until it is on the engine's time.
 */
export function playingFrom(
  shownAt: number,
  fromMs: number,
  at: number,
): { seek: PlaybackSeek; catchUp?: PlaybackCatchUp } {
  const lateMs = Math.max(0, at - shownAt);
  return {
    seek: { at, toMs: fromMs },
    ...(lateMs > 0 ? { catchUp: { at, lateMs, maxRate: CATCH_UP_RATE } } : {}),
  };
}

/**
 * The element the Preloader holds for this file, decoded, now the caller's to play and let go of; else null. The one
 * waiting where the step starts it (`fromMs`) first: Next's waits at its start, a click's past the deck's own
 * transition.
 */
function takeClipAhead(url: string, fromMs: number): HTMLVideoElement | null {
  const chosen = chooseAhead(ahead, url, fromMs);
  if (!chosen) return null;
  ahead.delete(chosen);
  chosen.taken = true;
  chosen.video.removeAttribute('data-preload');
  chosen.video.removeAttribute('data-state');
  chosen.video.removeAttribute('data-deck-ahead');
  return chosen.video;
}

/**
 * The outputs' Preloader's way of loading a deck's slide's first clip ahead (output/Preloader.tsx; Session 57, item
 * 6): as its other videos, muted, out of sight and never played, but in an element of its own that the slide's step
 * takes as it is, decoded, when that slide comes in (FirstClip), so the clip plays from the press. A new element there
 * took 0.2 to 1.1 s to load and draw (the measurement before). For the slide the operator points at (C3, Session 58:
 * a click on its row is a jump, its clip started past the deck's own transition), it waits decoded at that frame.
 */
export function DeckClipAhead({
  mediaId,
  fromMs = 0,
  role = 'next',
}: {
  mediaId: string;
  /** Where the step will start it (ms into the clip). */
  fromMs?: number;
  role?: AheadFor;
}) {
  const attempt = useMediaAttempt(mediaId);
  const holder = useRef<HTMLSpanElement | null>(null);
  // An effect, not a layout effect: when this goes at the moment its slide comes in, the slide's step (its layout
  // effect, first) has taken the element by then, and it is not let go of here.
  useEffect(() => {
    const host = holder.current;
    if (!host) return;
    const url = mediaUrl(mediaId, attempt);
    const video = document.createElement('video');
    const held: Ahead = { url, video, fromMs, taken: false };
    video.muted = true;
    video.playsInline = true;
    video.disablePictureInPicture = true;
    video.preload = 'auto';
    video.setAttribute('data-preload', mediaId);
    video.setAttribute('data-state', 'loading');
    video.setAttribute('data-deck-ahead', role);
    const ready = () => {
      if (!held.taken) video.setAttribute('data-state', 'ready');
    };
    // Its first frame in; a click's then waits for the frame past the deck's own transition.
    const loaded = () => {
      if (held.taken) return;
      if (fromMs <= 0) {
        ready();
        return;
      }
      video.addEventListener('seeked', ready, { once: true });
      video.currentTime = fromMs / 1000;
    };
    const failed = () => {
      if (!held.taken) video.setAttribute('data-state', 'failed');
    };
    video.addEventListener('loadeddata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    host.append(video);
    video.src = url;
    ahead.add(held);
    return () => {
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('seeked', ready);
      video.removeEventListener('error', failed);
      ahead.delete(held);
      // Taken: the step plays it now, and lets go of it.
      if (held.taken) return;
      video.removeAttribute('src');
      video.load();
      video.remove();
    };
  }, [mediaId, attempt, fromMs, role]);
  return <span ref={holder} />;
}

/**
 * A clip or a hold of the deck's, played from the engine's time: from `startedAt`, once or going round. The next
 * click's clip (`startedAt` null; Session 57, item 6) is loaded to its first frame and kept paused, out of sight,
 * while the step before it is up: at Next it is the step's clip (the same key), the very element, and plays from where
 * the clip is by then, at once, with nothing loaded at the press. The step finds it by its role.
 */
function StepVideo({
  mediaId,
  startedAt,
  lateMs = 0,
  loop,
  fit,
  onFrame,
  onError,
  role,
}: {
  mediaId: string;
  /** When it plays from, by the engine's time; null while it waits for Next (the next click's). */
  startedAt: number | null;
  /**
   * How far behind the engine's time it starts (ms): a step's hold after a first clip that came in late and ended
   * late (C3's review M1). It makes that up going round, a tenth faster at most. 0: on time.
   */
  lateMs?: number;
  loop: boolean;
  fit: CSSProperties['objectFit'];
  role: StepVideoRole;
} & Partial<StepVideoTold>) {
  const attempt = useMediaAttempt(mediaId);
  const own = useRef<HTMLVideoElement | null>(null);
  const told = useRef({ onFrame, onError });
  useLayoutEffect(() => {
    told.current = { onFrame, onError };
  });
  // Waiting for Next when it goes (its step taken back past, or its slide gone): its file let go of then, as a
  // playback's stop lets go of a playing one's.
  const waiting = useRef(false);
  useLayoutEffect(() => {
    const v = own.current;
    return () => {
      if (!waiting.current || !v?.hasAttribute('src')) return;
      v.removeAttribute('src');
      v.load();
    };
  }, []);
  // A layout effect: a clip already loaded has its first frame before the press's frame is drawn.
  useLayoutEffect(() => {
    const v = own.current;
    if (!v) return;
    if (startedAt === null) {
      // Out of sight while it waits, whatever it showed as a clip before (a step taken back while its clip played).
      waiting.current = true;
      v.style.opacity = '0';
      v.style.transform = '';
      v.style.mixBlendMode = '';
      const url = mediaUrl(mediaId, attempt);
      if (v.getAttribute('src') !== url) v.src = url;
      return;
    }
    waiting.current = false;
    const catchUp: PlaybackCatchUp | undefined =
      lateMs > 0 ? { at: startedAt, lateMs, maxRate: CATCH_UP_RATE } : undefined;
    // A hold starts as its clip ends, later than now: playback.ts waits for it at its start until then.
    return startPlayback(v, {
      mediaId,
      attempt,
      startedAt,
      // A clip may be the next click's, loaded already (above): it plays from where it is. A hold loads as before.
      reuseLoadedSource: role === 'clip',
      // A hold after a first clip that ended late makes up the rest going round (C3's review M1).
      catchesUp: catchUp !== undefined,
      timing: () => ({ loop, catchUp }),
      onFrame: () => {
        told.current.onFrame?.();
      },
      onError: () => {
        told.current.onError?.();
      },
    });
  }, [mediaId, attempt, startedAt, lateMs, loop, role]);
  return (
    <video
      ref={own}
      data-deck-video={role}
      data-media-id={mediaId}
      muted
      playsInline
      disablePictureInPicture
      preload="auto"
      style={{ ...filling(fit), opacity: 0 }}
    />
  );
}

/**
 * A slide's first clip (its coming in), played from the engine's time as any clip is (StepVideo), in an element made
 * here: the one this page's Preloader loaded and decoded ahead for the slide Next shows (DeckClipAhead), taken as it
 * is, else a new one. In a box of its own (React keeps the box; the element is this one's), its fit the box's.
 *
 * Come to by a jump and cold, it plays from its first usable frame once that frame is in (C3, part 1): as far behind
 * the engine's time as the frame was late (each screen's own decoding), so it then catches up, a tenth faster at most,
 * until it is where the engine's time has it (C3's review M1), never jumping there.
 */
function FirstClip({
  mediaId,
  startedAt,
  shownAt,
  clipEndsAt,
  deadline,
  fit,
  onFrame,
  onError,
}: {
  mediaId: string;
  startedAt: number;
  shownAt: number;
  /** When the engine's time has the clip over. */
  clipEndsAt: number;
  deadline: number | null;
  fit: CSSProperties['objectFit'];
  /** Its first frame is in: how much later than the engine's time it will end (ms; none once it has caught up). */
  onFrame: (lateEndMs: number) => void;
  onError: () => void;
}) {
  const attempt = useMediaAttempt(mediaId);
  const slot = useRef<HTMLDivElement | null>(null);
  const told = useRef({ onFrame, onError });
  useLayoutEffect(() => {
    told.current = { onFrame, onError };
  });
  useLayoutEffect(() => {
    const host = slot.current;
    if (!host) return;
    const fromMs = Math.max(0, shownAt - startedAt);
    const v = takeClipAhead(mediaUrl(mediaId, attempt), fromMs) ?? document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.disablePictureInPicture = true;
    v.preload = 'auto';
    v.setAttribute('data-deck-video', 'clip');
    v.setAttribute('data-deck-first-frame', 'loading');
    v.setAttribute('data-media-id', mediaId);
    Object.assign(v.style, filling('inherit'), { opacity: '0', transform: '', mixBlendMode: '' });
    host.append(v);
    const warmed =
      v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      !v.seeking &&
      Math.abs(v.currentTime * 1000 - fromMs) < 1;
    // On a direct jump, keep the seek past PowerPoint's incoming transition. While the clip is cold, decode exactly
    // that frame and start there once it can be drawn, even if the file arrived after the press. Loaded ahead at that
    // frame (Next's, or the slide the operator pointed at: C3, Session 58), it plays from there at once.
    let { seek, catchUp } = firstClipStart({ deadline, warmed, shownAt, mountedAt: engineNow(), fromMs });
    let playFrame = 0;
    const tell = (ready: boolean) => {
      v.dataset['deckFirstFrame'] = ready ? 'ready' : 'failed';
      v.dispatchEvent(new Event(DECK_FIRST_FRAME));
    };
    const stop = startPlayback(v, {
      mediaId,
      attempt,
      startedAt,
      reuseLoadedSource: true,
      // Cold, or loaded ahead and mounted late, it catches up from its frame (C3's review M1).
      catchesUp: true,
      timing: () => ({ loop: false, seek, catchUp }),
      onFrame: () => {
        const readyAt = engineNow();
        if (seek?.paused) {
          if (deadline !== null && readyAt > deadline) {
            told.current.onError();
            tell(false);
            return;
          }
          // From that frame, as late as it came; then it catches up (C3's review M1), so it ends only as late as it
          // has not made up by its end (the step's last frame and hold wait for that, the hold making up the rest).
          ({ seek, catchUp } = playingFrom(shownAt, fromMs, readyAt));
          told.current.onFrame(
            catchUpLeftMs(Math.max(0, readyAt - shownAt), clipEndsAt - shownAt, CATCH_UP_RATE),
          );
          // Paint the decoded frame before the video advances; its clock from the moment it plays (C3T-2: from the
          // frame's coming in, a frame or more before on a slow computer, the first check found it that far behind and
          // could jump it 2-3 frames about 0.3 s in).
          playFrame = requestAnimationFrame(() => {
            ({ seek, catchUp } = playingFrom(shownAt, fromMs, engineNow()));
            void v.play().catch(() => undefined);
          });
        } else
          told.current.onFrame(
            catchUp ? catchUpLeftMs(catchUp.lateMs, clipEndsAt - shownAt, CATCH_UP_RATE) : 0,
          );
        tell(true);
      },
      onError: () => {
        told.current.onError();
        tell(false);
      },
    });
    return () => {
      cancelAnimationFrame(playFrame);
      stop();
      v.remove();
    };
  }, [mediaId, attempt, startedAt, shownAt, clipEndsAt, deadline]);
  return <div ref={slot} data-deck-slot="" style={filling(fit)} />;
}

/** What a step draws at a moment, by the engine's time. */
export type StepPhase = 'clip' | 'held' | 'hold';

/**
 * Which of a step's pictures shows at `now`: its clip while it plays (and has its first frame; until then the step
 * before's last frame), its last frame once it is over (or shown still), or its hold going round once that has a frame.
 */
export function stepPhase(
  timing: StepTiming,
  now: number,
  ready: { hold: boolean; clipFailed: boolean; firstFrameDeadline?: number },
): StepPhase {
  const until = ready.firstFrameDeadline ?? timing.endsAt;
  if (!timing.still && now < until && timing.drashti?.mode !== 'instead' && !ready.clipFailed) return 'clip';
  // The hold goes round from the clip's end (with Drashti's transition instead, the last frame shows until then).
  return timing.step.holdId && ready.hold && now >= timing.endsAt ? 'hold' : 'held';
}

function DeckStepLive({
  deck,
  timing,
  style,
  fit,
  cuts,
  underId,
}: {
  deck: DeckSlide;
  timing: StepTiming;
  style: CSSProperties;
  fit: CSSProperties['objectFit'];
  /** Drashti's own transition into a step drawn as a cut (a stage screen always cuts). */
  cuts: boolean;
  /** Under the first step's clip until it can be drawn: the still that showed before (a stage screen's, C review). */
  underId: string | null;
}) {
  const movement = useContext(SlideMovementContext);
  const { index, step, clipAt, still, drashti, shownAt } = timing;
  const before = index > 0 ? deckStep(deck, index - 1)?.lastId : (underId ?? undefined);
  // The next click's clip (Session 57, item 6), waiting loaded while this step is up: none after the last click, for a
  // click with no motion (shown still), or one Drashti's own transition comes instead of (its clip never played).
  const following = deck.steps[index + 1];
  const followingOwn = deck.stepTransitions?.[index + 1];
  const waitingClip =
    (following?.clipMs ?? 0) > 0 &&
    !(followingOwn?.mode === 'instead' && takingTime(followingOwn.transition) !== undefined)
      ? (following?.clipId ?? null)
      : null;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const underRef = useRef<HTMLImageElement | null>(null);
  const lastRef = useRef<HTMLImageElement | null>(null);
  const blackRef = useRef<HTMLDivElement | null>(null);
  // Once the clip has its first frame, how much later than the engine's time it ends (a cold jump's first clip that
  // came in late, less what it makes up a tenth faster; else 0); null while the clip is loading.
  const clipKey = `${step.clipId}@${String(clipAt)}`;
  const clipAttempt = useMediaAttempt(step.clipId);
  const newClip = () => ({
    key: clipKey,
    attempt: clipAttempt,
    deadline:
      index === 0 && !still && engineNow() < shownAt + FRESH_DECK_ENTRY_MS
        ? shownAt + FIRST_FRAME_WAIT_MS
        : null,
    delayMs: null as number | null,
    failed: false,
  });
  const [frame, setFrame] = useState(newClip);
  const [holdReady, setHoldReady] = useState(false);
  if (frame.key !== clipKey) {
    setFrame(newClip());
  } else if (frame.attempt !== clipAttempt) {
    // The same clip at the same engine time gets a new source when the node's copy lands.
    setFrame({ ...frame, attempt: clipAttempt, delayMs: null, failed: false });
  }
  const clipReady = frame.delayMs !== null;
  const clipFailed = frame.failed;
  const endsAt = timing.endsAt + (frame.delayMs ?? 0);
  const updateFrame = (change: { delayMs?: number; failed: boolean }) =>
    setFrame((f) => (f.key === clipKey && f.attempt === clipAttempt ? { ...f, ...change } : f));
  const holdKey = `${step.holdId ?? ''}@${String(endsAt)}`;
  const [seenHold, setSeenHold] = useState(holdKey);
  if (seenHold !== holdKey) {
    setSeenHold(holdKey);
    setHoldReady(false);
  }
  const transition = cuts ? null : (drashti?.transition ?? null);
  const transitionEnds = transition ? shownAt + transition.durationMs : -Infinity;

  /** Every picture of the step as the engine's time has it at `now`. */
  const paint = (now: number) => {
    const root = rootRef.current;
    // Its clip and hold by their roles (the next click's clip, waiting, is neither, and stays out of sight).
    const video = (role: StepVideoRole) =>
      root?.querySelector<HTMLVideoElement>(`video[data-deck-video="${role}"]`) ?? null;
    const e = {
      root,
      under: underRef.current,
      clip: video('clip'),
      last: lastRef.current,
      hold: video('hold'),
      black: blackRef.current,
    };
    const phase = stepPhase({ ...timing, endsAt }, now, {
      hold: holdReady,
      clipFailed,
      ...(!clipReady && frame.deadline !== null ? { firstFrameDeadline: frame.deadline } : {}),
    });
    // The clip shows once it has its first frame; until then the step before's last frame (under) covers its place.
    const clipShows = phase === 'clip' && clipReady;
    const top = phase === 'clip' ? (clipShows ? e.clip : null) : phase === 'hold' ? e.hold : e.last;
    const set = (el: HTMLElement | null, opacity: number, transform = '') => {
      if (!el) return;
      el.style.opacity = String(opacity);
      el.style.transform = transform;
    };
    set(e.clip, top === e.clip ? 1 : 0);
    set(e.last, top === e.last ? 1 : 0);
    set(e.hold, top === e.hold ? 1 : 0);
    set(e.under, top ? 0 : 1);
    if (e.black) e.black.style.opacity = '0';
    // Drashti's own transition into the step (from 1): from the step before's last frame to the step's picture.
    if (transition && now < transitionEnds && top && e.under) {
      const p = Math.min(1, Math.max(0, (now - shownAt) / Math.max(1, transition.durationMs)));
      const f = transitionFrame(transition.kind, p, movement);
      set(top, f.in.opacity, f.in.transform);
      set(e.under, f.out.opacity, f.out.transform);
      top.style.mixBlendMode = f.add ? 'plus-lighter' : '';
      if (e.black) e.black.style.opacity = String(f.black);
    } else if (top) top.style.mixBlendMode = '';
    e.root?.setAttribute('data-deck-phase', phase === 'clip' && !clipShows ? 'loading' : phase);
  };
  const painter = useRef<((now: number) => void) | null>(null);
  useLayoutEffect(() => {
    painter.current = paint;
    paint(engineNow());
  });
  // Frame by frame while the clip plays or Drashti's transition runs, then once more at its end; again at a clock jump.
  const movingUntil = Math.max(
    still ? -Infinity : endsAt,
    transitionEnds,
    clipReady || clipFailed ? -Infinity : (frame.deadline ?? -Infinity),
  );
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = engineNow();
      painter.current?.(now);
      if (now < movingUntil) frame = requestAnimationFrame(tick);
    };
    tick();
    const off = onClockJump(() => {
      cancelAnimationFrame(frame);
      tick();
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [movingUntil, clipKey]);
  return (
    <div
      ref={rootRef}
      data-deck-step={index}
      data-deck-still={still ? 'true' : undefined}
      style={{ ...style, overflow: 'hidden', isolation: 'isolate' }}
    >
      {/* Keyed by file, so a step's last frame stays the very picture under the next step (nothing loads again). */}
      {before !== undefined && before !== step.lastId && (
        <Still key={before} mediaId={before} fit={fit} holder={underRef} role="under" />
      )}
      <Still key={step.lastId} mediaId={step.lastId} fit={fit} holder={lastRef} role="last" />
      {/* Drashti's own transition instead of the step's motion: its clip is never played. A slide's first clip may be
          the Preloader's, decoded ahead; a click's is the one that waited for it (its key, as it waited, below). */}
      {!still &&
        drashti?.mode !== 'instead' &&
        (index === 0 ? (
          <FirstClip
            key={`clip:0:${step.clipId}`}
            mediaId={step.clipId}
            startedAt={clipAt}
            shownAt={shownAt}
            clipEndsAt={timing.endsAt}
            deadline={frame.deadline}
            fit={fit}
            onFrame={(delayMs) => updateFrame({ delayMs, failed: false })}
            onError={() => updateFrame({ failed: true })}
          />
        ) : (
          <StepVideo
            key={`clip:${String(index)}:${step.clipId}`}
            mediaId={step.clipId}
            startedAt={clipAt}
            loop={false}
            fit={fit}
            onFrame={() => updateFrame({ delayMs: 0, failed: false })}
            onError={() => updateFrame({ failed: true })}
            role="clip"
          />
        ))}
      {/* The next click's clip, loaded and paused, out of sight, until Next makes it this step's clip. */}
      {waitingClip !== null && (
        <StepVideo
          key={`clip:${String(index + 1)}:${waitingClip}`}
          mediaId={waitingClip}
          startedAt={null}
          loop={false}
          fit={fit}
          role="preparing"
        />
      )}
      {step.holdId && (frame.deadline === null || clipReady || clipFailed) && (
        <StepVideo
          key={`hold:${holdKey}`}
          mediaId={step.holdId}
          startedAt={endsAt}
          lateMs={frame.delayMs ?? 0}
          loop
          fit={fit}
          onFrame={() => {
            setHoldReady(true);
          }}
          onError={() => undefined}
          role="hold"
        />
      )}
      {transition?.kind === 'fade-black' && (
        <div ref={blackRef} style={{ position: 'absolute', inset: 0, background: '#000', opacity: 0 }} />
      )}
    </div>
  );
}

/**
 * On a phone or tablet (previews only, no video): the step before's last frame while the step's motion plays, then the
 * step's own, as small previews; which, by the engine's time. The coming-in step shows its clip's preview meanwhile.
 */
function DeckStepPreview({
  deck,
  timing,
  style,
}: {
  deck: DeckSlide;
  timing: StepTiming;
  style: CSSProperties;
}) {
  const [, redraw] = useState(0);
  const done = timing.still || engineNow() >= timing.endsAt;
  useEffect(() => {
    const off = onClockJump(() => {
      redraw((n) => n + 1);
    });
    if (done) return off;
    // Drawn again when the engine's time reaches the step's end (what it shows is worked out from engineNow() above),
    // waiting again if woken a moment early (wake-at.ts): woken early once, a phone kept the clip's still for good.
    const stop = wakeAt(timing.endsAt, engineNow, () => {
      redraw((n) => n + 1);
    });
    return () => {
      off();
      stop();
    };
  }, [done, timing.endsAt]);
  const meanwhile = timing.index > 0 ? deckStep(deck, timing.index - 1)?.lastId : timing.step.clipId;
  const id = done ? timing.step.lastId : (meanwhile ?? timing.step.lastId);
  return (
    <div data-deck-step={timing.index} data-deck-phase={done ? 'held' : 'clip'} style={style}>
      <PreviewPicture key={id} mediaId={id} style={filling('contain')} />
    </div>
  );
}

/** A deck's picture as the step showing draws it, in the box `style` places (SlideView: the picture's own). */
export function DeckStepView({
  deck,
  timing,
  style,
  fit = 'contain',
  cuts = false,
  underId = null,
}: {
  deck: DeckSlide;
  timing: StepTiming;
  style: CSSProperties;
  fit?: CSSProperties['objectFit'];
  /** Drashti's own transition into a step drawn as a cut (a stage screen always cuts). */
  cuts?: boolean;
  /** Under the first step's clip until it can be drawn: the still that showed before (a stage screen's, C review). */
  underId?: string | null;
}) {
  return usePreviewsOnly() ? (
    <DeckStepPreview deck={deck} timing={timing} style={style} />
  ) : (
    <DeckStepLive deck={deck} timing={timing} style={style} fit={fit} cuts={cuts} underId={underId} />
  );
}

/** A deck's picture in a stage screen's box: as large as the box lets it be, never cut. */
const STAGE_DECK: CSSProperties = { position: 'relative', flex: 1, minHeight: 0, width: '100%' };
const INSET: CSSProperties = { position: 'absolute', inset: 0 };

/**
 * A deck's slide up, on a stage screen (Session 54, C2): its step as the hall's screens draw it, from the engine's
 * time, but cutting where they run Drashti's own transition (a stage screen always cuts).
 */
export function StageDeckNow({ layer, testId }: { layer: SlideLayer; testId?: string }) {
  const { slide, step, stepAt, stepFromMs, shownAt } = layer;
  const { timing, native } = useMemo(() => {
    const layer = { slide, step, stepAt, stepFromMs, shownAt };
    return { timing: stepTiming(layer), native: nativeStepTiming(layer) };
  }, [slide, step, stepAt, stepFromMs, shownAt]);
  // The still that showed before this slide came (C review): under its first step's clip until that can be drawn,
  // as the hall's screens and LIVE keep the slide before up, so the stage never shows nothing for a moment.
  const now = stageStill(
    null,
    `${slide.id}@${String(shownAt)}`,
    timing
      ? (deckStep(slide.deck, timing.index)?.lastId ?? null)
      : native?.index === lastStep(slide.deck)
        ? (slide.deck?.sourceStillId ?? null)
        : null,
  );
  const [kept, setKept] = useState<StageStill>(now);
  const next = stageStill(kept, now.key, now.still);
  if (next !== kept) setKept(next);
  if (native)
    return (
      <div data-testid={testId} data-stage-deck="now" style={STAGE_DECK}>
        <PlacedInParent content={slide} mode="fit" className="absolute inset-0">
          <NativeDeckMotion slide={slide} timing={native}>
            <SlideView slide={slide} startedAt={shownAt} clips={layer.clips} seeks={layer.seeks} />
          </NativeDeckMotion>
        </PlacedInParent>
      </div>
    );
  if (!slide.deck || !timing) return null;
  return (
    <div data-testid={testId} data-stage-deck="now" style={STAGE_DECK}>
      <DeckStepView
        deck={slide.deck}
        timing={timing}
        style={INSET}
        cuts
        underId={timing.index === 0 ? next.before : null}
      />
    </div>
  );
}

/** What Next shows of a deck's slide, on a stage screen (Session 54, C2): the step's last frame, still. */
export function StageDeckNext({
  slide,
  step,
  testId,
}: {
  slide: RenderSlide;
  step: number;
  testId?: string;
}) {
  if (!slide.deck) return null;
  return (
    <div data-testid={testId} data-stage-deck="next" style={STAGE_DECK}>
      {nativeDeckMotion(slide.deck) ? (
        <PlacedInParent content={slide} mode="fit" className="absolute inset-0">
          <SlideView slide={deckSlideAt(slide, step)} media="still" />
        </PlacedInParent>
      ) : (
        <DeckStepStill deck={slide.deck} index={step} style={INSET} />
      )}
    </div>
  );
}

/** A step's last frame, still (the stage's next): a picture, or on a phone its small preview. */
export function DeckStepStill({
  deck,
  index,
  style,
}: {
  deck: DeckSlide;
  index: number;
  style: CSSProperties;
}) {
  const previews = usePreviewsOnly();
  const attempt = useMediaAttempt(deckStep(deck, index)?.lastId ?? '');
  const urlOf = useMediaUrl();
  const id = deckStep(deck, index)?.lastId;
  if (!id) return null;
  return (
    <div data-deck-next={index} style={style}>
      {previews ? (
        <PreviewPicture mediaId={id} style={filling('contain')} />
      ) : (
        <img
          key={attempt}
          data-media-id={id}
          src={urlOf(id, attempt)}
          alt=""
          draggable={false}
          style={filling('contain')}
        />
      )}
    </div>
  );
}

/** How a deck's video shows besides playing (Session 54, C2): its poster over it, hidden, or neither. */
export type DeckCover = 'poster' | 'hidden' | 'none';

/**
 * How one of a deck's videos shows now, by the engine's time: before it plays (waiting for its click, or for its
 * offset after it), its poster, or nothing at all when its deck hides it while it is not playing; played once to its
 * end, hidden too when its deck says so. Drawn again at the moment that changes (a timer that only asks for a new
 * drawing). Any other video: 'none'.
 */
export function useDeckCover(
  deck: DeckMedia | undefined,
  clock: { startedAt: number; loop: boolean; clip?: PlaybackClip; seek?: PlaybackSeek },
  durationMs: number | null,
  /** The step its slide shows (C review): it is hidden outside its entrance and its exit, never its poster. */
  timing: DeckVideoTiming | null = null,
): DeckCover {
  const [, redraw] = useState(0);
  const now = engineNow();
  // Between its entrance and its exit only (C review): from when, by the engine's time; null: not at this step.
  const shownFrom = deck && timing ? videoShowsFrom(deck, timing) : -Infinity;
  const offStage = shownFrom === null || shownFrom > now;
  const seek = clock.seek;
  const before = seek?.waiting === true || (seek !== undefined && !seek.paused && seek.at > now);
  const ended =
    deck?.hideWhenStopped === true &&
    !before &&
    !clock.loop &&
    durationMs !== null &&
    durationMs > 0 &&
    playbackAtMs(clock, durationMs, now) >= playbackSpanMs(clock.clip, durationMs).end;
  // When it next changes: its entrance step's motion over, its start, or (hidden once it ends) its end.
  const changesAt =
    shownFrom !== null && shownFrom > now
      ? shownFrom
      : seek && !seek.paused && seek.at > now
        ? seek.at
        : deck?.hideWhenStopped === true && !before && !ended && !clock.loop && durationMs && !seek?.paused
          ? now + playbackLeftMs(clock, durationMs, now)
          : null;
  const own = deck !== undefined;
  useEffect(() => {
    // Any other video: nothing here changes how it shows.
    if (!own) return;
    const off = onClockJump(() => {
      redraw((n) => n + 1);
    });
    if (changesAt === null) return off;
    // Drawn again when the engine's time reaches the video's start or end (what shows is worked out from engineNow()
    // above), waiting again if woken a moment early (wake-at.ts).
    const stop = wakeAt(changesAt, engineNow, () => {
      redraw((n) => n + 1);
    });
    return () => {
      off();
      stop();
    };
  }, [own, changesAt]);
  if (!deck) return 'none';
  if (offStage) return 'hidden';
  if (before) return deck.hideWhenStopped ? 'hidden' : deck.posterId ? 'poster' : 'none';
  return ended ? 'hidden' : 'none';
}
