import { useEffect, useState } from 'react';
import type { RecoveryNotice } from '../../../shared/recovery';
import { recoveryText } from '../../../shared/recovery';
import { Button } from '../ui/Button';
import { RotateCcw } from '../ui/icons';
import { useLeaving } from '../ui/motion';

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
  return (
    <div
      ref={ref}
      role="alert"
      data-testid="recovery-notice"
      data-motion="notice"
      className="fixed top-14 left-1/2 z-30 flex w-[min(44rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border border-warning/60 bg-warning-bg px-4 py-3 text-sm text-warning-fg shadow-overlay"
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
