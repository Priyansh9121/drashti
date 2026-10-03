import { useEffect, useState } from 'react';
import { watchProgram } from './stream-store';

/*
 * The Program's preview in the operator window: small JPEGs a few times a
 * second and the stream's sound level, straight from the stream's page on
 * a port the main process hands over (it never carries them itself).
 */

export interface PreviewState {
  /** An object URL for the latest frame, or null before the first. */
  frame: string | null;
  /** The loudest point just now, dBFS (-100 for silence). */
  levelDb: number;
  /** When the last frame came (performance.now()). */
  at: number;
}

/** Watch the preview while mounted. */
export function usePreview(): PreviewState {
  const [state, setState] = useState<PreviewState>({ frame: null, levelDb: -100, at: 0 });
  useEffect(() => {
    let port: MessagePort | null = null;
    let url: string | null = null;
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
          const made = URL.createObjectURL(new Blob([m.data], { type: 'image/jpeg' }));
          const old = url;
          url = made;
          setState((s) => ({ ...s, frame: made, at: performance.now() }));
          if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
        } else if (m.kind === 'level' && typeof m.db === 'number') {
          // Like a mixer's meter: a peak shows at once and falls back at 20 dB a second (2 dB a report).
          const db = m.db;
          setState((s) => {
            const shown = Math.max(db, s.levelDb - 2);
            return Math.abs(s.levelDb - shown) < 0.5 ? s : { ...s, levelDb: shown };
          });
        }
      };
      next.start();
    };
    window.addEventListener('message', onPort);
    const release = watchProgram();
    return () => {
      window.removeEventListener('message', onPort);
      release();
      port?.close();
      if (url) URL.revokeObjectURL(url);
    };
  }, []);
  return state;
}
