import { type CSSProperties, useEffect, useLayoutEffect, useRef } from 'react';

/*
 * A live picture that keeps its last one (a video input, Session 50, kept as Session 48 keeps a window's): its
 * picture is copied about once a second, so when it stops (unplugged, or taken by another app) the screen keeps
 * the last one, never black, and the operator's notice says why. As a capture ends its video shows black, and
 * that black can be the next frame copied: nothing is copied once it has ended or while its frames are paused,
 * and what shows is the copy taken a second before the newest. Silent, always.
 */

/** How often the kept picture is taken from the live one. */
const KEEP_MS = 1000;

export function KeptVideo({
  stream,
  live,
  fit,
  keep = true,
  onFrame,
}: {
  stream: MediaStream | null;
  /** Its video shows while live; otherwise the picture kept from it (black when none was). */
  live: boolean;
  fit: 'contain' | 'cover' | 'fill';
  /** Keep a copy to show once it stops: the screens do; Media's small pictures need none. */
  keep?: boolean;
  /** The stream's first frame is here (each new stream's). */
  onFrame?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const kept = useRef<HTMLCanvasElement>(null);
  const framed = useRef(onFrame);
  useLayoutEffect(() => {
    framed.current = onFrame;
  });
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    if (!stream) return;
    void v.play().catch(() => undefined);
    const first = () => {
      framed.current?.();
    };
    if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) first();
    else v.addEventListener('loadeddata', first, { once: true });
    return () => {
      v.removeEventListener('loadeddata', first);
    };
  }, [stream]);
  useEffect(() => {
    const v = video.current;
    const c = kept.current;
    if (!keep || !v || !c || !stream) return;
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
    const copy = (now: number) => {
      // Ended: the video now shows black, and the copies keep what came before.
      if (!on || track?.readyState === 'ended') return;
      if (!track?.muted && now - last >= KEEP_MS && v.videoWidth > 0) {
        last = now;
        if (copies > 0) into(c, newest, newest.width, newest.height);
        into(newest, v, v.videoWidth, v.videoHeight);
        // The first copy is shown too, until there is one a second older.
        if (copies === 0) into(c, newest, newest.width, newest.height);
        copies++;
      }
      handle = v.requestVideoFrameCallback(copy);
    };
    handle = v.requestVideoFrameCallback(copy);
    return () => {
      on = false;
      v.cancelVideoFrameCallback(handle);
    };
  }, [stream, keep]);
  const placed: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: fit,
  };
  return (
    <>
      {keep && <canvas ref={kept} aria-hidden="true" style={{ ...placed, opacity: live ? 0 : 1 }} />}
      <video
        ref={video}
        muted
        playsInline
        disablePictureInPicture
        style={{ ...placed, opacity: live ? 1 : 0 }}
      />
    </>
  );
}
