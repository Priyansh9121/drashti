import { useEffect } from 'react';
import { useEngine } from '../engine/engine-store';
import { connectLooks, useLooks } from '../looks/looks-store';
import { cx } from '../ui/cx';
import { SwatchBook } from '../ui/icons';
import { Panel } from '../ui/Panel';
import { dispatch } from './actions';

/*
 * Looks, to switch the live one: every screen group changes at once (what
 * each shows is set in Screens). Pro Mode only; Simple Mode keeps the live
 * Look. The live Look's button is lit.
 */
export function LooksPanel() {
  const looks = useLooks((s) => s.view?.looks);
  const liveId = useEngine((s) => s.state?.look.id ?? '');
  useEffect(() => {
    connectLooks();
  }, []);
  return (
    <Panel
      help="looks"
      title="Looks"
      icon={SwatchBook}
      collapsible
      remember="looks"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="looks-panel"
    >
      <div role="group" aria-label="Switch the live Look" className="flex flex-wrap gap-1.5">
        {(looks ?? []).map((look) => {
          const live = look.id === liveId;
          return (
            <button
              key={look.id}
              type="button"
              aria-pressed={live}
              data-testid="look-button"
              data-look={look.id}
              onClick={() => {
                if (!live) void dispatch({ type: 'setLook', lookId: look.id });
              }}
              className={cx(
                'inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg border px-3 text-sm font-medium',
                live
                  ? 'border-live bg-live text-white'
                  : 'border-line-strong bg-panel-2 text-fg hover:bg-panel-3',
              )}
            >
              {live && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-white" />}
              <span className="truncate">{look.name}</span>
            </button>
          );
        })}
      </div>
      {looks?.length === 1 && (
        <p className="text-xs text-muted">Make more Looks in Screens: each says what every group shows.</p>
      )}
    </Panel>
  );
}
