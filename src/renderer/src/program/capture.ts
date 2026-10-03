import { PREVIEW_FPS, PREVIEW_WIDTH } from '../../../shared/stream';

/*
 * The stream's page captures its own picture (the Program), frame by frame,
 * for the operator's preview and, while live or recording, for the encoder.
 * The capture runs only while something wants it.
 *
 * Ports come from the main process through the preload (window.postMessage
 * with the port): 'preview' goes to the operator window.
 */

let preview: MessagePort | null = null;
let track: MediaStreamTrack | null = null;
let size = { width: 1920, height: 1080 };
let levelOf: () => number = () => -100;
let previewBusy = false;
let lastPreview = 0;
let frames = 0;

const previewHeight = () => Math.round((PREVIEW_WIDTH * size.height) / size.width);

/** A small JPEG of the frame, for the operator's preview. */
async function sendPreview(frame: VideoFrame): Promise<void> {
  const port = preview;
  if (!port) return;
  const height = previewHeight();
  const bitmap = await createImageBitmap(frame, {
    resizeWidth: PREVIEW_WIDTH,
    resizeHeight: height,
    resizeQuality: 'low',
  });
  const canvas = new OffscreenCanvas(PREVIEW_WIDTH, height);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  port.postMessage({ kind: 'frame', data: await blob.arrayBuffer(), width: PREVIEW_WIDTH, height });
}

async function capture(): Promise<void> {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { width: size.width, height: size.height, frameRate: 30 },
    audio: false,
  });
  const video = display.getVideoTracks()[0];
  if (!video) return;
  track = video;
  document.body.dataset['capture'] = 'on';
  const reader = new MediaStreamTrackProcessor({ track: video }).readable.getReader();
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done) break;
    frames++;
    document.body.dataset['frames'] = String(frames);
    const now = performance.now();
    if (preview && !previewBusy && now - lastPreview >= 1000 / PREVIEW_FPS) {
      previewBusy = true;
      lastPreview = now;
      const copy = frame.clone();
      void sendPreview(copy).finally(() => {
        copy.close();
        previewBusy = false;
      });
    }
    frame.close();
  }
  document.body.dataset['capture'] = 'off';
}

function wanted(): boolean {
  return preview !== null;
}

function update(): void {
  if (wanted() && !track) {
    void capture().catch(() => {
      track = null;
      document.body.dataset['capture'] = 'failed';
    });
  } else if (!wanted() && track) {
    track.stop();
    track = null;
  }
}

/** Start listening for ports from the main process. */
export function startCapture(level: () => number): void {
  levelOf = level;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as { drashtiStreamPort?: string } | null;
    const port = event.ports[0];
    if (data?.drashtiStreamPort === 'preview' && port) {
      preview?.close();
      preview = port;
      port.start();
      update();
    }
  });
  // The sound level: looked at every 25 ms (each look sees the last 43 ms), and the loudest of
  // each 100 ms sent on, so a short sound is never missed between two reports.
  let loudest = -100;
  let looks = 0;
  setInterval(() => {
    loudest = Math.max(loudest, levelOf());
    if (++looks < 4) return;
    document.body.dataset['level'] = String(Math.round(loudest));
    preview?.postMessage({ kind: 'level', db: loudest });
    loudest = -100;
    looks = 0;
  }, 25);
}

/** The preview is no longer watched. */
export function stopPreview(): void {
  preview?.close();
  preview = null;
  update();
}

/** The Program's size changed: capture again at the new size. */
export function setCaptureSize(next: { width: number; height: number }): void {
  if (next.width === size.width && next.height === size.height) return;
  size = next;
  if (track) {
    track.stop();
    track = null;
    update();
  }
}
