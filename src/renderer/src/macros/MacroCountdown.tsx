import { useEffect } from 'react';
import { create } from 'zustand';
import type { MacroCountdownView } from '../../../shared/macros';
import { useNow } from '../render/useNow';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Clock } from '../ui/icons';

/*
 * A macro about to run by itself at its time (Session 14): a strip under
 * the header (Pro Mode) or above the big buttons (Simple Mode), counting
 * down ten seconds, with Cancel. In Simple Mode a volunteer can stop it,
 * and change nothing else.
 */

const useCountdown = create<{ view: MacroCountdownView }>(() => ({ view: { countdowns: [] } }));

let connected = false;

function connectCountdown(): void {
  if (connected) return;
  connected = true;
  window.drashti.macros.onCountdown((view) => {
    useCountdown.setState({ view });
  });
  void window.drashti.macros.countdown().then((view) => {
    useCountdown.setState({ view });
  });
}

export function MacroCountdown({ big = false }: { big?: boolean }) {
  const countdowns = useCountdown((s) => s.view.countdowns);
  useEffect(() => {
    connectCountdown();
  }, []);
  const now = useNow(250);
  const first = countdowns[0];
  if (!first) return null;
  const seconds = Math.max(0, Math.ceil((first.runAt - now) / 1000));
  return (
    <section
      aria-label="A macro runs by itself"
      data-testid="macro-countdown"
      className={cx(
        'flex shrink-0 items-center border-accent/60 bg-panel-3 text-fg',
        big ? 'gap-3 border-t p-3' : 'gap-3 border-b px-4 py-2 text-sm',
      )}
    >
      <Clock size={big ? 32 : 18} aria-hidden="true" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p role="status" className={cx('font-medium', big && 'text-xl font-bold')}>
          {`The macro “${first.name}” runs by itself in ten seconds, as its schedule says.`}
          {countdowns.length > 1 ? ` (${String(countdowns.length - 1)} more after it.)` : ''}
        </p>
        <p aria-hidden="true" className={cx('font-bold tabular-nums', big ? 'text-3xl' : 'text-base')}>
          {`In ${String(seconds)}`}
        </p>
      </div>
      <Button
        size={big ? 'xl' : 'md'}
        variant="secondary"
        data-testid="macro-countdown-cancel"
        onClick={() => void window.drashti.macros.cancelScheduled(first.key)}
      >
        Cancel
      </Button>
    </section>
  );
}
