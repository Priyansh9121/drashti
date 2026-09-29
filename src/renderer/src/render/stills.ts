import { useSyncExternalStore } from 'react';
import { mediaUrl, STILL_WIDTH } from '../../../shared/media';

/*
 * Still frames for video thumbnails: thumbnails never play video. The main
 * process keeps one still per file. When a thumbnail finds none, this window
 * makes it (a canvas draws one frame of the real file), once, and hands it to
 * the main process, which keeps it for next time.
 */

export interface StillState {
  /** Bumped when a still has just been made, so thumbnails load it again. */
  version: number;
  /** No still could be made (the file is missing, or cannot be played). */
  failed: boolean;
}

const IDLE: StillState = { version: 0, failed: false };
const states = new Map<string, StillState>();
const listeners = new Set<() => void>();
const queue: string[] = [];
/** Videos a still was asked for while Drashti runs (made, being made, or failed). */
const asked = new Set<string>();
let busy = false;
let made = 0;

function set(mediaId: string, state: StillState): void {
  states.set(mediaId, state);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The still for a video, as thumbnails should load it. */
export function useStill(mediaId: string): StillState {
  return useSyncExternalStore(subscribe, () => states.get(mediaId) ?? IDLE);
}

function once(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      target.removeEventListener(event, done);
      reject(new Error(target.error?.message ?? 'cannot play'));
    };
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

/** One frame of the video (a tenth of the way in, at most 2 s: the first frame is often black), as a JPEG. */
async function drawStill(mediaId: string): Promise<Uint8Array> {
  const v = document.createElement('video');
  // CORS, so the canvas can be read back (the media scheme allows it for Drashti's pages).
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.preload = 'auto';
  v.src = mediaUrl(mediaId);
  try {
    await once(v, 'loadedmetadata');
    const at = Number.isFinite(v.duration) ? Math.min(v.duration * 0.1, 2) : 0;
    if (at > 0.01) {
      v.currentTime = at;
      await once(v, 'seeked');
    }
    if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await once(v, 'loadeddata');
    const width = Math.max(1, Math.min(STILL_WIDTH, v.videoWidth));
    const height = Math.max(1, Math.round((width * v.videoHeight) / Math.max(1, v.videoWidth)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(v, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82);
    });
    if (!blob) throw new Error('no still');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms));
}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  for (let mediaId = queue.shift(); mediaId !== undefined; mediaId = queue.shift()) {
    try {
      const jpeg = await Promise.race([drawStill(mediaId), timeout(20_000)]);
      const saved = await window.drashti.media.saveStill(mediaId, jpeg);
      set(mediaId, saved.ok ? { version: ++made, failed: false } : { version: 0, failed: true });
    } catch {
      set(mediaId, { version: 0, failed: true });
    }
  }
  busy = false;
}

/** A thumbnail found no still for this video: make one (at most once per file while Drashti runs). */
export function requestStill(mediaId: string): void {
  if (asked.has(mediaId)) return;
  asked.add(mediaId);
  queue.push(mediaId);
  void drain();
}
