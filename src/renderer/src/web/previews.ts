import type { PreviewLoader } from '../render/previews';
import { current } from './device';

/*
 * Media previews for a phone or tablet: fetched with this device's token
 * (an <img> cannot send one), three at a time so a slow phone is never
 * swamped, kept for the page's life. One that cannot be had now (FFmpeg is
 * busy making it) is tried again a little later.
 */

const AT_ONCE = 3;
const RETRY_MS = 15_000;

export function networkPreviews(): PreviewLoader {
  const loaded = new Map<string, string | null>();
  const pending = new Map<string, Promise<string | null>>();
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

  const fetchPreview = async (mediaId: string): Promise<string | null> => {
    const token = current()?.token;
    try {
      const r = await fetch(`/api/v1/media/${encodeURIComponent(mediaId)}/preview`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return null;
      return URL.createObjectURL(await r.blob());
    } catch {
      return null;
    }
  };

  return {
    cached: (mediaId) => loaded.get(mediaId),
    load: (mediaId) => {
      const known = loaded.get(mediaId);
      if (known) return Promise.resolve(known);
      const already = pending.get(mediaId);
      if (already) return already;
      const p = slot(() => fetchPreview(mediaId)).then((url) => {
        pending.delete(mediaId);
        if (url) loaded.set(mediaId, url);
        else
          setTimeout(() => {
            loaded.delete(mediaId);
          }, RETRY_MS);
        return url;
      });
      pending.set(mediaId, p);
      return p;
    },
  };
}
