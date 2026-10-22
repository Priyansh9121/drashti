import { type CSSProperties, useEffect, useRef } from 'react';
import type { WindowBackground } from '../../../shared/engine/state';
import { useLiveWindow } from './live-window';
import { usePreviewsOnly } from './previews';

/*
 * Another app's window as the background (Session 48): live, fitted inside the screen with black around it,
 * and silent. Its picture is kept about once a second, so when the window closes the screen keeps the last
 * one, and the operator's notice says why. As its capture ends the video shows black, and after a still while (a
 * shared slide) that black was the next frame and was kept (caught by show-a-window.spec.ts): nothing is kept
 * once it has ended, and what shows is the copy kept a second before the newest. Phones and tablets draw
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

export function LiveWindowView({
  layer,
  as = 'background',
}: {
  layer: WindowBackground;
  /** The layer it is drawn for: the background, or the picture-in-picture box (Session 50). */
  as?: 'background' | 'pip';
}) {
  const previews = usePreviewsOnly();
  if (previews) return null;
  return <LiveWindowPicture layer={layer} as={as} />;
}

function LiveWindowPicture({ layer, as }: { layer: WindowBackground; as: 'background' | 'pip' }) {
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
    const track = stream.getVideoTracks()[0];
    // The newest copy, never shown: what it held goes into the shown one as the next is taken.
    const newest = document.createElement('canvas');
    let copies = 0;
    let last = -Infinity;
    let handle = 0;
    let on = true;
    const into = (to: HTMLCanvasElement, from: CanvasImageSource, width: number, height: number) => {
      if (to.width !== width) to.width = width;
      if (to.height !== height) to.height = height;
      to.getContext('2d')?.drawImage(from, 0, 0);
    };
    const keep = (now: number) => {
      // Ended: the video now shows black, and the copies keep what came before.
      if (!on || track?.readyState === 'ended') return;
      if (now - last >= KEEP_MS && v.videoWidth > 0) {
        last = now;
        if (copies > 0) into(c, newest, newest.width, newest.height);
        into(newest, v, v.videoWidth, v.videoHeight);
        // The first copy is shown too, until there is one a second older.
        if (copies === 0) into(c, newest, newest.width, newest.height);
        copies++;
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
      data-layer={as === 'pip' ? undefined : 'background'}
      data-pip-picture={as === 'pip' ? 'window' : undefined}
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
