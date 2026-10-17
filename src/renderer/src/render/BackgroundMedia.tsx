import { type Dispatch, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { BackgroundLayer, MediaFit } from '../../../shared/engine/state';
import {
  NO_SLOTS,
  retryAfterLanding,
  type Slot,
  type SlotEvent,
  type Slots,
  slotsReducer,
} from './background-slots';
import { OBJECT_FIT } from './media-style';
import { type Playback, startPlayback } from './playback';
import { engineNow } from './clock';
import { dissolveCurve } from './transition-frame';
import type { Movement } from '../../../shared/looks';
import { Looked } from './picture-looks';
import { backgroundShowing } from '../../../shared/picture-look';
import { PreviewPicture, usePreviewsOnly } from './previews';
import { useGpuRestarts, useMediaAttempt } from './media-attempts';
import { useMediaUrl } from './media-urls';

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

/** A background video: it says it is ready once its first frame (at the right point) is decoded. */
function VideoSlot({
  slot,
  visible,
  dispatch,
}: {
  slot: Slot;
  visible: boolean;
  dispatch: Dispatch<SlotEvent>;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { key, layer, attempt } = slot;
  const { mediaId, startedAt } = layer;
  // Start and end points and a jump to a marker (Session 14) are read as they change, without a reload.
  const timing = useRef(layer);
  useLayoutEffect(() => {
    timing.current = layer;
  });
  const playback = useRef<Playback | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const p = startPlayback(v, {
      mediaId,
      attempt,
      startedAt,
      timing: () => ({ loop: timing.current.loop, clip: timing.current.clip, seek: timing.current.seek }),
      onFrame: () => {
        dispatch({ type: 'ready', key, at: engineNow() });
      },
      onError: () => {
        dispatch({ type: 'failed', key });
      },
    });
    playback.current = p;
    return () => {
      playback.current = null;
      p();
    };
  }, [key, mediaId, attempt, startedAt, dispatch]);
  const seekAt = layer.seek?.at;
  const clipKey = `${String(layer.clip?.startMs)}/${String(layer.clip?.endMs)}`;
  useEffect(() => {
    playback.current?.resync();
  }, [seekAt, clipKey]);

  return (
    <video
      ref={ref}
      data-bg-slot={key}
      data-state={slot.state}
      data-media-id={mediaId}
      muted
      playsInline
      disablePictureInPicture
      preload="auto"
      loop={layer.loop && !layer.clip}
      style={style(layer.fit, visible)}
    />
  );
}

function ImageSlot({
  slot,
  visible,
  dispatch,
}: {
  slot: Slot;
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
): void {
  const start = slots.fade?.start ?? null;
  const ms = slots.fade?.ms ?? 0;
  useLayoutEffect(() => {
    setFade(root.current, start, ms, movement);
  });
  useEffect(() => {
    if (start === null) return;
    let frame = 0;
    const tick = () => {
      if (setFade(root.current, start, ms, movement) >= 1) {
        dispatch({ type: 'faded', start });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [root, start, ms, dispatch, movement]);
}

/**
 * The background layer's image or video. Changing it never flashes black:
 * the old picture stays until the new one has its first frame. Clearing it is
 * immediate. `annotate` marks a file that cannot play (the operator preview).
 * On a phone or tablet it is a still preview instead (render/previews.tsx).
 */
export function BackgroundMedia(props: {
  layer: BackgroundLayer | null;
  annotate?: boolean;
  /** How this screen's group moves (Session 27): its dissolve's curve. */
  movement?: Movement;
}) {
  const previews = usePreviewsOnly();
  if (!previews) return <BackgroundPlayer {...props} />;
  const layer = props.layer;
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
}: {
  layer: BackgroundLayer | null;
  annotate?: boolean;
  movement?: Movement;
}) {
  const [slots, dispatch] = useReducer(slotsReducer, NO_SLOTS);
  // Follow the engine during render, so a new background starts loading in the same commit.
  const [seen, setSeen] = useState<BackgroundLayer | null | undefined>(undefined);
  if (seen !== layer) {
    setSeen(layer);
    // The first time: this window has just opened, perhaps part-way through a dissolve (Session 23).
    dispatch({ type: 'layer', layer, joined: seen === undefined });
  }
  const rootRef = useRef<HTMLDivElement>(null);
  useFade(rootRef, slots, dispatch, movement);
  // On a node: a background that failed because its copy had not arrived loads again when it lands,
  // once for each landing (a try that fails again waits for the next one). A video that failed with a GPU
  // process that stopped loads again once another has started (Sessions 31–36, ROB-5), the same way.
  const shown = slots.shown;
  const landed = useMediaAttempt(shown?.layer.mediaId ?? '') + useGpuRestarts();
  useEffect(() => {
    const key = retryAfterLanding(shown, landed);
    if (key !== null) dispatch({ type: 'retry', key });
  }, [shown, landed]);
  const list = [slots.leaving, slots.shown, slots.incoming].filter((s): s is Slot => s !== null);
  if (list.length === 0) return null;
  const fading = slots.fade !== null;
  return (
    <div
      ref={rootRef}
      data-layer="background"
      data-kind="media"
      data-fading={fading ? 'true' : undefined}
      data-fade-start={slots.fade?.start ?? undefined}
      // The old and new pictures blend with each other only.
      style={{ position: 'absolute', inset: 0, isolation: fading ? 'isolate' : undefined }}
    >
      {list.map((slot) => {
        const visible = (slot === slots.shown || slot === slots.leaving) && slot.state === 'ready';
        const element =
          slot.layer.media === 'video' ? (
            <VideoSlot slot={slot} visible={visible} dispatch={dispatch} />
          ) : (
            <ImageSlot slot={slot} visible={visible} dispatch={dispatch} />
          );
        return (
          <div
            key={`${slot.key}#${slot.attempt ?? 0}`}
            data-bg-wrap=""
            data-bg-fade={slot === slots.leaving ? 'out' : slot === slots.shown && fading ? 'in' : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              mixBlendMode: fading && slot === slots.shown && slots.leaving ? 'plus-lighter' : undefined,
            }}
          >
            {element}
          </div>
        );
      })}
      {annotate && slots.shown?.state === 'failed' && (
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
          Background cannot play
        </div>
      )}
    </div>
  );
}
