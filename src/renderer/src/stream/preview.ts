import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import { watchProgram } from './stream-store';

/*
 * The Program's preview in the operator window: small JPEGs a few times a
 * second and the stream's sound level, straight from the stream's page on
 * a port the main process hands over (it never carries them itself). Each
 * frame is decoded off the page's main thread and drawn on a canvas, then let
 * go (Session 16): no image element and object URL for each frame, which
 * anything watching the page's loads (DevTools, the soak test's Playwright)
 * kept a copy of, four a second.
 */

export interface PreviewState {
  /** A frame has been drawn. */
  hasFrame: boolean;
  /** The sound level, followed by the meter itself (see LevelSource). */
  level: LevelSource;
}

/**
 * The stream's sound level as it changes, about ten times a second: the loudest point just now, dBFS (-100
 * for silence). The meter follows it through refs (Sessions 31–36, PERF-5a): kept as the panel's state, it
 * drew the whole Stream panel again at each report, 16 commits a second.
 */
export interface LevelSource {
  db(): number;
  /** Told of each change; the answer stops it. */
  listen(listener: (db: number) => void): () => void;
}

function levelSource(): LevelSource & { set(db: number): void } {
  let db = -100;
  const listeners = new Set<(db: number) => void>();
  return {
    db: () => db,
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      db = next;
      for (const listener of listeners) listener(next);
    },
  };
}

/** Watch the preview while mounted, drawing each frame on `canvas`. */
export function usePreview(canvas: RefObject<HTMLCanvasElement | null>): PreviewState {
  const [hasFrame, setHasFrame] = useState(false);
  const [level] = useState(levelSource);
  useEffect(() => {
    let port: MessagePort | null = null;
    let closed = false;
    let made = 0;
    let drawn = 0;
    const onPort = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { drashtiStreamPort?: string } | null;
      const next = event.ports[0];
      if (data?.drashtiStreamPort !== 'preview' || !next) return;
      port?.close();
      port = next;
      next.onmessage = (message: MessageEvent<{ kind: string; data?: ArrayBuffer; db?: number }>) => {
        const m = message.data;
        if (m.kind === 'frame' && m.data) {
          const n = ++made;
          void createImageBitmap(new Blob([m.data], { type: 'image/jpeg' })).then(
            (bitmap) => {
              const target = canvas.current;
              // Gone, or a later frame already drawn: let it go.
              if (closed || n < drawn || !target) {
                bitmap.close();
                return;
              }
              drawn = n;
              if (target.width !== bitmap.width) target.width = bitmap.width;
              if (target.height !== bitmap.height) target.height = bitmap.height;
              target.getContext('2d')?.drawImage(bitmap, 0, 0);
              bitmap.close();
              setHasFrame(true);
            },
            () => undefined,
          );
        } else if (m.kind === 'level' && typeof m.db === 'number') {
          // Like a mixer's meter: a peak shows at once and falls back at 20 dB a second (2 dB a report).
          const shown = Math.max(m.db, level.db() - 2);
          if (Math.abs(level.db() - shown) >= 0.5) level.set(shown);
        }
      };
      next.start();
    };
    window.addEventListener('message', onPort);
    const release = watchProgram();
    return () => {
      closed = true;
      window.removeEventListener('message', onPort);
      release();
      port?.close();
    };
  }, [canvas, level]);
  return { hasFrame, level };
}
