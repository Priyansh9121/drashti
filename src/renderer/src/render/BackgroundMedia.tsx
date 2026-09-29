import { type Dispatch, useEffect, useReducer, useRef, useState } from 'react';
import type { BackgroundLayer, MediaFit } from '../../../shared/engine/state';
import { mediaUrl } from '../../../shared/media';
import { NO_SLOTS, type Slot, type SlotEvent, slotsReducer } from './background-slots';
import { OBJECT_FIT } from './media-style';
import { startPlayback } from './playback';

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
        dispatch({ type: 'ready', key });
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
        if (live) dispatch({ type: 'ready', key });
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

/**
 * The background layer's image or video. Changing it never flashes black:
 * the old picture stays until the new one has its first frame. Clearing it is
 * immediate. `annotate` marks a file that cannot play (the operator preview).
 */
export function BackgroundMedia({
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
  const list = [slots.shown, slots.incoming].filter((s): s is Slot => s !== null);
  if (list.length === 0) return null;
  return (
    <div data-layer="background" data-kind="media" style={{ position: 'absolute', inset: 0 }}>
      {list.map((slot) => {
        const visible = slot === slots.shown && slot.state === 'ready';
        return slot.layer.media === 'video' ? (
          <VideoSlot key={slot.key} slot={slot} visible={visible} dispatch={dispatch} />
        ) : (
          <ImageSlot key={slot.key} slot={slot} visible={visible} dispatch={dispatch} />
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
