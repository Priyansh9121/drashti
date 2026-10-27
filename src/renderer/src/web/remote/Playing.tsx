import type { PlaybackMarker } from '../../../../shared/markers';
import { type SkipsShown, skipsOf } from '../../markers/skips';
import { useEngine } from '../../engine/engine-store';
import { Button } from '../../ui/Button';
import { ArrowRightToLine, Bookmark, RotateCcw, RotateCw, type Icon } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';

/*
 * What is playing, under LIVE, as the operator window has it under Next and Back (MarkerJumps, Session 50): for the
 * background video and for a sound, Back 15 s, Forward 15 s and Last 10 s, then a jump to each of its file's markers
 * (Session 14). Each moves every screen, the nodes and the stream in step (the engine's skip and jump, which keep to
 * the file's start and end points); the skips are dimmed until Drashti knows the file's length, a moment after it
 * starts. Session 54 (D5): until then the phone had the markers only, under More. An audio playlist's track has its
 * own in Music on the desktop; here Music has Previous and Next track. B2's time bar goes above this, under LIVE's
 * picture.
 */

const SKIPS: { jump: 'back' | 'forward' | 'last'; label: string; icon: Icon }[] = [
  { jump: 'back', label: 'Back 15 s', icon: RotateCcw },
  { jump: 'forward', label: 'Forward 15 s', icon: RotateCw },
  { jump: 'last', label: 'Last 10 s', icon: ArrowRightToLine },
];

/** None, as one array (a selector answering a new one each time would never settle). */
const NO_MARKS: PlaybackMarker[] = [];

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

function Row({
  layer,
  skips,
  marks,
}: {
  layer: 'background' | 'audio';
  skips: SkipsShown;
  marks: PlaybackMarker[];
}) {
  const what = layer === 'audio' ? 'sound' : 'background';
  return (
    <div
      role="group"
      aria-label={layer === 'audio' ? 'The sound playing' : 'The background video'}
      className="flex flex-wrap items-center gap-2"
      data-testid={layer === 'audio' ? 'remote-playing-sound' : 'remote-playing-background'}
    >
      <span className="text-base text-muted">{layer === 'audio' ? 'Sound:' : 'Background:'}</span>
      {skips &&
        SKIPS.map((s) => (
          <Button
            key={s.jump}
            size="lg"
            icon={s.icon}
            disabled={skips !== 'ready'}
            data-testid={`remote-skip-${what}-${s.jump}`}
            onClick={() => void tap(post('/api/v1/skip', { layer, jump: s.jump }))}
          >
            {s.label}
          </Button>
        ))}
      {marks.map((m) => (
        <Button
          key={m.id}
          size="lg"
          icon={Bookmark}
          data-testid="remote-marker"
          onClick={() => void tap(post(`/api/v1/markers/${encodeURIComponent(m.id)}/jump`, { layer }))}
        >
          {m.name}
          {layer === 'audio' ? ' (sound)' : ''}
        </Button>
      ))}
    </div>
  );
}

export function Playing() {
  const bgMarks = useEngine((s) => {
    const b = s.state?.layers.background;
    return b?.kind === 'media' ? (b.marks ?? NO_MARKS) : NO_MARKS;
  });
  const audioMarks = useEngine((s) => s.state?.layers.audio?.marks ?? NO_MARKS);
  const bgSkips = useEngine((s) => skipsOf(s.state, 'background'));
  const soundSkips = useEngine((s) => skipsOf(s.state, 'sound'));
  const bg = bgSkips !== null || bgMarks.length > 0;
  const sound = soundSkips !== null || audioMarks.length > 0;
  if (!bg && !sound) return null;
  return (
    <section className="space-y-2" aria-labelledby="playing-title" data-testid="remote-playing">
      <h2 id="playing-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Playing
      </h2>
      {bg && <Row layer="background" skips={bgSkips} marks={bgMarks} />}
      {sound && <Row layer="audio" skips={soundSkips} marks={audioMarks} />}
    </section>
  );
}
