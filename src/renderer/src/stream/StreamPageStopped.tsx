import { useState } from 'react';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useStream } from './stream-store';

/*
 * The stream's page stopped (Session 31): it crashed a sixth time within a minute, so Drashti stopped
 * starting it again, as the watchdog does for a hall screen, and the stream shows its last picture. This
 * notice says so in the window's flow, under the header, in Pro Mode and Simple Mode alike (never over
 * the show controls), with Try again as its one primary; it goes once the page is back.
 */

export function StreamPageStopped() {
  const stopped = useStream((s) => s.status?.pageStopped ?? false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!stopped) return null;
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="stream-page-stopped">
      <Notice
        tone="danger"
        title="The stream’s picture has stopped"
        data-testid="stream-page-stopped-notice"
        actions={
          <Button
            variant="primary"
            size="sm"
            data-testid="stream-page-try-again"
            onClick={() => {
              void window.drashti.stream.tryAgain().then((r) => {
                setFailed(r.ok ? null : r.message);
              });
            }}
          >
            Try again
          </Button>
        }
      >
        Its page kept failing, so Drashti stopped starting it again: the stream shows its last picture. Try
        again starts it afresh.
        {failed && <span className="block">{failed}</span>}
      </Notice>
    </div>
  );
}
