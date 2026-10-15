import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { connectScreens, useScreens } from './screens-store';

/*
 * A hall screen that stopped (Session 26h). When Main gives up on one of its outputs (its window kept
 * failing; the watchdog, Session 23), the screen is black and Screens says so, but nobody looks there in
 * the middle of a sabha. So a notice rises in the window, in Pro Mode and in Simple Mode alike, naming the
 * screen, with Try again as its one primary. It stays until the screen is back or the operator closes it,
 * and comes again if the screen stops again later. It sits in the window's flow under the header, so it
 * never covers the show controls (Next, Back, the layer bar, Simple Mode's big buttons).
 */

const NONE: ReadonlySet<string> = new Set();

export function StoppedScreens() {
  // The snapshot itself (a new list from a selector would render for ever); what is stopped is worked out below.
  const snapshot = useScreens((s) => s.snapshot);
  const [closed, setClosed] = useState<ReadonlySet<string>>(NONE);
  const [failed, setFailed] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    connectScreens();
  }, []);
  const stopped = snapshot?.status.filter((st) => st.state === 'stopped').map((st) => st.screenId) ?? [];
  // A screen that is back is forgotten here, so it raises the notice again if it stops again.
  const stoppedKey = stopped.join(' ');
  const [seenKey, setSeenKey] = useState(stoppedKey);
  if (seenKey !== stoppedKey) {
    setSeenKey(stoppedKey);
    setClosed((was) => new Set([...was].filter((id) => stopped.includes(id))));
    setFailed({});
  }
  const shown = stopped.filter((id) => !closed.has(id));
  if (!snapshot || shown.length === 0) return null;
  const screens = snapshot.groups.flatMap((g) => g.screens);
  return (
    <div className="shrink-0 space-y-2 px-3 pt-2" data-testid="stopped-screens">
      {shown.map((id) => {
        const name = screens.find((s) => s.id === id)?.name ?? 'A screen';
        return (
          <Notice
            key={id}
            tone="danger"
            title={`“${name}” has stopped`}
            data-testid="screen-stopped-notice"
            data-screen={id}
            onDismiss={() => {
              setClosed((was) => new Set([...was, id]));
            }}
            actions={
              <Button
                variant="primary"
                size="sm"
                data-testid="screen-stopped-try-again"
                onClick={() => {
                  void window.drashti.screens.tryAgain(id).then((r) => {
                    if (!r.ok) setFailed((was) => ({ ...was, [id]: r.message }));
                  });
                }}
              >
                Try again
              </Button>
            }
          >
            It kept failing, so it is black for now. Drashti tries it again by itself every few minutes.
            {failed[id] && <span className="block">{failed[id]}</span>}
          </Notice>
        );
      })}
    </div>
  );
}
