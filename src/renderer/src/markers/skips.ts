import type { EngineState } from '../../../shared/engine/state';

/**
 * Back 15 s, Forward 15 s and Last 10 s (Session 50) for one place: 'ready', 'waiting' while the file's
 * length is not known yet (a moment after it starts: they are dimmed), or null where there are none.
 */
export type SkipsShown = 'ready' | 'waiting' | null;

/**
 * The skip buttons a place shows: under the live picture, the background video's ('background') and a single
 * sound's ('sound'); in the Music panel, beside Play and Pause, an audio playlist's track's ('music'). A
 * picture, a colour, a window or a video input has none.
 */
export function skipsOf(
  state: EngineState | null | undefined,
  place: 'background' | 'sound' | 'music',
): SkipsShown {
  const layers = state?.layers;
  if (place === 'background') {
    const bg = layers?.background;
    if (bg?.kind !== 'media' || bg.media !== 'video') return null;
    return bg.durationMs === undefined ? 'waiting' : 'ready';
  }
  const a = layers?.audio;
  if (!a?.mediaId || (place === 'music') !== (a.music !== undefined)) return null;
  return a.durationMs === undefined ? 'waiting' : 'ready';
}
