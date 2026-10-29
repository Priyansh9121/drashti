import type { EngineState } from '../../../shared/engine/state';
import { formatDuration } from '../../../shared/format';
import { playbackLeftMs } from '../../../shared/media';
import type { Size } from '../../../shared/scaling';
import { inLastSeconds } from '../../../shared/wallpapers';
import { useNow } from './useNow';

/*
 * A video's last 10 seconds on the stage (Session 55, Part 6, E): every stage screen, whatever its layout, shows the
 * time left across its top in amber ("Video ends in 0:08"), so the kathakar and the anchor know the hall is about to
 * change. Nothing while no video is about to end (going round, paused with more left, its length not known yet, or
 * played out); Stage off shows the audience picture alone.
 */

/** The background video's time left (ms) while it is in its last seconds, else null. */
export function endsIn(state: EngineState, now: number): number | null {
  const bg = state.layers.background;
  if (bg?.kind !== 'media' || bg.media !== 'video' || bg.loop) return null;
  if (bg.durationMs === undefined || bg.durationMs <= 0) return null;
  const left = playbackLeftMs(bg, bg.durationMs, now);
  return inLastSeconds(left) ? left : null;
}

export function StageEndsIn({ state, canvas }: { state: EngineState; canvas: Size }) {
  const bg = state.layers.background;
  // Counted a few times a second only while a video plays that may end.
  const watching = bg?.kind === 'media' && bg.media === 'video' && !bg.loop;
  const now = useNow(watching ? 250 : 60_000);
  const left = endsIn(state, now);
  if (left === null) return null;
  const size = Math.round(canvas.height * 0.07);
  return (
    <div
      data-testid="stage-ends-in"
      role="status"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        padding: `${String(Math.round(size * 0.2))}px ${String(size)}px`,
        background: '#f59e0b',
        color: '#111111',
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1.2,
        textAlign: 'center',
        fontVariantNumeric: 'tabular-nums',
        zIndex: 5,
      }}
    >
      Video ends in {formatDuration(left, { roundUp: true })}
    </div>
  );
}
