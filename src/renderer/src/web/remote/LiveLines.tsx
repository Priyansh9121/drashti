import type { EngineState } from '../../../../shared/engine/state';
import { useNow } from '../../render/useNow';
import { Timer } from '../../ui/icons';

/*
 * LIVE's own lines under its picture (Session 54, D5), as the operator window's LIVE says them
 * (operator/LivePreview.tsx): a file missing behind the live slide (its background or its sound, Sessions 52 and
 * 53), and the slide moving on by itself with the time it has left and its bar. A font missing, a lower third's
 * line count and the languages line are about Drashti's computer and its screens, so they stay there.
 */

/** 0:07, 1:30. */
const formatSeconds = (s: number) => `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;

/** The slide moves on by itself: how long it has left, in words and as a bar. */
function TimeLeft({ count }: { count: { startedAt: number; durationMs: number } }) {
  const now = useNow(250);
  const left = Math.max(0, count.startedAt + count.durationMs - now);
  const seconds = Math.ceil(left / 1000);
  const done = Math.min(1, Math.max(0, 1 - left / count.durationMs));
  return (
    <div
      role="timer"
      data-testid="remote-auto-advance"
      data-left={seconds}
      aria-label={`Moves on by itself in ${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'}`}
      className="space-y-1"
    >
      <p className="flex items-center gap-1.5 text-base text-muted">
        <Timer size={18} aria-hidden="true" />
        Moves on by itself in <span className="font-bold text-fg tabular-nums">{formatSeconds(seconds)}</span>
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-3" aria-hidden="true">
        <div className="h-full bg-accent" style={{ width: `${String(done * 100)}%` }} />
      </div>
    </div>
  );
}

export function LiveLines({ state }: { state: EngineState | null }) {
  const slide = state?.layers.slide;
  const fileMissing = slide?.fileMissing ?? null;
  const soundMissing = slide?.soundMissing ?? null;
  const count = state?.autoAdvance ?? null;
  if (fileMissing === null && soundMissing === null && !count) return null;
  return (
    <div className="space-y-1" data-testid="remote-live-lines">
      {fileMissing !== null && (
        <p className="text-base text-warning-fg" data-testid="remote-file-missing">
          File missing: “{fileMissing}”. The background stays as it was.
        </p>
      )}
      {soundMissing !== null && (
        <p className="text-base text-warning-fg" data-testid="remote-sound-missing">
          File missing: “{soundMissing}”. The sound stays as it was.
        </p>
      )}
      {count && <TimeLeft count={count} />}
    </div>
  );
}
