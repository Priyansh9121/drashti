import { lowerThirdName, shownLines } from '../../../../shared/lower-thirds';
import { useEngine } from '../../engine/engine-store';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { api } from '../device';
import { tap } from '../taps';
import { useMirror } from './mirror-store';

/*
 * The operator window's More tools that run the show (Session 54, D5): the Lower Thirds, each shown and hidden
 * again with one button (Session 44). Making and changing them, and the MIDI controller, stay in Drashti. (The idle
 * rotation and the masks went in Session 55.)
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

export function MoreTools() {
  return (
    <>
      <LowerThirds />
    </>
  );
}
