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
import type { DeckMedia, DeckSlide } from '../../../shared/deck';
import { deckStep, type StepTiming, stepTiming } from '../../../shared/deck-show';
import type { SlideLayer } from '../../../shared/engine/state';
import type { RenderSlide } from '../../../shared/model';
import {
  type PlaybackClip,
  type PlaybackSeek,
  playbackAtMs,
  playbackLeftMs,
  playbackSpanMs,
} from '../../../shared/media';
import { engineNow, onClockJump } from './clock';
import { useMediaAttempt } from './media-attempts';
import { useMediaUrl } from './media-urls';
import { startPlayback } from './playback';
import { PreviewPicture, usePreviewsOnly } from './previews';
import { SlideMovementContext } from './slide-timers';
import { transitionFrame } from './transition-frame';

/*
 * A deck's slide as the step showing draws it (Session 54, C2; shared/deck-show.ts), in the place of the slide's
 * picture: the step's clip played from the engine's time (its `stepAt`, less how far into it the step was shown from),
 * then its last frame held, or its hold going round; never a frame decided by this computer's own clock, so the hall's
 * screens, a node, the stream, key and fill, LIVE and the stage show the same step at the same moment (§40). Under it,
 * the step before's last frame, which the clip begins on, covers the moment the clip takes to load. A step with
 * Drashti's own transition goes from that last frame to its clip (over the step's own motion) or to its own last frame
 * (instead of it), frame by frame from the engine's time, as a slide's transition does. A phone draws no video: the
 * step before's last frame while the step moves, then its own, each a small preview.
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

/** A clip or a hold of the deck's, played from the engine's time: from `startedAt`, once or going round. */
function StepVideo({
  mediaId,
  startedAt,
  loop,
  fit,
  holder,
  onFrame,
  onError,
  role,
}: {
  mediaId: string;
  startedAt: number;
  loop: boolean;
  fit: CSSProperties['objectFit'];
  /** Where the step keeps it, to show it or not frame by frame. */
  holder: RefObject<HTMLVideoElement | null>;
  onFrame: () => void;
  onError: () => void;
  role: 'clip' | 'hold';
}) {
  const attempt = useMediaAttempt(mediaId);
  const told = useRef({ onFrame, onError });
  useLayoutEffect(() => {
    told.current = { onFrame, onError };
  });
  useEffect(() => {
    const v = holder.current;
    if (!v) return;
    // A hold starts as its clip ends, later than now: playback.ts waits for it at its start until then.
    const stop = startPlayback(v, {
      mediaId,
      attempt,
      startedAt,
      timing: () => ({ loop }),
      onFrame: () => {
        told.current.onFrame();
      },
      onError: () => {
        told.current.onError();
      },
    });
    return stop;
  }, [holder, mediaId, attempt, startedAt, loop]);
  return (
    <video
      ref={holder}
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

/** What a step draws at a moment, by the engine's time. */
export type StepPhase = 'clip' | 'held' | 'hold';

/**
 * Which of a step's pictures shows at `now`: its clip while it plays (and has its first frame; until then the step
 * before's last frame), its last frame once it is over (or shown still), or its hold going round once that has a frame.
 */
export function stepPhase(
  timing: StepTiming,
  now: number,
  ready: { hold: boolean; clipFailed: boolean },
): StepPhase {
  if (!timing.still && now < timing.endsAt && timing.drashti?.mode !== 'instead' && !ready.clipFailed)
    return 'clip';
  // The hold goes round from the clip's end (with Drashti's transition instead, the last frame shows until then).
  return timing.step.holdId && ready.hold && now >= timing.endsAt ? 'hold' : 'held';
}

function DeckStepLive({
  deck,
  timing,
  style,
  fit,
  cuts,
}: {
  deck: DeckSlide;
  timing: StepTiming;
  style: CSSProperties;
  fit: CSSProperties['objectFit'];
  /** Drashti's own transition into a step drawn as a cut (a stage screen always cuts). */
  cuts: boolean;
}) {
  const movement = useContext(SlideMovementContext);
  const { index, step, clipAt, endsAt, still, drashti, shownAt } = timing;
  const before = index > 0 ? deckStep(deck, index - 1)?.lastId : undefined;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const underRef = useRef<HTMLImageElement | null>(null);
  const clipRef = useRef<HTMLVideoElement | null>(null);
  const lastRef = useRef<HTMLImageElement | null>(null);
  const holdRef = useRef<HTMLVideoElement | null>(null);
  const blackRef = useRef<HTMLDivElement | null>(null);
  // Whether the clip has its first frame (until then the step before's still shows), failed (its last frame shows at
  // once), and whether the hold has its first frame (until then the last frame shows): each this screen's own loading,
  // as a slide's transition waits for its pictures; what shows once they are in is the engine's time's alone.
  const [clipReady, setClipReady] = useState(false);
  const [clipFailed, setClipFailed] = useState(false);
  const [holdReady, setHoldReady] = useState(false);
  const clipKey = `${step.clipId}@${String(clipAt)}`;
  const [seenClip, setSeenClip] = useState(clipKey);
  if (seenClip !== clipKey) {
    setSeenClip(clipKey);
    setClipReady(false);
    setClipFailed(false);
  }
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
    const e = {
      root: rootRef.current,
      under: underRef.current,
      clip: clipRef.current,
      last: lastRef.current,
      hold: holdRef.current,
      black: blackRef.current,
    };
    const phase = stepPhase(timing, now, { hold: holdReady, clipFailed });
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
  const movingUntil = Math.max(still ? -Infinity : endsAt, transitionEnds);
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
      {/* Drashti's own transition instead of the step's motion: its clip is never played. */}
      {!still && drashti?.mode !== 'instead' && (
        <StepVideo
          key={`clip:${clipKey}`}
          mediaId={step.clipId}
          startedAt={clipAt}
          loop={false}
          fit={fit}
          holder={clipRef}
          onFrame={() => {
            setClipReady(true);
          }}
          onError={() => {
            setClipFailed(true);
          }}
          role="clip"
        />
      )}
      {step.holdId && (
        <StepVideo
          key={`hold:${holdKey}`}
          mediaId={step.holdId}
          startedAt={endsAt}
          loop
          fit={fit}
          holder={holdRef}
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
    // eslint-disable-next-line no-restricted-syntax -- never decides a frame: asks for a new drawing when the engine's time reaches the step's end (what it shows is worked out from engineNow() above)
    const t = setTimeout(
      () => {
        redraw((n) => n + 1);
      },
      Math.max(0, timing.endsAt - engineNow()),
    );
    return () => {
      off();
      clearTimeout(t);
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
}: {
  deck: DeckSlide;
  timing: StepTiming;
  style: CSSProperties;
  fit?: CSSProperties['objectFit'];
  /** Drashti's own transition into a step drawn as a cut (a stage screen always cuts). */
  cuts?: boolean;
}) {
  return usePreviewsOnly() ? (
    <DeckStepPreview deck={deck} timing={timing} style={style} />
  ) : (
    <DeckStepLive deck={deck} timing={timing} style={style} fit={fit} cuts={cuts} />
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
  const timing = useMemo(
    () => stepTiming({ slide, step, stepAt, stepFromMs, shownAt }),
    [slide, step, stepAt, stepFromMs, shownAt],
  );
  if (!slide.deck || !timing) return null;
  return (
    <div data-testid={testId} data-stage-deck="now" style={STAGE_DECK}>
      <DeckStepView deck={slide.deck} timing={timing} style={INSET} cuts />
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
      <DeckStepStill deck={slide.deck} index={step} style={INSET} />
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
): DeckCover {
  const [, redraw] = useState(0);
  const now = engineNow();
  const seek = clock.seek;
  const before = seek?.waiting === true || (seek !== undefined && !seek.paused && seek.at > now);
  const ended =
    deck?.hideWhenStopped === true &&
    !before &&
    !clock.loop &&
    durationMs !== null &&
    durationMs > 0 &&
    playbackAtMs(clock, durationMs, now) >= playbackSpanMs(clock.clip, durationMs).end;
  // When it next changes: its start, or (hidden once it ends) its end.
  const changesAt =
    seek && !seek.paused && seek.at > now
      ? seek.at
      : deck?.hideWhenStopped === true && !before && !ended && !clock.loop && durationMs && !seek?.paused
        ? now + playbackLeftMs(clock, durationMs, now)
        : null;
  useEffect(() => {
    const off = onClockJump(() => {
      redraw((n) => n + 1);
    });
    if (changesAt === null) return off;
    // eslint-disable-next-line no-restricted-syntax -- never decides a frame: asks for a new drawing when the engine's time reaches the video's start or end (what shows is worked out from engineNow() above)
    const t = setTimeout(
      () => {
        redraw((n) => n + 1);
      },
      Math.max(0, changesAt - engineNow()) + 1,
    );
    return () => {
      off();
      clearTimeout(t);
    };
  }, [changesAt]);
  if (!deck) return 'none';
  if (before) return deck.hideWhenStopped ? 'hidden' : deck.posterId ? 'poster' : 'none';
  return ended ? 'hidden' : 'none';
}
