import { useEffect, useState } from 'react';
import { type AccessView, LOCK_REASON_TEXT } from '../../../shared/access';
import { type AppInfo, describeAppInfo } from '../../../shared/app-info';
import { Button } from '../ui/Button';
import { Mark } from '../ui/Mark';

/*
 * The operator window while this computer is not let in (Session 54): only in a self-test, which shows its own
 * placeholder content on the screens and never unlocks the controls. What Drashti is (the version line the self-test
 * reads, as the status bar's), and Quit.
 */
export function LockedHere({ view }: { view: AccessView }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void window.drashti.app.getInfo().then(setInfo);
  }, []);
  return (
    <main
      className="flex h-full items-center justify-center overflow-y-auto bg-ink px-6 py-8 text-fg"
      data-testid="access-locked-here"
      data-reason={view.reason ?? ''}
    >
      <div className="w-full max-w-xl space-y-5">
        <p className="flex items-center gap-2.5 text-base font-bold tracking-wide text-muted">
          <Mark size={28} />
          Drashti
        </p>
        <h1 className="text-2xl font-bold">Drashti is locked</h1>
        <p className="text-base">
          {view.reason ? LOCK_REASON_TEXT[view.reason] : 'This computer is not let in yet.'}
        </p>
        <Button variant="secondary" size="lg" onClick={() => void window.drashti.access.quit()}>
          Quit Drashti
        </Button>
        <p data-testid="app-info" className="text-sm text-faint">
          {info ? describeAppInfo(info) : ''}
        </p>
      </div>
    </main>
  );
}
