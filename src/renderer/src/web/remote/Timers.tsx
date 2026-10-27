import { TIMER_KIND_NAMES, type TimerState } from '../../../../shared/timers';
import { useEngine } from '../../engine/engine-store';
import { TimerText } from '../../render/TimerText';
import { Button } from '../../ui/Button';
import { Monitor, Pause, Play, RotateCcw, Square } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';

/*
 * The timers, as the operator window's Timers panel has them (Session 26a; Session 54, D5): running ones first,
 * each its name and time, then Start, or Pause (Stop for a clock or a countdown to a time, which starts again from
 * the time of day), Reset for a countdown and a count-up, and Show on the screens (Session 50), which puts the timer
 * up alone in the slide's place, in LIVE's red while it is up ("Take off the screens"). Making, changing and
 * deleting a timer stay in Drashti (the library). A3's stage layout timer is in the Stage screen section.
 */

const post = (path: string) => () => api<{ rev?: number }>(path, { method: 'POST' });

const NO_TIMERS: TimerState[] = [];

function TimerRow({ timer, shown }: { timer: TimerState; shown: boolean }) {
  const running = timer.startedAt !== null;
  const counts = timer.kind === 'countdown' || timer.kind === 'countup';
  const id = encodeURIComponent(timer.id);
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2"
      data-testid="remote-timer"
      data-timer-id={timer.id}
      data-running={running ? 'true' : undefined}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base text-fg">
          {timer.name}
          <span className="sr-only">, {TIMER_KIND_NAMES[timer.kind]}</span>
        </span>
        <span className="block font-mono text-2xl text-fg">
          <TimerText timer={timer} />
        </span>
      </span>
      {running ? (
        <Button
          size="lg"
          className="min-h-12"
          icon={counts ? Pause : Square}
          onClick={() => void tap(post(`/api/v1/timers/${id}/${counts ? 'pause' : 'reset'}`))}
        >
          {counts ? 'Pause' : 'Stop'}
        </Button>
      ) : (
        <Button
          size="lg"
          className="min-h-12"
          icon={Play}
          onClick={() => void tap(post(`/api/v1/timers/${id}/start`))}
        >
          Start
        </Button>
      )}
      {counts && (
        <Button
          size="lg"
          className="min-h-12"
          icon={RotateCcw}
          onClick={() => void tap(post(`/api/v1/timers/${id}/reset`))}
        >
          Reset
        </Button>
      )}
      {/* Up alone on the screens (Session 50): again, or Clear slide, takes it off. */}
      <Button
        size="lg"
        className="min-h-12"
        icon={Monitor}
        variant={shown ? 'live' : 'secondary'}
        data-testid="remote-timer-show"
        onClick={() => void tap(post(shown ? '/api/v1/clear/slide' : `/api/v1/timers/${id}/show`))}
      >
        {shown ? 'Take off the screens' : 'Show on the screens'}
      </Button>
    </li>
  );
}

export function Timers() {
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  // The timer up alone on the screens, if one is (Session 50).
  const alone = useEngine((s) => s.state?.layers.slide?.timer?.timerId ?? null);
  return (
    <section className="space-y-2" aria-labelledby="timers-title" data-testid="remote-timers">
      <h2 id="timers-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Timers
      </h2>
      {timers.length === 0 ? (
        <p className="text-base text-muted">
          There are no timers yet: they are made in Drashti on the computer, under Timers in Pro Mode.
        </p>
      ) : (
        <ul className="space-y-2">
          {/* Running timers first (Session 26a), the rest in their order. */}
          {[...timers.filter((t) => t.startedAt !== null), ...timers.filter((t) => t.startedAt === null)].map(
            (t) => (
              <TimerRow key={t.id} timer={t} shown={alone === t.id} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}
