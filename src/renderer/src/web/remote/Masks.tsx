import { useEngine } from '../../engine/engine-store';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { api } from '../device';
import { tap } from '../taps';
import { useMirror } from './mirror-store';

/*
 * Masks (Session 54, the phone as a full Drashti), as the operator window's Masks puts them up: each of the
 * library's masks by name, the one up marked; Show puts it up on the audience screens (by its id, as Drashti reads it
 * from the library) and Take off takes it off, as Clear masks (F8) does. Making and changing masks stay in Drashti.
 */

const post = (path: string) => () => api<{ rev?: number }>(path, { method: 'POST' });

export function Masks() {
  const masks = useMirror((s) => s.masks);
  const up = useEngine((s) => s.state?.layers.masks?.id ?? null);
  return (
    <section className="space-y-2" aria-labelledby="masks-title" data-testid="remote-masks">
      <h2 id="masks-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Masks
      </h2>
      {masks === null ? (
        <p role="status" className="text-base text-muted">
          Loading the masks…
        </p>
      ) : masks.length === 0 ? (
        <p className="text-base text-muted">
          There are no masks yet: they are made in Drashti on the computer, under Masks in Pro Mode.
        </p>
      ) : (
        <ul className="space-y-2">
          {masks.map((m) => {
            const shown = m.id === up;
            return (
              <li
                key={m.id}
                data-testid="remote-mask"
                data-mask-id={m.id}
                data-shown={shown ? 'true' : undefined}
                className={cx(
                  'flex items-center gap-2 rounded-lg border bg-panel-2 py-1 pr-1 pl-3',
                  shown ? 'border-live' : 'border-line',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-base text-fg">{m.name}</span>
                <Button
                  size="lg"
                  className="min-h-12"
                  instant
                  variant={shown ? 'live' : 'secondary'}
                  data-testid="remote-mask-toggle"
                  onClick={() =>
                    void tap(
                      post(shown ? '/api/v1/clear/masks' : `/api/v1/masks/${encodeURIComponent(m.id)}/show`),
                    )
                  }
                >
                  {shown ? 'Take off' : 'Show'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
