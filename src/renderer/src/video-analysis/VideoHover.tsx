import { useState } from 'react';
import { markerTime } from '../../../shared/markers';
import { STORY_FRAMES, storyFrame } from '../../../shared/video-analysis';
import { useAnalysis } from './use-analysis';

/** One JPEG strip, never a hidden video or a seek into a live player. */
export function VideoHover({ mediaId, name, active }: { mediaId: string; name: string; active: boolean }) {
  const [focused, setFocused] = useState(false);
  const [frame, setFrame] = useState(0);
  const { result, retry } = useAnalysis(mediaId, 0, active || focused);
  const analysis = result?.ok ? result.analysis : null;
  const duration = analysis?.durationMs ?? 0;
  const time = (frame / STORY_FRAMES) * duration;
  const words =
    result && !result.ok
      ? result.message
      : analysis?.state === 'ready'
        ? `Approximate frame at ${markerTime(time)}`
        : (analysis?.message ?? analysis?.note ?? 'Preview prepares while idle.');
  return (
    <div className="relative ml-2 shrink-0" data-testid="video-hover">
      <div
        tabIndex={0}
        role="slider"
        aria-label={`Browse frames of ${name}`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, duration / 1000)}
        aria-valuenow={time / 1000}
        aria-valuetext={words}
        title={words}
        className="h-9 w-16 rounded border border-line bg-panel-3 outline-offset-2"
        style={
          analysis?.storyboard
            ? {
                backgroundImage: `url("${analysis.storyboard}")`,
                backgroundSize: `${String(STORY_FRAMES * 100)}% 100%`,
                backgroundPosition: `${String((frame / (STORY_FRAMES - 1)) * 100)}% center`,
              }
            : undefined
        }
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (box.width > 0) setFrame(storyFrame((event.clientX - box.left) / box.width));
        }}
        onKeyDown={(event) => {
          const step =
            event.key === 'ArrowRight' || event.key === 'ArrowUp'
              ? 1
              : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                ? -1
                : 0;
          if (step || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            event.stopPropagation();
            setFrame((was) =>
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? STORY_FRAMES - 1
                  : Math.max(0, Math.min(STORY_FRAMES - 1, was + step)),
            );
          }
        }}
      />
      {(active || focused) && (analysis?.state === 'failed' || (result && !result.ok)) && (
        <button
          type="button"
          className="absolute inset-0 rounded bg-panel-2 text-xs text-danger-fg"
          onClick={retry}
          title={words}
        >
          Retry preview
        </button>
      )}
      <span className="sr-only" role="status">
        {active || focused ? words : ''}
      </span>
    </div>
  );
}
