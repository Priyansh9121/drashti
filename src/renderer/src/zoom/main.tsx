import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import type { ZoomProgram } from '../../../shared/zoom';
import { reportRenderError } from '../ui/render-errors';

/*
 * The window for Zoom's page (Session 48): the stream's picture, exactly, and nothing else: no buttons and no
 * words of Drashti's own, black until the picture comes, and no sound. The picture is the Program's own page
 * (src/main/stream/zoom-window.ts gives this page's request for a screen's picture that page, and nothing
 * else), captured afresh whenever the Program is (re)opened or resized.
 */

function ZoomPicture() {
  const video = useRef<HTMLVideoElement>(null);
  const [program, setProgram] = useState<ZoomProgram | null>(null);
  useEffect(() => {
    const off = window.drashti.zoom.onProgram(setProgram);
    void window.drashti.zoom.program().then(setProgram);
    return off;
  }, []);
  const width = program?.width ?? 0;
  const height = program?.height ?? 0;
  const at = program?.at ?? -1;
  useEffect(() => {
    const v = video.current;
    if (!v || at < 0) return;
    let live = true;
    let stream: MediaStream | null = null;
    void navigator.mediaDevices
      .getDisplayMedia({ video: { width, height, frameRate: 30 }, audio: false })
      .then(
        (s) => {
          if (!live) {
            for (const track of s.getTracks()) track.stop();
            return;
          }
          stream = s;
          v.srcObject = s;
          void v.play().catch(() => undefined);
        },
        // Not given (the Program went meanwhile): black until it is ready again.
        () => undefined,
      );
    return () => {
      live = false;
      for (const track of stream?.getTracks() ?? []) track.stop();
      v.srcObject = null;
    };
  }, [width, height, at]);
  return (
    <video
      ref={video}
      data-testid="zoom-picture"
      data-program={at < 0 ? 'none' : `${String(width)}x${String(height)}`}
      muted
      playsInline
      disablePictureInPicture
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError('window for Zoom', 'uncaught', sendError),
  onCaughtError: reportRenderError('window for Zoom', 'caught', sendError),
}).render(
  <StrictMode>
    <ZoomPicture />
  </StrictMode>,
);
