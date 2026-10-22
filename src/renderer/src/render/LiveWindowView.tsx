import { type CSSProperties, useEffect, useRef } from 'react';
import type { WindowBackground } from '../../../shared/engine/state';
import { useLiveWindow } from './live-window';
import { usePreviewsOnly } from './previews';

/*
 * Another app's window as the background (Session 48): live, fitted inside the screen with black around it,
 * and silent. Its picture is kept about once a second, so when the window closes (its live picture then
 * turns black) the screen keeps the last one, and the operator's notice says why. Phones and tablets draw
 * nothing for it (a phone names it instead), nor does a node's screen (the window is on Main's computer).
 */

const FITTED: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};

/** How often the kept picture is taken from the live one. */
const KEEP_MS = 1000;

export function LiveWindowView({ layer }: { layer: WindowBackground }) {
  const previews = usePreviewsOnly();
  if (previews) return null;
  return <LiveWindowPicture layer={layer} />;
}

function LiveWindowPicture({ layer }: { layer: WindowBackground }) {
  const { stream, state } = useLiveWindow(layer);
  const video = useRef<HTMLVideoElement>(null);
  const kept = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);
  useEffect(() => {
    const v = video.current;
    const c = kept.current;
    if (!v || !c || !stream) return;
    let last = -Infinity;
    let handle = 0;
    let on = true;
    const keep = (now: number) => {
      if (!on) return;
      if (now - last >= KEEP_MS && v.videoWidth > 0) {
        last = now;
        if (c.width !== v.videoWidth) c.width = v.videoWidth;
        if (c.height !== v.videoHeight) c.height = v.videoHeight;
        c.getContext('2d')?.drawImage(v, 0, 0);
      }
      handle = v.requestVideoFrameCallback(keep);
    };
    handle = v.requestVideoFrameCallback(keep);
    return () => {
      on = false;
      v.cancelVideoFrameCallback(handle);
    };
  }, [stream]);
  const ended = state === 'ended';
  return (
    <div
      data-layer="background"
      data-kind="window"
      data-window-state={state}
      style={{ position: 'absolute', inset: 0, background: '#000000' }}
    >
      <canvas ref={kept} aria-hidden="true" style={{ ...FITTED, opacity: ended ? 1 : 0 }} />
      <video
        ref={video}
        muted
        playsInline
        disablePictureInPicture
        style={{ ...FITTED, opacity: ended ? 0 : 1 }}
      />
    </div>
  );
}
