import { lowerThirdName, shownLines } from '../../../../shared/lower-thirds';
import { useEngine } from '../../engine/engine-store';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Play, Square } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';
import { useMirror } from './mirror-store';

/*
 * The operator window's More tools that run the show (Session 54, D5): the Lower Thirds, each shown and hidden
 * again with one button (Session 44), and the idle rotation started and stopped. Making and changing them, the
 * masks (shaped to the hall, and set up in Drashti: a phone takes one down with Clear masks, F8) and the MIDI
 * controller stay in Drashti.
 */

const post = (path: string) => () => api<{ rev?: number }>(path, { method: 'POST' });

function LowerThirds() {
  const list = useMirror((s) => s.lowerThirds);
  const upId = useEngine((s) => s.state?.layers.lowerThird?.id ?? null);
  // None yet: nothing to show here (the desktop's More tools say how one is made).
  if (!list || list.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="lower-thirds-title" data-testid="remote-lower-thirds">
      <h2 id="lower-thirds-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Lower thirds
      </h2>
      <ul className="space-y-2">
        {list.map((lt) => {
          const up = lt.id === upId;
          const rest = shownLines(lt.lines).slice(1).join(' · ');
          return (
            <li
              key={lt.id}
              data-testid="remote-lower-third"
              data-up={up ? 'true' : undefined}
              className={cx(
                'flex items-center gap-2 rounded-lg border bg-panel-2 py-1 pr-1 pl-3',
                up ? 'border-live' : 'border-line',
              )}
            >
              <span className="min-w-0 flex-1" translate="no">
                <span className="block truncate text-base text-fg">{lowerThirdName(lt.lines)}</span>
                {rest && <span className="block truncate text-base text-muted">{rest}</span>}
              </span>
              <Button
                size="lg"
                className="min-h-12"
                instant
                variant={up ? 'live' : 'secondary'}
                onClick={() =>
                  void tap(
                    post(
                      up
                        ? '/api/v1/lower-thirds/hide'
                        : `/api/v1/lower-thirds/${encodeURIComponent(lt.id)}/show`,
                    ),
                  )
                }
              >
                {up ? 'Hide' : 'Show'}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The idle rotation: Start (with something to show) and Stop; it stops by itself when a slide or picture goes up. */
function Idle() {
  const running = useEngine((s) => s.state?.idle.startedAt != null);
  const items = useEngine((s) => s.state?.idle.items.length ?? 0);
  if (!running && items === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="idle-title" data-testid="remote-idle">
      <h2 id="idle-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Idle rotation
      </h2>
      <p className="text-base text-muted">Pictures and quotes while nothing else is up.</p>
      {running ? (
        <Button
          size="lg"
          className="min-h-12"
          instant
          variant="live"
          icon={Square}
          data-testid="remote-idle-stop"
          onClick={() => void tap(post('/api/v1/idle/stop'))}
        >
          Stop the idle rotation
        </Button>
      ) : (
        <Button
          size="lg"
          className="min-h-12"
          instant
          icon={Play}
          data-testid="remote-idle-start"
          onClick={() => void tap(post('/api/v1/idle/start'))}
        >
          Start the idle rotation
        </Button>
      )}
    </section>
  );
}

export function MoreTools() {
  return (
    <>
      <LowerThirds />
      <Idle />
    </>
  );
}
