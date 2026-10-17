import { useEffect, useState } from 'react';
import type { RecoveryNotice } from '../../../shared/recovery';
import { recoveryText } from '../../../shared/recovery';
import { Button } from '../ui/Button';
import { RotateCcw } from '../ui/icons';
import { useArrival, useLeaving } from '../ui/motion';

/** After an unexpected stop: what Drashti put back on the screens by itself, until the operator says OK. */
export function RecoveryBanner() {
  const [notice, setNotice] = useState<RecoveryNotice | null>(null);
  useEffect(() => {
    void window.drashti.app.recovery().then(setNotice);
  }, []);
  if (!notice) return null;
  return <RecoveryCard notice={notice} onDismiss={() => setNotice(null)} />;
}

function RecoveryCard({ notice, onDismiss }: { notice: RecoveryNotice; onDismiss: () => void }) {
  const ref = useLeaving<HTMLDivElement>('notice');
  // Shown as Drashti opens again after a stop, while the screens are put back: it arrives settled.
  const arriving = useArrival('notice');
  return (
    <div
      ref={ref}
      role="alert"
      data-testid="recovery-notice"
      data-motion={arriving}
      // In the window's flow under the header (Sessions 31–36, A9): it never covers a control the keyboard is on.
      className="mx-auto mt-2 flex w-[min(44rem,calc(100%-2rem))] shrink-0 items-center gap-3 rounded-lg border border-warning/60 bg-warning-bg px-4 py-3 text-sm text-warning-fg shadow-overlay"
    >
      <RotateCcw size={18} aria-hidden="true" className="shrink-0" />
      <span className="flex-1">{recoveryText(notice)}</span>
      <Button
        variant="secondary"
        onClick={() => {
          void window.drashti.app.dismissRecovery();
          onDismiss();
        }}
      >
        OK
      </Button>
    </div>
  );
}
