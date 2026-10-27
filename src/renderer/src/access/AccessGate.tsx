import { type ReactNode, useEffect } from 'react';
import { connectAccess, useAccess } from './access-store';
import { LockedHere } from './LockedHere';
import { StopCountdown } from './StopCountdown';
import { StopScreen } from './StopScreen';

/*
 * The operator window behind the lock (Session 54, access by Gmail), around Pro and Simple Mode alike: the controls
 * only while this computer is let in; with the countdown over them while the list does not answer; the stop in their
 * place once Drashti has stopped (the controls gone, so no key, click or MIDI note reaches them). The main process
 * refuses every request of theirs anyway: this only shows what it decided.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const view = useAccess((s) => s.view);
  useEffect(() => {
    connectAccess();
  }, []);
  if (view === null) return null;
  if (view.phase === 'stopped') return <StopScreen view={view} />;
  if (view.phase !== 'in' && view.phase !== 'warning') return <LockedHere view={view} />;
  return (
    <>
      {children}
      {view.phase === 'warning' && view.stopsInMs !== null && (
        // A new countdown at each change the main process sends, from what it says is left.
        <StopCountdown key={view.stopsInMs} stopsInMs={view.stopsInMs} />
      )}
    </>
  );
}
