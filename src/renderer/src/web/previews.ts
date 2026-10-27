import { PICTURE_WIDTHS, pictureStep } from '../../../shared/device-pictures';
import type { PreviewLoader } from '../render/previews';
import { current } from './device';

/*
 * Pictures for a phone or tablet. Since Session 54 (D1) each is fetched at the width the page draws it (a step of
 * PICTURE_WIDTHS), up to the original, never the 320-pixel preview alone: sharp on the device's screen, a
 * thumbnail small, the picture zoomed on the phone large. Each is fetched with this device's token (an <img>
 * cannot send one), three at a time so a slow phone is never swamped. The sharpest had of each picture is the one
 * every place draws: a smaller one is let go once a sharper one has come, and the least recently used go when
 * they come to more than a phone should hold, never one a place is drawing. One that cannot be had now (FFmpeg is
 * busy making it) is tried again a little later, the one had so far staying.
 */

const AT_ONCE = 3;
const RETRY_MS = 15_000;
/** Most kept in the page at once, all the pictures' files together (more than any one screen draws). */
export const KEEP_BYTES = 80 * 1024 * 1024;
/** A smaller copy goes this long after a sharper one came, once every place has moved on to it. */
const LET_GO_MS = 10_000;

export type PictureFetch = (mediaId: string, step: number) => Promise<{ blob: Blob } | null>;

export interface DevicePictureDeps {
  fetchPicture: PictureFetch;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  now: () => number;
  later: (run: () => void, ms: number) => void;
  /** The most kept at once (KEEP_BYTES unless given). */
  keepBytes?: number;
}

interface Kept {
  url: string;
  step: number;
  /** No wider one is there: the picture is narrower than the step asked. */
  whole: boolean;
  bytes: number;
  used: number;
}

/** The pictures of a page, kept as their sharpest. Its parts are given so the tests can stand in for them. */
export function devicePictures(deps: DevicePictureDeps): PreviewLoader {
  const keepBytes = deps.keepBytes ?? KEEP_BYTES;
  const kept = new Map<string, Kept>();
  const pending = new Map<string, Promise<string | null>>();
  const retryAt = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  const holds = new Map<string, number>();
  let active = 0;
  const waiting: (() => void)[] = [];

  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    while (active >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };

  const tell = (mediaId: string) => {
    for (const then of listeners.get(mediaId) ?? []) then();
  };

  /** Over what a phone should hold: the least recently used go, never one drawn now. */
  const trim = () => {
    let total = 0;
    for (const k of kept.values()) total += k.bytes;
    if (total <= keepBytes) return;
    const idle = [...kept.entries()]
      .filter(([id]) => (holds.get(id) ?? 0) === 0)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [id, k] of idle) {
      if (total <= keepBytes) break;
      kept.delete(id);
      total -= k.bytes;
      deps.revokeUrl(k.url);
    }
  };

  const fetchStep = async (mediaId: string, step: number): Promise<string | null> => {
    const got = await slot(() => deps.fetchPicture(mediaId, step).catch(() => null));
    const best = kept.get(mediaId);
    if (!got) {
      retryAt.set(`${mediaId}@${String(step)}`, deps.now() + RETRY_MS);
      return best?.url ?? null;
    }
    // A sharper one came meanwhile (another place asked wider): that one stays.
    if (best && best.step >= step) return best.url;
    const url = deps.createUrl(got.blob);
    kept.set(mediaId, { url, step, whole: false, bytes: got.blob.size, used: deps.now() });
    if (best)
      deps.later(() => {
        deps.revokeUrl(best.url);
      }, LET_GO_MS);
    tell(mediaId);
    trim();
    return url;
  };

  return {
    cached: (mediaId) => kept.get(mediaId)?.url,
    load: (mediaId, width) => {
      const step = pictureStep(width ?? PICTURE_WIDTHS[0]);
      const best = kept.get(mediaId);
      if (best && (best.step >= step || best.whole)) {
        best.used = deps.now();
        return Promise.resolve(best.url);
      }
      const key = `${mediaId}@${String(step)}`;
      const already = pending.get(key);
      if (already) return already;
      if ((retryAt.get(key) ?? 0) > deps.now()) return Promise.resolve(best?.url ?? null);
      const p = fetchStep(mediaId, step).finally(() => pending.delete(key));
      pending.set(key, p);
      return p;
    },
    subscribe: (mediaId, then) => {
      let set = listeners.get(mediaId);
      if (!set) {
        set = new Set();
        listeners.set(mediaId, set);
      }
      set.add(then);
      return () => {
        set.delete(then);
        if (set.size === 0) listeners.delete(mediaId);
      };
    },
    hold: (mediaId) => {
      holds.set(mediaId, (holds.get(mediaId) ?? 0) + 1);
      return () => {
        const left = (holds.get(mediaId) ?? 1) - 1;
        if (left > 0) holds.set(mediaId, left);
        else holds.delete(mediaId);
      };
    },
    measured: (mediaId, url, naturalWidth) => {
      const k = kept.get(mediaId);
      // Narrower than the step it was asked at: the whole picture, so no wider is asked for again.
      if (k?.url === url && naturalWidth > 0 && naturalWidth < k.step) k.whole = true;
    },
  };
}

/** The pictures of a phone's or tablet's page, from Drashti over the network. */
export function networkPreviews(): PreviewLoader {
  return devicePictures({
    fetchPicture: async (mediaId, step) => {
      const token = current()?.token;
      try {
        const r = await fetch(`/api/v1/media/${encodeURIComponent(mediaId)}/picture?width=${String(step)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        return r.ok ? { blob: await r.blob() } : null;
      } catch {
        return null;
      }
    },
    createUrl: (blob) => URL.createObjectURL(blob),
    revokeUrl: (url) => {
      URL.revokeObjectURL(url);
    },
    now: () => Date.now(),
    later: (run, ms) => {
      setTimeout(run, ms);
    },
  });
}
