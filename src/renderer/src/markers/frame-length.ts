import { useEffect, useState } from 'react';

/*
 * A video's frame length for the time bar's ⋯ (alpha.20: One frame back and on, and Alt with the arrows), from Media
 * information's reading of its file (its frame rate), asked once for each file and kept for the session.
 */

/** A frame's length (ms) from a frame rate, within what the engine takes (1/120 s to 1/10 s); null for none. */
export function frameMsOf(fps: number | null | undefined): number | null {
  if (fps === null || fps === undefined || !Number.isFinite(fps) || fps <= 0) return null;
  const ms = 1000 / fps;
  return ms >= 1000 / 120 && ms <= 100 ? ms : null;
}

const known = new Map<string, number>();

/** The frame length of a video (ms): null until it is known, for a file that says none, or with no file asked. */
export function useFrameMs(mediaId: string | null): number | null {
  const [found, setFound] = useState<{ id: string; ms: number | null } | null>(null);
  useEffect(() => {
    if (mediaId === null || known.has(mediaId)) return;
    let live = true;
    void window.drashti.media.details(mediaId).then(
      (result) => {
        const ms = frameMsOf(result.ok ? result.details.read?.pictures[0]?.fps : null);
        if (ms !== null) known.set(mediaId, ms);
        if (live) setFound({ id: mediaId, ms });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [mediaId]);
  if (mediaId === null) return null;
  return known.get(mediaId) ?? (found?.id === mediaId ? found.ms : null);
}
