import type { PropItem } from '../../../../shared/engine/state';
import { useEngine } from '../../engine/engine-store';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { api } from '../device';
import { tap } from '../taps';
import { useMirror } from './mirror-store';

/*
 * Props (Session 54, D5), as the operator window's Props panel has them: each prop by name, the logo marked, Show
 * puts it up over whatever is on the screens and Hide takes it off (Clear props, F4, takes them all off). A prop
 * goes up by its id, as Drashti reads it from the library; making, deleting and marking the logo stay in Drashti.
 */

const NO_PROPS: PropItem[] = [];

const post = (path: string) => () => api<{ rev?: number }>(path, { method: 'POST' });

export function Props() {
  const props = useMirror((s) => s.props);
  const shown = useEngine((s) => s.state?.layers.props) ?? NO_PROPS;
  return (
    <section className="space-y-2" aria-labelledby="props-title" data-testid="remote-props">
      <h2 id="props-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Props
      </h2>
      {props === null ? (
        <p role="status" className="text-base text-muted">
          Loading the props…
        </p>
      ) : props.length === 0 ? (
        <p className="text-base text-muted">
          There are no props yet: they are made in Drashti on the computer, under Props in Pro Mode.
        </p>
      ) : (
        <ul className="space-y-2">
          {props.map((p) => {
            const up = shown.some((s) => s.id === p.id);
            const id = encodeURIComponent(p.id);
            return (
              <li
                key={p.id}
                data-testid="remote-prop"
                data-shown={up ? 'true' : undefined}
                className={cx(
                  'flex items-center gap-2 rounded-lg border bg-panel-2 py-1 pr-1 pl-3',
                  up ? 'border-live' : 'border-line',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-base text-fg">
                  {p.imported ? `${p.name} (imported)` : p.name}
                </span>
                {p.logo && <Badge tone="info">Logo</Badge>}
                <Button
                  size="lg"
                  className="min-h-12"
                  instant
                  variant={up ? 'live' : 'secondary'}
                  onClick={() => void tap(post(`/api/v1/props/${id}/${up ? 'hide' : 'show'}`))}
                >
                  {up ? 'Hide' : 'Show'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
