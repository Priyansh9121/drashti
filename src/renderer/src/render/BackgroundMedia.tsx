import { cueClock } from './cue-clock';
import { afterCueStart, cueStarted, startedNow } from './cue-started';
import { atGoMoment } from './go-moment';
import { cuePresentation, PRIVATE_VIDEO_OPACITY } from './cue-presentation';
import { videoFadeProgress, type VideoCue, type VideoCrossfade } from '../../../shared/video-cue';
import { reportVideoCue, reportLoadedVideoCue } from './video-cue-report';
import {
  type Dispatch,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { BackgroundLayer, MediaFit } from '../../../shared/engine/state';
import {
  drawnKeyOf,
  drawnOver,
  type InputSlot,
  isDrawn,
  isInputSlot,
  isMediaSlot,
  type MediaSlot,
  NO_SLOTS,
  retryAfterLanding,
  type Slot,
  type SlotEvent,
  type Slots,
  slotKey,
  slotsReducer,
} from './background-slots';
import { OBJECT_FIT } from './media-style';
import { OwnLayers } from './canvas-clip';
import { type Playback, startPlayback } from './playback';
import { engineNow } from './clock';
import { dissolveCurve } from './transition-frame';
import type { Movement } from '../../../shared/looks';
import { Looked } from './picture-looks';
import { backgroundShowing } from '../../../shared/picture-look';
import { PreviewPicture, usePreviewsOnly } from './previews';
import { useGpuRestarts, useMediaAttempt } from './media-attempts';
import { useMediaUrl } from './media-urls';
import { KeptVideo } from './KeptVideo';
import { useInputReport, useVideoInput } from './video-input';
import { hasNoPicture, tellCannotPlay, tellNoPicture, tellPlaysHere, watchStart } from './no-picture';
import { NO_FIRST_FRAME, NO_START_IN_TIME } from '../../../shared/no-picture';
import { SHAPED_PLACE, shapedVideoStyle, shapeFor, useVideoShapes } from './video-shape';

function style(fit: MediaFit, visible: boolean) {
  return {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: OBJECT_FIT[fit],
    opacity: visible ? 1 : 0,
  } as const;
}

/**
 * A background video: it says it is ready once its first frame (at the right point) is decoded. One whose picture this
 * computer cannot draw (Session 60, x36: Chromium plays it as sound only, at 0 × 0) is never ready, so the picture
 * before it stays, and is said to the main process, which takes it off with its sound (render/no-picture.ts). One whose
 * element fails (Q60-31: this computer's decoder raising an error, a cut or damaged file, its copy unreadable) is said
 * to the main process the same way, with the error's kind, the picture before (or its own last frame) staying drawn
 * until the show takes it off. One with a Shape of its own (Sound and picture…, alpha.20) is drawn in a box of that
 * shape, stretched to it (`shape`: its width over its height; its place, the slot's wrap, is then the box's container:
 * BackgroundPlayer).
 */
/** How long a video drawn over the picture before waits for its first presented frame before it is taken as ready. */
const PRESENT_WAIT_MS = 300;

function VideoSlot({
  slot,
  visible,
  shape,
  dispatch,
  tellStart = false,
}: {
  slot: MediaSlot;
  visible: boolean;
  shape: number | null;
  dispatch: Dispatch<SlotEvent>;
  /** The operator's LIVE preview (QA23-CUELIVE-1): says when its cued picture has started at Go (cue-started.ts). */
  tellStart?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { key, layer, attempt } = slot;
  const { mediaId, startedAt } = layer;
  // Its file's landings and the GPU processes started, as it fails: only later ones try it again (Q60-31).
  const landedNow = useMediaAttempt(mediaId) + useGpuRestarts();
  const landed = useRef(landedNow);
  useLayoutEffect(() => {
    landed.current = landedNow;
  });
  // Start and end points and a jump to a marker (Session 14) are read as they change, without a reload.
  const timing = useRef(layer);
  useLayoutEffect(() => {
    timing.current = layer;
  });
  const privateCue = useRef(slot.cued === true);
  useLayoutEffect(() => {
    privateCue.current = slot.cued === true;
  });
  const playback = useRef<Playback | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // Keep a private cue in the compositor below pixel precision, and require its trimmed native frame.
    // The armed Go lead then warms the same decoder silently before the shared moment (playback.ts).
    let settled = false;
    const ready = () => {
      settled = true;
      reportVideoCue(layer.cueId, 'picture', true);
      // Its first frame, as this page shows it: said, should this page have said it was starting (QA23-HALLDROP-1 (a)).
      if (!layer.cueId) tellPlaysHere(mediaId, startedAt);
      if (privateCue.current) dispatch({ type: 'ready', key, at: engineNow() });
      else dispatch({ type: 'loaded', key });
    };
    const presentation = layer.cueId
      ? cuePresentation(v, ready, () => {
          settled = true;
          reportVideoCue(layer.cueId, 'picture', false);
          if (!privateCue.current)
            tellCannotPlay(mediaId, startedAt, attempt ?? 0, {
              code: 0,
              message:
                'The cued video’s first frame could not be read. Cancel the cue and check the video in Media.',
            });
          dispatch({ type: 'failed', key, landed: landed.current });
        })
      : null;
    const p = startPlayback(v, {
      mediaId,
      attempt,
      startedAt,
      prepareScheduledStart: layer.cueId !== undefined,
      timing: () => ({ loop: timing.current.loop, clip: timing.current.clip, seek: timing.current.seek }),
      onFrame: () => {
        if (hasNoPicture(v)) {
          settled = true;
          reportVideoCue(layer.cueId, 'picture', false);
          if (!privateCue.current) tellNoPicture(mediaId, startedAt);
          return;
        }
        if (presentation) presentation.decoded();
        else ready();
      },
      onError: (error) => {
        presentation?.stop();
        settled = true;
        reportVideoCue(layer.cueId, 'picture', false);
        if (!privateCue.current) tellCannotPlay(mediaId, startedAt, attempt ?? 0, error);
        dispatch({ type: 'failed', key, landed: landed.current });
      },
    });
    // No first frame (Q60-44, refined by Q60-51, the owner's "Yes, A"): said to Main, which takes it off from a screen's
    // word (shared/no-picture.ts): after FIRST_FRAME_MS with no progress at all, or, while it still loads or decodes,
    // after SLOW_START_MS as not started in time (never "damaged"). Only said: it still loads here, what was drawn
    // before staying meanwhile (background-slots.ts, Scene.tsx), so a page whose word Main only logs (LIVE, the stream,
    // a paired computer) shows it if its first frame comes after all.
    // A screen with no first frame 2 s after it went up says so (the owner's QA23-HALLDROP-1 (a)), not a cued one.
    const stopWatch = watchStart(
      v,
      mediaId,
      (verdict, seen) => {
        if (settled) return;
        presentation?.stop();
        settled = true;
        reportVideoCue(layer.cueId, 'picture', false);
        if (!privateCue.current)
          tellCannotPlay(mediaId, startedAt, attempt ?? 0, {
            code: verdict === 'slow' ? NO_START_IN_TIME : NO_FIRST_FRAME,
            message: seen,
          });
      },
      layer.cueId ? undefined : startedAt,
    );
    playback.current = p;
    // A cued picture starts on its Go, not 34-79 ms after it: its sound is pulled by this page's silent graph, so its
    // clock starts with its rate (render/cue-clock.ts, QA21-S5-1). Every other picture plays muted, as before.
    const unclock = layer.cueId ? cueClock(v) : null;
    return () => {
      settled = true;
      stopWatch();
      presentation?.stop();
      playback.current = null;
      p();
      unclock?.();
    };
  }, [key, mediaId, attempt, startedAt, layer.cueId, dispatch]);
  useEffect(() => {
    if (slot.cued && slot.state === 'ready' && ref.current)
      reportLoadedVideoCue(layer.cueId, 'picture', ref.current);
  }, [slot, layer.cueId]);
  // The operator's LIVE preview (QA23-CUELIVE-1): its cued picture says it has started once its rate is set above 0
  // while it plays (a prepared start's rate at Go; a start with no lead plays at its rate), after its own check for Go.
  const cueId = layer.cueId;
  useEffect(() => {
    const v = ref.current;
    if (!tellStart || !cueId || !v) return;
    const told = () => {
      if (startedNow(v)) cueStarted(cueId);
    };
    v.addEventListener('ratechange', told);
    v.addEventListener('playing', told);
    return () => {
      v.removeEventListener('ratechange', told);
      v.removeEventListener('playing', told);
    };
  }, [tellStart, cueId]);
  const seekAt = layer.seek?.at;
  const clipKey = `${String(layer.clip?.startMs)}/${String(layer.clip?.endMs)}`;
  useEffect(() => {
    playback.current?.resync();
  }, [seekAt, clipKey]);
  // Drawn over the picture before with its data in (alpha.20): ready once Chromium has presented a frame of it on the
  // screen, so the picture before goes only then, never leaving the hall a black frame between (CI
  // x54-1121-023510-80364: shown the moment its data was in, it was not yet presented). A frame callback that does not
  // come (a paused video presents no new frame) is not waited on long.
  const presenting = slot.state === 'loaded' && visible;
  useEffect(() => {
    const v = ref.current;
    if (!presenting || !v) return;
    let done = false;
    const presented = () => {
      if (done) return;
      done = true;
      dispatch({ type: 'ready', key, at: engineNow() });
    };
    const callback = v.requestVideoFrameCallback(presented);
    // eslint-disable-next-line no-restricted-syntax -- only stops waiting for a frame callback: what shows is decided by the slots
    const fallback = setTimeout(presented, PRESENT_WAIT_MS);
    return () => {
      done = true;
      v.cancelVideoFrameCallback(callback);
      clearTimeout(fallback);
    };
  }, [presenting, key, dispatch]);

  const opacity = visible ? 1 : layer.cueId ? PRIVATE_VIDEO_OPACITY : 0;
  return (
    <video
      ref={ref}
      data-cue-id={layer.cueId}
      data-bg-slot={key}
      data-state={slot.state}
      data-media-id={mediaId}
      muted
      playsInline
      crossOrigin={layer.cueId ? 'anonymous' : undefined}
      disablePictureInPicture
      preload="auto"
      loop={layer.loop && !layer.clip}
      style={
        shape === null
          ? { ...style(layer.fit, visible), opacity }
          : { ...shapedVideoStyle(shape, layer.fit === 'fill' ? 'fill' : 'fit'), opacity }
      }
    />
  );
}

function ImageSlot({
  slot,
  visible,
  dispatch,
}: {
  slot: MediaSlot;
  visible: boolean;
  dispatch: Dispatch<SlotEvent>;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const { key, layer, attempt } = slot;
  const { mediaId } = layer;
  const urlOf = useMediaUrl();
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    let live = true;
    // The picture the markup names: its sharpened copy, once that is loaded here (Session 26f).
    const decode = (): void => {
      const asked = img.src;
      img.decode().then(
        () => {
          if (live) dispatch({ type: 'ready', key, at: engineNow() });
        },
        () => {
          if (!live) return;
          // Its copy came in meanwhile (a new src): that one is waited for instead.
          if (img.src !== asked) decode();
          else dispatch({ type: 'failed', key });
        },
      );
    };
    decode();
    return () => {
      live = false;
    };
  }, [key, mediaId, attempt, dispatch]);
  // A picture's look (Session 26e), and the live zoom of this background's showing. Its src is in the
  // markup, so a picture that gains a look (drawn anew inside it) is never blank, and its sharpened copy
  // (Session 26f) takes its place once loaded, the picture staying up until then.
  return (
    <Looked mediaId={mediaId} showing={backgroundShowing(layer.startedAt)} style={style(layer.fit, visible)}>
      {(s, copy) => (
        <img
          ref={ref}
          alt=""
          draggable={false}
          src={copy?.url ?? urlOf(mediaId, attempt)}
          data-bg-slot={key}
          data-state={slot.state}
          data-media-id={mediaId}
          style={s}
        />
      )}
    </Looked>
  );
}

/**
 * A video input as the background (Session 50): live, fitted inside or filling the screen as a video can be,
 * and silent. It is ready on its first frame; one that cannot start (not there, refused, taken) has failed and
 * shows nothing, until it starts. Stopped while up, it keeps its last picture. Where this computer does not
 * have it (a node's screens) it opens nothing and draws nothing. `current`: up now (shown or on its way), not
 * dissolving out, so the page says how it stands.
 */
function InputSlotView({
  slot,
  visible,
  current,
  dispatch,
}: {
  slot: InputSlot;
  visible: boolean;
  current: boolean;
  dispatch: Dispatch<SlotEvent>;
}) {
  const { key, layer } = slot;
  const capture = useVideoInput(layer);
  useInputReport(layer.inputId, key, capture.state, current, capture.reason);
  const loading = slot.state === 'loading';
  const cannot = capture.state === 'stopped' || capture.state === 'absent';
  useEffect(() => {
    if (loading && cannot) dispatch({ type: 'failed', key });
  }, [loading, cannot, key, dispatch]);
  const onFrame = useCallback(() => {
    dispatch({ type: 'ready', key, at: engineNow() });
  }, [key, dispatch]);
  return (
    <div
      data-bg-slot={key}
      data-state={slot.state}
      data-kind="input"
      data-input-id={layer.inputId}
      data-input-state={capture.state}
      style={{ position: 'absolute', inset: 0, opacity: visible ? 1 : 0 }}
    >
      {capture.state !== 'absent' && (
        <KeptVideo
          stream={capture.stream}
          live={capture.state === 'live'}
          fit={OBJECT_FIT[layer.fit]}
          onFrame={onFrame}
        />
      )}
    </div>
  );
}

/**
 * Set the dissolve's opacities on a background's pictures: the old one out, the new one in, on the same
 * curve as the slide's (Session 27: eased, in + out = 1). A picture not in a dissolve is whole (Session 23:
 * one left with an opacity from a dissolve stayed dim).
 */
function setFade(root: HTMLElement | null, start: number | null, ms: number, movement: Movement): number {
  const p = start === null ? 1 : Math.min(1, Math.max(0, (engineNow() - start) / ms));
  const e = dissolveCurve(movement)(p);
  for (const el of root?.querySelectorAll<HTMLElement>('[data-bg-wrap]') ?? []) {
    const role = el.dataset['bgFade'];
    el.style.opacity = role === undefined ? '' : String(role === 'out' ? 1 - e : e);
  }
  return p;
}

/**
 * Run a background's dissolve, frame by frame, from the clock every screen
 * shares. The opacities are set straight on the elements, after every
 * render too (so a render never puts them back).
 */
function useFade(
  root: React.RefObject<HTMLDivElement | null>,
  slots: Slots,
  dispatch: Dispatch<SlotEvent>,
  movement: Movement,
  pair?: VideoCrossfade | null,
  opaqueCanvas = false,
): void {
  const start = slots.fade?.start ?? null;
  const ms = slots.fade?.ms ?? 0;
  useLayoutEffect(() => {
    if (pair) setVideoFade(root.current, pair, opaqueCanvas);
    else setFade(root.current, start, ms, movement);
  });
  useEffect(() => {
    if (start === null) return;
    let frame = 0;
    const tick = () => {
      if (
        (pair
          ? setVideoFade(root.current, pair, opaqueCanvas)
          : setFade(root.current, start, ms, movement)) >= 1
      ) {
        dispatch({ type: 'faded', start });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [root, start, ms, dispatch, movement, pair, opaqueCanvas]);
}

/**
 * The background layer's image or video. Changing it never flashes black:
 * the old picture stays until the new one has its first frame. Clearing it is
 * immediate. `annotate` marks a file that cannot play (the operator preview).
 * On a phone or tablet it is a still preview instead (render/previews.tsx).
 */
/** Linear, complementary picture gains at the engine moment, shared with both sound players. */
function setVideoFade(root: HTMLElement | null, fade: VideoCrossfade, opaqueCanvas: boolean): number {
  const progress = videoFadeProgress(fade, engineNow());
  for (const el of root?.querySelectorAll<HTMLElement>('[data-bg-wrap]') ?? []) {
    const role = el.dataset['bgFade'];
    const gain = role === undefined ? 1 : role === 'out' ? 1 - progress : progress;
    // The incoming opaque canvas supplies p; source-over attenuates the opaque old canvas by 1-p.
    // This is the same linear picture mix without a costly plus-lighter software blend.
    el.style.opacity = String(role === 'out' && opaqueCanvas ? 1 : gain);
    el.dataset['videoGain'] = String(Math.round(gain * 1e6) / 1e6);
  }
  return progress;
}

export function BackgroundMedia(props: {
  cue?: VideoCue | null;
  crossfade?: VideoCrossfade | null;
  /** Opaque hall/stream canvas; key/fill retains the alpha-safe blend. */
  opaqueCanvas?: boolean;
  layer: BackgroundLayer | null;
  annotate?: boolean;
  /** The operator window's previews (QA23-CUELIVE-1): their Go-moment work after LIVE's cued picture's start. */
  cueStartFirst?: boolean;
  /** LIVE's preview alone: its cued picture tells the window when it has started at Go. */
  cueStartTeller?: boolean;
  /** How this screen's group moves (Session 27): its dissolve's curve. */
  movement?: Movement;
  /**
   * Told which background is drawn now, by its key (background-slots.ts slotKey; null: none), as it changes, before
   * the screen is painted (Q60-31): render/Scene.tsx keeps what was there until a new one's first frame.
   */
  onDrawn?: (key: string | null) => void;
}) {
  const previews = usePreviewsOnly();
  if (!previews) return <BackgroundPlayer {...props} cue={props.cue?.error ? null : props.cue} />;
  return <BackgroundPreview {...props} />;
}

/** On a phone or tablet: the background's still preview, drawn at once (never waited on). */
function BackgroundPreview({
  layer,
  onDrawn,
}: {
  layer: BackgroundLayer | null;
  onDrawn?: (key: string | null) => void;
}) {
  const key = layer?.kind === 'media' || layer?.kind === 'input' ? slotKey(layer) : null;
  useLayoutEffect(() => {
    onDrawn?.(key);
  }, [onDrawn, key]);
  if (layer?.kind !== 'media') return null;
  // A picture with its look and, once ready, a preview of its sharpened copy (Session 26f), as a slide's
  // picture is drawn on a phone; a video's still preview as it is.
  return (
    <div data-layer="background" data-kind="media" style={{ position: 'absolute', inset: 0 }}>
      {layer.media === 'image' ? (
        <Looked
          mediaId={layer.mediaId}
          showing={backgroundShowing(layer.startedAt)}
          style={style(layer.fit, true)}
        >
          {(s, copy) => <PreviewPicture mediaId={copy?.id ?? layer.mediaId} style={s} />}
        </Looked>
      ) : (
        <PreviewPicture mediaId={layer.mediaId} style={style(layer.fit, true)} />
      )}
    </div>
  );
}

function BackgroundPlayer({
  layer,
  annotate = false,
  movement = 'calm',
  onDrawn,
  cue,
  crossfade,
  opaqueCanvas = false,
  cueStartFirst = false,
  cueStartTeller = false,
}: {
  opaqueCanvas?: boolean;
  cue?: VideoCue | null;
  crossfade?: VideoCrossfade | null;
  layer: BackgroundLayer | null;
  annotate?: boolean;
  cueStartFirst?: boolean;
  cueStartTeller?: boolean;
  movement?: Movement;
  onDrawn?: (key: string | null) => void;
}) {
  const [slots, dispatch] = useReducer(slotsReducer, NO_SLOTS);
  // Its pictures as layers of their own, rastered once (x27): a screen warped out of square with a graphics chip.
  const ownLayers = useContext(OwnLayers);
  // Sound and picture…'s Shape (alpha.20, x55): a video drawn in a shape of its own.
  const shapes = useVideoShapes();
  // Follow the engine during render, so a new background starts loading in the same commit.
  const [seen, setSeen] = useState<BackgroundLayer | null | undefined>(undefined);
  if (seen !== layer) {
    setSeen(layer);
    // The first time: this window has just opened, perhaps part-way through a dissolve (Session 23).
    if (seen === undefined && crossfade && layer?.kind === 'media')
      dispatch({ type: 'joinPair', layer, fade: crossfade });
    else dispatch({ type: 'layer', layer, joined: seen === undefined });
  }
  const [seenCue, setSeenCue] = useState<VideoCue | null | undefined>(undefined);
  if (
    seenCue !== cue ||
    (cue &&
      !slots.leaving &&
      (!slots.incoming || slots.incoming.cued) &&
      slots.incoming?.key !== slotKey(cue.background) &&
      slots.shown?.key !== slotKey(cue.background))
  ) {
    setSeenCue(cue);
    dispatch({ type: 'cue', cue: cue ?? null });
  }
  const [seenPair, setSeenPair] = useState(crossfade);
  if (seenPair !== crossfade) {
    if (seenPair && !crossfade) dispatch({ type: 'pairDone' });
    setSeenPair(crossfade);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  useFade(rootRef, slots, dispatch, movement, crossfade, opaqueCanvas);
  const coming = slots.incoming;
  useEffect(() => {
    if (
      !coming ||
      coming.cued ||
      coming.state !== 'ready' ||
      coming.layer.kind !== 'media' ||
      !coming.layer.cueId
    )
      return;
    const at = coming.layer.seek?.at ?? coming.layer.startedAt;
    const activate = (now: number) =>
      dispatch({ type: 'activate', key: coming.key, at: now, fade: crossfade });
    const afterStart = cueStartFirst ? afterCueStart(coming.layer.cueId) : undefined;
    return atGoMoment(at, activate, { checkNow: true, ...(afterStart ? { afterStart } : {}) });
  }, [coming, crossfade, cueStartFirst]);
  // During Pause/Play the outgoing source clock changes in place, without replacing its decoder.
  const outgoing = crossfade?.from;
  const leaving = slots.leaving && outgoing ? { ...slots.leaving, layer: outgoing } : slots.leaving;
  // On a node: a background that failed because its copy had not arrived loads again when it lands,
  // once for each landing (a try that fails again waits for the next one). A video that failed with a GPU
  // process that stopped loads again once another has started (Sessions 31–36, ROB-5), the same way.
  // A file that failed: as it loaded (coming in, the picture before still drawn), or while it played (Q60-31).
  const failedFile =
    slots.incoming?.state === 'failed'
      ? slots.incoming
      : slots.shown?.state === 'failed'
        ? slots.shown
        : null;
  const landed =
    useMediaAttempt(failedFile?.layer.kind === 'media' ? failedFile.layer.mediaId : '') + useGpuRestarts();
  useEffect(() => {
    const key = retryAfterLanding(slots, landed);
    if (key !== null) dispatch({ type: 'retry', key });
  }, [slots, landed]);
  // Which background is drawn now, told before the screen is painted (render/Scene.tsx keeps what was there till then).
  const drawn = drawnKeyOf(slots);
  useLayoutEffect(() => {
    onDrawn?.(drawn);
  }, [onDrawn, drawn]);
  const list = [leaving, slots.shown, slots.incoming].filter((s): s is Slot => s !== null);
  if (list.length === 0) return null;
  const fading = slots.fade !== null;
  const opaqueBlend = !!crossfade && opaqueCanvas;
  return (
    <div
      ref={rootRef}
      data-layer="background"
      data-kind="media"
      data-video-crossfade={crossfade?.id}
      data-fading={fading ? 'true' : undefined}
      data-fade-start={slots.fade?.start ?? undefined}
      // The old and new pictures blend with each other only.
      style={{ position: 'absolute', inset: 0, isolation: fading && !opaqueBlend ? 'isolate' : undefined }}
    >
      {list.map((slot) => {
        const visible =
          ((slot === slots.shown || slot === leaving) && isDrawn(slot)) || drawnOver(slots, slot);
        const shape =
          isMediaSlot(slot) && slot.layer.media === 'video'
            ? shapeFor(shapes, slot.layer.mediaId, slot.layer.fit)
            : null;
        const element = isMediaSlot(slot) ? (
          slot.layer.media === 'video' ? (
            <VideoSlot
              slot={slot}
              visible={visible}
              shape={shape}
              dispatch={dispatch}
              tellStart={cueStartTeller}
            />
          ) : (
            <ImageSlot slot={slot} visible={visible} dispatch={dispatch} />
          )
        ) : isInputSlot(slot) ? (
          <InputSlotView slot={slot} visible={visible} current={slot !== leaving} dispatch={dispatch} />
        ) : null;
        return (
          <div
            key={`${slot.key}#${slot.attempt ?? 0}`}
            data-bg-wrap=""
            data-bg-fade={slot === leaving ? 'out' : slot === slots.shown && fading ? 'in' : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              mixBlendMode:
                fading && !opaqueBlend && slot === slots.shown && slots.leaving ? 'plus-lighter' : undefined,
              // Full canvas matte also preserves linear weights through letterboxes and video shapes.
              background: fading && opaqueBlend ? '#000000' : undefined,
              willChange: ownLayers ? 'opacity' : undefined,
              // A video in a shape of its own: its box laid out in this place, and clipped to it (filling).
              ...(shape === null ? {} : SHAPED_PLACE),
            }}
          >
            {element}
          </div>
        );
      })}
      {annotate && failedFile !== null && (
        <div
          data-testid="background-failed"
          style={{
            position: 'absolute',
            left: '2%',
            bottom: '3%',
            padding: '0.4em 0.8em',
            background: 'rgba(160, 30, 30, 0.85)',
            color: '#ffffff',
            fontSize: 36,
            borderRadius: 8,
          }}
        >
          {failedFile.layer.kind === 'input' ? 'Video input has no picture' : 'Background cannot play'}
        </div>
      )}
    </div>
  );
}
