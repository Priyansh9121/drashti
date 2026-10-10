import { useEffect } from 'react';
import { useEngine } from '../engine/engine-store';
import { connectMasks, openMasks, useMasks } from '../masks/masks-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Frame, Pencil } from '../ui/icons';
import { Panel } from '../ui/Panel';
import { dispatch } from './actions';

/*
 * The Masks layer: a mask from the library up on the audience screens (each
 * group's Look can leave the layer out), until it is taken down here, with
 * F7 or Clear all. Pro Mode only. A group's own mask (its screens' shape) is
 * set in Screens, in each Look, and is never cleared.
 */
export function MasksPanel() {
  const masks = useMasks((s) => s.masks);
  const up = useEngine((s) => s.state?.layers.masks ?? null);
  useEffect(() => {
    connectMasks();
  }, []);
  return (
    <Panel
      title="Masks"
      icon={Frame}
      collapsible
      remember="masks"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="masks-panel"
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={Pencil}
          onClick={() => {
            openMasks(up?.id ?? null);
          }}
        >
          Edit
        </Button>
      }
    >
      {masks && masks.length > 0 ? (
        <div
          role="group"
          aria-label="Put a mask up on the audience screens"
          className="flex flex-wrap gap-1.5"
        >
          {masks.map((mask) => {
            const on = up?.id === mask.id;
            return (
              <button
                key={mask.id}
                type="button"
                aria-pressed={on}
                data-testid="mask-button"
                onClick={() => {
                  void dispatch(on ? { type: 'clearLayer', layer: 'masks' } : { type: 'setMask', mask });
                }}
                className={cx(
                  'inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg border px-3 text-sm font-medium',
                  on
                    ? 'border-live bg-live text-white'
                    : 'border-line-strong bg-panel-2 text-fg hover:bg-panel-3',
                )}
              >
                {on && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-white" />}
                <span className="truncate">{mask.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted">
          No masks yet. <strong>Edit</strong> makes one: shapes that hide part of the screens, or show only
          what is inside them.
        </p>
      )}
    </Panel>
  );
}
