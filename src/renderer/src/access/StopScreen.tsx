import { useEffect, useRef } from 'react';
import {
  ACCESS_REMOVED_TEXT,
  type AccessView,
  ENDED_COME_BACK_TEXT,
  ENDED_STOP_TITLE,
  endedStopText,
  NO_CONTACT_COME_BACK_TEXT,
  NO_CONTACT_STOP_TEXT,
  NO_CONTACT_STOP_TITLE,
  STOP_REASON_TEXT,
  STOPPED_WHAT_TEXT,
} from '../../../shared/access';
import { Button } from '../ui/Button';
import { Mark } from '../ui/Mark';

/*
 * The stop (Session 54, access by Gmail: revoked, rejected, unknown, the length ended, or 15 days with no answer), in
 * place of the controls, in Pro and Simple Mode alike: one plain message and Quit, the one button that works. The main
 * process has stopped everything already (the screens fade to black, the stream and recording end, the nodes and
 * phones stop) and refuses every other request; this only says so. After 15 days with no answer (Session 55) it stops
 * as a revoke stops it, saying to ask for access again (Request Access, once Drashti is started again online).
 */
export function StopScreen({ view }: { view: AccessView }) {
  const quit = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    quit.current?.focus();
  }, []);
  const noContact = view.reason === 'no-contact' || view.reason === 'no-answer';
  const ended = view.reason === 'expired';
  const why = noContact
    ? NO_CONTACT_STOP_TEXT
    : ended
      ? endedStopText(view.endsAt)
      : view.reason
        ? STOP_REASON_TEXT[view.reason]
        : undefined;
  const comeBack = noContact
    ? NO_CONTACT_COME_BACK_TEXT
    : ended
      ? ENDED_COME_BACK_TEXT
      : 'To use Drashti again, ask the person who approves access, then start Drashti again.';
  return (
    <main
      className="flex h-full items-center justify-center overflow-y-auto bg-ink px-6 py-8 text-fg"
      data-testid="access-stopped"
      data-reason={view.reason ?? ''}
    >
      <div className="w-full max-w-xl space-y-5">
        <p className="flex items-center gap-2.5 text-base font-bold tracking-wide text-muted">
          <Mark size={28} />
          Drashti
        </p>
        <div role="alert" className="space-y-3">
          <h1 className="text-2xl font-bold">
            {noContact ? NO_CONTACT_STOP_TITLE : ended ? ENDED_STOP_TITLE : ACCESS_REMOVED_TEXT}
          </h1>
          {why && <p className="text-base">{why}</p>}
          <p className="text-base text-muted">{STOPPED_WHAT_TEXT}</p>
          <p className="text-base text-muted">{comeBack}</p>
        </div>
        <Button
          ref={quit}
          variant="primary"
          size="lg"
          data-testid="access-quit"
          onClick={() => void window.drashti.access.quit()}
        >
          Quit Drashti
        </Button>
      </div>
    </main>
  );
}
