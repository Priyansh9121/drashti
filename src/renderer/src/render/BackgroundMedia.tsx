import { type Dispatch, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { BackgroundLayer, MediaFit } from '../../../shared/engine/state';
import { mediaUrl } from '../../../shared/media';
import { NO_SLOTS, type Slot, type SlotEvent, type Slots, slotsReducer } from './background-slots';
import { OBJECT_FIT } from './media-style';
import { startPlayback } from './playback';
import { engineNow } from './clock';
import { PreviewPicture, usePreviewsOnly } from './previews';
import { useMediaAttempt } from './media-attempts';

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
  const { key, layer } = slot;
  const { mediaId, startedAt } = layer;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    return startPlayback(v, {
      mediaId,
      startedAt,
      onFrame: () => {
        dispatch({ type: 'ready', key, at: engineNow() });
      },
      onError: () => {
        dispatch({ type: 'failed', key });
      },
    });
  }, [key, mediaId, startedAt, dispatch]);

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
      loop={layer.loop}
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
  const { key, layer } = slot;
  const { mediaId } = layer;
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    let live = true;
    img.src = mediaUrl(mediaId);
    img.decode().then(
      () => {
        if (live) dispatch({ type: 'ready', key, at: engineNow() });
      },
      () => {
        if (live) dispatch({ type: 'failed', key });
      },
    );
    return () => {
      live = false;
    };
  }, [key, mediaId, dispatch]);
  return (
    <img
      ref={ref}
      alt=""
      draggable={false}
      data-bg-slot={key}
      data-state={slot.state}
      data-media-id={mediaId}
      style={style(layer.fit, visible)}
    />
  );
}

/** Set the dissolve's opacities on a background's pictures: the old one out, the new one in. */
function setFade(root: HTMLElement | null, start: number | null, ms: number): number {
  const p = start === null ? 1 : Math.min(1, Math.max(0, (engineNow() - start) / ms));
  for (const el of root?.querySelectorAll<HTMLElement>('[data-bg-fade]') ?? [])
    el.style.opacity = String(el.dataset['bgFade'] === 'out' ? 1 - p : p);
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
): void {
  const start = slots.fade?.start ?? null;
  const ms = slots.fade?.ms ?? 0;
  useLayoutEffect(() => {
    setFade(root.current, start, ms);
  });
  useEffect(() => {
    if (start === null) return;
    let frame = 0;
    const tick = () => {
      if (setFade(root.current, start, ms) >= 1) {
        dispatch({ type: 'faded', start });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [root, start, ms, dispatch]);
}

/**
 * The background layer's image or video. Changing it never flashes black:
 * the old picture stays until the new one has its first frame. Clearing it is
 * immediate. `annotate` marks a file that cannot play (the operator preview).
 * On a phone or tablet it is a still preview instead (render/previews.tsx).
 */
export function BackgroundMedia(props: { layer: BackgroundLayer | null; annotate?: boolean }) {
  const previews = usePreviewsOnly();
  if (!previews) return <BackgroundPlayer {...props} />;
  const layer = props.layer;
  if (layer?.kind !== 'media') return null;
  return (
    <div data-layer="background" data-kind="media" style={{ position: 'absolute', inset: 0 }}>
      <PreviewPicture mediaId={layer.mediaId} style={style(layer.fit, true)} />
    </div>
  );
}

function BackgroundPlayer({
  layer,
  annotate = false,
}: {
  layer: BackgroundLayer | null;
  annotate?: boolean;
}) {
  const [slots, dispatch] = useReducer(slotsReducer, NO_SLOTS);
  // Follow the engine during render, so a new background starts loading in the same commit.
  const [seen, setSeen] = useState<BackgroundLayer | null | undefined>(undefined);
  if (seen !== layer) {
    setSeen(layer);
    dispatch({ type: 'layer', layer });
  }
  const rootRef = useRef<HTMLDivElement>(null);
  useFade(rootRef, slots, dispatch);
  // On a node: a background that failed because its copy had not arrived loads again when it lands.
  const failed = slots.shown?.state === 'failed' ? slots.shown : null;
  const landed = useMediaAttempt(failed?.layer.mediaId ?? '');
  useEffect(() => {
    if (failed && landed > 0) dispatch({ type: 'retry', key: failed.key });
    // Only a landing (a new count) tries again, never the failure itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);
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
