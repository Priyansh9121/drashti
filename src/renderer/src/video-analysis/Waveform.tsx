import type { VideoAnalysis } from '../../../shared/video-analysis';

/** The same full source-time axis as the trim handles; no audio element or decoder. */
export function Waveform({
  analysis,
  startMs = 0,
  endMs,
  playheadMs = 0,
}: {
  analysis: VideoAnalysis | null;
  startMs?: number;
  endMs?: number;
  playheadMs?: number;
}) {
  if (analysis?.state !== 'ready')
    return (
      <p role="status" className="text-xs text-muted">
        {analysis?.state === 'failed'
          ? analysis.message
          : (analysis?.note ?? 'Waveform is preparing; the time fields still work.')}
      </p>
    );
  const wave = analysis.waveform;
  if (!wave) return <p className="text-xs text-muted">No audio track.</p>;
  const at = (ms: number) => Math.min(100, Math.max(0, (ms / wave.durationMs) * 100));
  const path = wave.peaks
    .map(([low, high], i) => {
      const x = ((i + 0.5) * 1000) / wave.peaks.length;
      return `M${x.toFixed(2)},${String(32 - high * 30)}V${String(32 - low * 30)}`;
    })
    .join('');
  return (
    <div
      className="relative h-16 overflow-hidden rounded border border-line bg-panel-2"
      data-testid="timeline-waveform"
      role="img"
      aria-label="Sound waveform, aligned to the video’s source time"
    >
      <svg
        viewBox="0 0 1000 64"
        preserveAspectRatio="none"
        className="h-full w-full text-primary-hi"
        aria-hidden="true"
      >
        <path d={path} stroke="currentColor" fill="none" strokeWidth="1" />
      </svg>
      <span
        className="pointer-events-none absolute inset-y-0 left-0 bg-black/65"
        style={{ width: `${String(at(startMs))}%` }}
      />
      <span
        className="pointer-events-none absolute inset-y-0 right-0 bg-black/65"
        style={{ width: `${String(100 - at(endMs ?? wave.durationMs))}%` }}
      />
      <span
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary-hi"
        style={{ left: `${String(at(playheadMs))}%` }}
      />
    </div>
  );
}
