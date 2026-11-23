import type { SoundState } from '../../../shared/stream';
import { PREVIEW_FPS, PREVIEW_WIDTH } from '../../../shared/stream';
import { cutText } from '../../../shared/text';
import { inTurn } from '../render/live-window';
import { useProgram } from './program-store';

/*
 * The stream's page captures its own picture (the Program), frame by frame,
 * for the operator's preview and, while live or recording, for the encoder.
 * The capture runs only while something wants it.
 *
 * Ports come from the main process through the preload (window.postMessage
 * with the port): 'preview' goes to the operator window, 'encoder' to the
 * stream worker. The encoder gets each new frame as it is (raw) here, and
 * 48 kHz stereo directly from the sound renderer; it keeps time by the sound.
 * (Messages go without a transfer list: a transferred buffer arrives empty
 * in a utility process.)
 */

type RawFormat = 'I420' | 'NV12' | 'BGRA' | 'RGBA';

let preview: MessagePort | null = null;
let encoder: MessagePort | null = null;
/** Video out's port (x30): each frame raw, as the encoder gets it, when video out is on (src/main/video-out/). */
let videoOut: MessagePort | null = null;
let track: MediaStreamTrack | null = null;
/** Share the pending platform request while ports arrive before its track. */
let capturePending = false;
let size = { width: 1920, height: 1080 };
let previewBusy = false;
let lastPreview = 0;
let frames = 0;
let sentFormat = '';
/** Each capture has its own number: one replaced (a new size) stops handing frames on at once. */
let generation = 0;
/** The encoder port's frames so far, and whether a frame failed to go to it (each said once). */
let encoderFrames = 0;
let encoderFailed = false;
/**
 * The capture's newest frame (Session 18). A capture gives a frame only when the window paints, and a
 * still picture is not painted again: a capture already running for the preview gave an encoder paired
 * while the picture stood still (a still slide over the camera, between two sabhas) nothing at all, and
 * the stream never went on air. A new encoder now gets this frame at once; when there is none (a capture
 * just begun on a still picture), the page has the window paint until one comes (wantFrame).
 */
let latest: VideoFrame | null = null;
let nudging: ReturnType<typeof setInterval> | null = null;
/** Frames go to the encoder one after another, in order (the newest, given to a new encoder, first). */
let sending: Promise<void> = Promise.resolve();

/*
 * Whether the page's show is on screen yet (Session 58, h-black2: the lead's ruling on fault 2's measure). Until the page
 * has drawn the show and its frames have come on time since (program/main.tsx calls showOnScreen), the encoder is given
 * none of its frames: the stream starts, or carries on after its page started again, from the first frame that shows the
 * show, never the page's own black as it comes up (it loads, warms up, or lets a stopped warm-up go), nor the frame or two
 * before a picture just drawn is on screen. The worker starts FFmpeg on its first frame, and once going repeats its last
 * frame until a new one comes (stream/worker/pipeline.ts). A page whose show is not on screen SHOW_WAIT_MS after its
 * encoder came gives it its frames as they are (as before): never a stream without a picture for long.
 *
 * Why 15 s (Session 59): the longest a page takes to put its show on screen when nothing is wrong: its warm-up's cap
 * (render/WarmUp.tsx CAP_MS, 8 s), the warm-up's last step (SETTLE_MS, 6 s) and about a second for its frames to come
 * on time. Meanwhile a stream or recording that is starting sends nothing (no FFmpeg until the first frame), and one
 * whose page started again while on air repeats its last real frame, with the page's sound or silence: never black,
 * never nothing. Main's picture watch giving the page a new port meanwhile (at 5 s, then 10 s) never restarts the wait.
 */
let onScreen = false;
/** When the show came on screen, by this page's clock: a frame captured before then never goes to the encoder. */
let onScreenAt = Number.POSITIVE_INFINITY;
/** The show was not on screen in time: the encoder takes the page as it is. */
let waitedOut = false;
let showWait: ReturnType<typeof setTimeout> | null = null;
const SHOW_WAIT_MS = 15_000;
/** When the newest frame was captured, by this page's clock. */
let latestAt = 0;

/** Whether the encoder takes the page's frames now. */
const encoderTakes = (): boolean => onScreen || waitedOut;

/*
 * Video out (x30): the page's frames to other software, from this same capture, on a port of its own. It takes them as
 * the encoder does (once the show is on screen, or SHOW_WAIT_MS after its port came, waited for on its own), but never
 * holds the capture: a frame that comes while the one before is still on its way to video out is let go, never
 * queued, so the encoder's frames and the preview's are as they were.
 */
/** A frame on its way to video out. */
let videoOutBusy = false;
let videoOutFormat = '';
let videoOutFrames = 0;
let videoOutFailed = false;
/** The show was not on screen SHOW_WAIT_MS after video out's port came: it takes the page as it is. */
let videoOutWaited = false;
let videoOutWait: ReturnType<typeof setTimeout> | null = null;
const videoOutTakes = (): boolean => onScreen || videoOutWaited;

/**
 * Tests only (DRASHTI_TEST_STREAM_PROBE, never when packaged: windows/renderer.ts): the light of each frame given to the
 * encoder, kept in the page as it goes (`drashtiTestEncoderFrames`: when, by this page's clock, and its light, 0 black ..
 * 1 white), so a test reads what the stream sends (Session 58, h-black2).
 */
const probe =
  new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('streamProbe') === '1';

/** Tests only: keep the light of a frame given to the encoder (a small copy of it, averaged). */
async function probeFrame(frame: VideoFrame): Promise<void> {
  const W = 32;
  const H = 18;
  const bitmap = await createImageBitmap(frame, { resizeWidth: W, resizeHeight: H, resizeQuality: 'low' });
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const d = ctx.getImageData(0, 0, W, H).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0);
  const g = globalThis as unknown as { drashtiTestEncoderFrames?: { t: number; mean: number }[] };
  g.drashtiTestEncoderFrames ??= [];
  // eslint-disable-next-line no-restricted-properties -- tests only: when the encoder was given it, never a frame drawn
  g.drashtiTestEncoderFrames.push({ t: performance.now(), mean: sum / (W * H * 3 * 255) });
}

/**
 * What the capture does, for Drashti's log (Session 18: the stream that sometimes had no picture
 * after going on air again). The main process keeps the lines that start with "[program]".
 */
const say = (text: string) => {
  console.info(`[program] ${text}`);
};
const why = (error: unknown) =>
  cutText(error instanceof Error ? `${error.name}: ${error.message}` : String(error), 200);

const previewHeight = () => Math.round((PREVIEW_WIDTH * size.height) / size.width);

/** Change one unseen spot (a corner pixel, at most 1/255 darker), so the window paints the picture again. */
function nudge(): void {
  let spot = document.getElementById('capture-nudge');
  if (!spot) {
    spot = document.createElement('div');
    spot.id = 'capture-nudge';
    spot.setAttribute('aria-hidden', 'true');
    spot.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:2147483647;background:rgba(0,0,0,0)';
    document.body.appendChild(spot);
  }
  spot.dataset['on'] = spot.dataset['on'] === '1' ? '0' : '1';
  spot.style.background = spot.dataset['on'] === '1' ? 'rgba(0,0,0,0.004)' : 'rgba(0,0,0,0)';
}

/** Until the capture gives a frame, the window paints every 250 ms (a still picture gives none of itself). */
function wantFrame(): void {
  if (nudging || !track) return;
  const since = frames;
  nudge();
  // eslint-disable-next-line no-restricted-syntax -- capture's plumbing: a corner repainted (at most 1/255) until the capture gives its first frame
  nudging = setInterval(() => {
    if (frames === since && track) {
      nudge();
      return;
    }
    if (nudging) clearInterval(nudging);
    nudging = null;
  }, 250);
}

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

/** The layout to hand a frame over in: as it is when FFmpeg reads it, else converted to RGBA. */
function rawFormat(frame: VideoFrame): { format: RawFormat; convert: boolean } {
  switch (frame.format) {
    case 'I420':
    case 'NV12':
    case 'BGRA':
    case 'RGBA':
      return { format: frame.format, convert: false };
    case 'BGRX':
      return { format: 'BGRA', convert: false };
    case 'RGBX':
      return { format: 'RGBA', convert: false };
    default:
      return { format: 'RGBA', convert: true };
  }
}

/** One frame, raw, for the encoder. */
async function sendFrame(frame: VideoFrame): Promise<void> {
  const port = encoder;
  if (!port) return;
  const { format, convert } = rawFormat(frame);
  const rect = frame.visibleRect ?? { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight };
  const options: VideoFrameCopyToOptions = convert ? { format: 'RGBA', rect } : { rect };
  const data = new ArrayBuffer(frame.allocationSize(options));
  await frame.copyTo(data, options);
  const key = `${format}:${rect.width}x${rect.height}`;
  if (key !== sentFormat) {
    // The encoder starts again for it (Session 28: said, so the log shows what changed).
    if (sentFormat !== '') say(`the frames are now ${key} (they were ${sentFormat})`);
    sentFormat = key;
    port.postMessage({ kind: 'format', width: rect.width, height: rect.height, format });
  }
  port.postMessage({ kind: 'video', data });
  if (++encoderFrames === 1) say(`the first frame went to the encoder (${key})`);
  if (probe) await probeFrame(frame);
}

/** One frame, raw, for video out (as for the encoder): left unsent if video out stopped or changed meanwhile. */
async function sendVideoOut(frame: VideoFrame, port: MessagePort): Promise<void> {
  const { format, convert } = rawFormat(frame);
  const rect = frame.visibleRect ?? { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight };
  const options: VideoFrameCopyToOptions = convert ? { format: 'RGBA', rect } : { rect };
  const data = new ArrayBuffer(frame.allocationSize(options));
  await frame.copyTo(data, options);
  if (port !== videoOut) return;
  const key = `${format}:${rect.width}x${rect.height}`;
  if (key !== videoOutFormat) {
    videoOutFormat = key;
    port.postMessage({ kind: 'format', width: rect.width, height: rect.height, format });
  }
  port.postMessage({ kind: 'video', data });
  if (++videoOutFrames === 1) say(`the first frame went to video out (${key})`);
}

/** Give video out this frame (its own copy, closed here) unless one is still on its way: then it is let go. */
function toVideoOut(frame: VideoFrame): void {
  const port = videoOut;
  if (!port || videoOutBusy) {
    frame.close();
    return;
  }
  videoOutBusy = true;
  void sendVideoOut(frame, port)
    .catch((error: unknown) => {
      if (videoOutFailed) return;
      videoOutFailed = true;
      say(`a frame could not go to video out: ${why(error)}`);
    })
    .finally(() => {
      frame.close();
      videoOutBusy = false;
    });
}

function keepLatest(frame: VideoFrame | null): void {
  latest?.close();
  latest = frame;
}

/** Hand a frame to the encoder after those before it (the first that cannot go is said, once). */
function toEncoder(frame: VideoFrame): Promise<void> {
  const next = sending
    .then(() => sendFrame(frame))
    .catch((error: unknown) => {
      if (encoderFailed) return;
      encoderFailed = true;
      say(`a frame could not go to the encoder: ${why(error)}`);
    });
  sending = next;
  return next;
}

async function capture(): Promise<void> {
  const mine = ++generation;
  say(`capture ${String(mine)} asks for the picture (${String(size.width)}x${String(size.height)})`);
  // In turn with a capture of another app's window up as the background (Session 48): the main process
  // gives each request what this page asked for last, its own picture unless it asked for the window.
  const askingSize = { ...size };
  let display: MediaStream;
  capturePending = true;
  try {
    display = await inTurn(() =>
      navigator.mediaDevices.getDisplayMedia({
        video: { width: askingSize.width, height: askingSize.height, frameRate: 30 },
        audio: false,
      }),
    );
  } finally {
    capturePending = false;
  }
  const video = display.getVideoTracks()[0];
  if (!video) {
    say(`capture ${String(mine)} got no video track`);
    return;
  }
  if (mine !== generation || !wanted()) {
    say(`capture ${String(mine)} was replaced before it began`);
    video.stop();
    // A resize or a new consumer superseded this request while it opened. Acquire only that new request;
    // a failed acquisition above is never retried here.
    if (wanted() && !track) update();
    return;
  }
  track = video;
  const settings = video.getSettings();
  say(
    `capture ${String(mine)} began: ${String(settings.width)}x${String(settings.height)}, ${String(settings.frameRate)} fps, ${video.readyState}`,
  );
  video.addEventListener('ended', () => {
    say(`capture ${String(mine)}'s track ended`);
  });
  document.body.dataset['capture'] = 'on';
  const reader = new MediaStreamTrackProcessor({ track: video }).readable.getReader();
  // Its first frame, even when the picture stands still.
  wantFrame();
  let mineFrames = 0;
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done) break;
    if (++mineFrames === 1) say(`capture ${String(mine)}'s first frame`);
    if (mine !== generation) {
      // Replaced by a capture at another size: its frames are not handed on.
      frame.close();
      void reader.cancel();
      break;
    }
    keepLatest(frame.clone());
    frames++;
    document.body.dataset['frames'] = String(frames);
    // eslint-disable-next-line no-restricted-properties -- capture's plumbing: how often the operator's small preview of the stream is sent
    const now = performance.now();
    latestAt = now;
    if (preview && !previewBusy && now - lastPreview >= 1000 / PREVIEW_FPS) {
      previewBusy = true;
      lastPreview = now;
      const copy = frame.clone();
      void sendPreview(copy).finally(() => {
        copy.close();
        previewBusy = false;
      });
    }
    if (encoder && encoderTakes()) await toEncoder(frame);
    if (videoOut && videoOutTakes()) toVideoOut(frame.clone());
    frame.close();
  }
  if (mine === generation) {
    keepLatest(null);
    track = null;
    document.body.dataset['capture'] = 'off';
  }
  say(`capture ${String(mine)} ended after ${String(mineFrames)} frames`);
}

function wanted(): boolean {
  return preview !== null || encoder !== null || videoOut !== null;
}

function update(): void {
  if (wanted() && !track && !capturePending) {
    void capture().catch((error: unknown) => {
      say(`the capture failed: ${why(error)}`);
      track = null;
      document.body.dataset['capture'] = 'failed';
    });
  } else if (!wanted() && (track || capturePending)) {
    say('nothing wants the picture: the capture stops');
    generation++;
    keepLatest(null);
    track?.stop();
    track = null;
    document.body.dataset['capture'] = 'off';
  }
}

/**
 * A new encoder, or the show just on screen: the newest frame at once if it shows the show (a capture already running
 * gives no frame until the picture changes), else the window paints until one comes.
 */
function handOver(): void {
  if (!encoder) return;
  if (latest && (waitedOut || latestAt >= onScreenAt)) {
    const still = latest.clone();
    void toEncoder(still).finally(() => {
      still.close();
    });
  } else wantFrame();
}

/** Video out's port came, or the show is on screen: the newest frame at once if it shows the show, else a repaint. */
function handOverVideoOut(): void {
  if (!videoOut) return;
  if (latest && (videoOutWaited || latestAt >= onScreenAt)) toVideoOut(latest.clone());
  else wantFrame();
}

/** Video out waits for the show to be on screen, SHOW_WAIT_MS at most (then it takes the page as it is). */
function waitForShowVideoOut(): void {
  if (videoOutWait) return;
  say('video out waits for the show to be on screen');
  // eslint-disable-next-line no-restricted-syntax -- capture's plumbing: the longest video out waits for the show, never a frame drawn
  videoOutWait = setTimeout(() => {
    videoOutWait = null;
    if (onScreen || !videoOut) return;
    videoOutWaited = true;
    say(
      `the show was not on screen ${String(SHOW_WAIT_MS / 1000)} s after video out’s port came: it takes the page as it is`,
    );
    handOverVideoOut();
  }, SHOW_WAIT_MS);
}

/** The encoder waits for the show to be on screen, SHOW_WAIT_MS at most (then it takes the page as it is). */
function waitForShow(): void {
  if (showWait) return;
  say('the encoder waits for the show to be on screen');
  // eslint-disable-next-line no-restricted-syntax -- capture's plumbing: the longest the encoder waits for the show, never a frame drawn
  showWait = setTimeout(() => {
    showWait = null;
    if (onScreen || !encoder) return;
    waitedOut = true;
    say(
      `the show was not on screen ${String(SHOW_WAIT_MS / 1000)} s after the encoder came: it takes the page as it is`,
    );
    handOver();
  }, SHOW_WAIT_MS);
}

/** The page's show is on screen (program/main.tsx): the encoder takes its frames from now. */
export function showOnScreen(): void {
  if (onScreen) return;
  onScreen = true;
  // eslint-disable-next-line no-restricted-properties -- capture's plumbing: when the show came on screen, never a frame drawn
  onScreenAt = performance.now();
  if (showWait) {
    clearTimeout(showWait);
    showWait = null;
  }
  if (videoOutWait) {
    clearTimeout(videoOutWait);
    videoOutWait = null;
  }
  handOverVideoOut();
  if (!encoder) return;
  say('the show is on screen: the encoder takes the frames from now');
  handOver();
}

/** An unseen spot repainted (at most 1/255 darker), so the window draws a frame: for the page's frames on time. */
export function repaintUnseen(): void {
  nudge();
}

let meterPort: MessagePort | null = null;
let listening = false;

/** Start listening for ports from the main process (once, when the page starts). */
export function startCapture(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as { drashtiStreamPort?: string } | null;
    const port = event.ports[0];
    if (!port) return;
    if (data?.drashtiStreamPort === 'sound-meter') {
      meterPort?.close();
      meterPort = port;
      port.onmessage = (
        event: MessageEvent<{
          db: number;
          audio: string;
          bands: string;
          sound: SoundState;
        }>,
      ) => {
        const reading = event.data;
        document.body.dataset['level'] = String(Math.round(reading.db));
        document.body.dataset['audio'] = reading.audio;
        document.body.dataset['bands'] = reading.bands;
        useProgram.setState({ sound: reading.sound });
        preview?.postMessage({ kind: 'level', db: reading.db });
      };
      port.start();
      return;
    }
    if (data?.drashtiStreamPort === 'preview') {
      preview?.close();
      preview = port;
    } else if (data?.drashtiStreamPort === 'encoder') {
      say(
        `the encoder’s port arrived (${track ? 'capturing' : 'no capture yet'}${latest ? ': the newest frame goes at once' : ''})`,
      );
      encoder?.close();
      encoder = port;
      sentFormat = '';
      encoderFrames = 0;
      encoderFailed = false;
      // The picture as it stands, at once, once the show is on screen (else from then).
      if (encoderTakes()) handOver();
      else waitForShow();
    } else if (data?.drashtiStreamPort === 'video-out') {
      say(`video out’s port arrived (${track ? 'capturing' : 'no capture yet'})`);
      videoOut?.close();
      videoOut = port;
      videoOutFormat = '';
      videoOutFrames = 0;
      videoOutFailed = false;
      if (videoOutTakes()) handOverVideoOut();
      else waitForShowVideoOut();
    } else return;
    port.start();
    update();
  });
}

/** The preview is no longer watched. */
export function stopPreview(): void {
  preview?.close();
  preview = null;
  update();
}

/** Nothing is being encoded: frames and sound stop going to the worker. */
export function stopEncoder(): void {
  if (encoder) say('the encoder stops');
  encoder?.close();
  encoder = null;
  update();
}

/** Video out is off: frames stop going to its port (the capture stops when nothing else wants it). */
export function stopVideoOut(): void {
  if (!videoOut) return;
  say('video out stops');
  videoOut.close();
  videoOut = null;
  if (videoOutWait) {
    clearTimeout(videoOutWait);
    videoOutWait = null;
  }
  videoOutWaited = false;
  update();
}

/** The Program's size changed: capture again at the new size. */
export function setCaptureSize(next: { width: number; height: number }): void {
  if (next.width === size.width && next.height === size.height) return;
  size = next;
  if (capturePending) generation++;
  if (track) {
    generation++;
    keepLatest(null);
    track.stop();
    track = null;
    update();
  }
}
