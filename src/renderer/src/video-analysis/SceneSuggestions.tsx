import { useState } from 'react';
import type { MediaMarkers } from '../../../shared/markers';
import { markerTime } from '../../../shared/markers';
import { keepScene, type VideoAnalysis } from '../../../shared/video-analysis';
import { Button } from '../ui/Button';

/** Suggestions affect only the editor draft, including a row's own trim and named points. */
export function SceneSuggestions({
  analysis,
  points,
  onChange,
}: {
  analysis: VideoAnalysis | null;
  points: MediaMarkers;
  onChange: (points: MediaMarkers) => void;
}) {
  const [dropped, setDropped] = useState<number[]>([]);
  if (analysis?.state !== 'ready') return null;
  const suggestions = analysis.scenes.filter(
    (atMs) => !dropped.includes(atMs) && !points.markers.some((m) => m.atMs === atMs),
  );
  return (
    <section aria-label="Suggested scene markers" className="space-y-2" data-testid="scene-suggestions">
      <p className="text-xs text-muted">
        Scene changes are suggestions. Keep adds one to this draft; your saved markers stay as they are until
        Save.
      </p>
      {suggestions.length === 0 ? (
        <p className="text-xs text-muted">No scene suggestions remain.</p>
      ) : (
        <ul className="space-y-1">
          {suggestions.map((atMs) => (
            <li key={atMs} className="flex items-center gap-2 text-sm">
              <span className="flex-1 tabular-nums">Scene {markerTime(atMs)}</span>
              <Button
                type="button"
                size="sm"
                disabled={points.markers.length >= 50}
                onClick={() => onChange(keepScene(points, atMs, crypto.randomUUID()))}
                aria-label={`Keep scene at ${markerTime(atMs)}`}
              >
                Keep
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setDropped((was) => [...was, atMs])}
                aria-label={`Drop scene at ${markerTime(atMs)}`}
              >
                Drop
              </Button>
            </li>
          ))}
        </ul>
      )}
      {points.markers.length >= 50 && (
        <p className="text-xs text-muted">
          All 50 marker places are used. Remove a saved marker in Start, end and markers… before keeping
          another scene.
        </p>
      )}
    </section>
  );
}
