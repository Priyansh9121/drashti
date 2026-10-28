import type { Announcement } from '../../../../shared/announcements';
import { Button } from '../../ui/Button';
import { Megaphone, X } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { plural } from '../../ui/text';
import { closeSheet, decideQueue, useDesktop } from './desktop-store';
import { PhoneSheet } from './PhoneSheet';

/*
 * The announcements' queue from a phone (Session 54, the phone as a full Drashti), as Announcements decides on the
 * computer: each waiting one with its words, who it is from and for how long, approved in the ticker or as a message
 * (the Announcement template), or rejected; and each showing one taken off before its time. Pro Mode's: in Simple
 * Mode Drashti refuses the decisions, and says so here.
 */

const id = (a: Announcement) => encodeURIComponent(a.id);

function Waiting({ a, busy }: { a: Announcement; busy: boolean }) {
  return (
    <li
      className="space-y-2 rounded-lg border border-line bg-panel-2 p-3"
      data-testid="remote-queue-waiting"
      data-id={a.id}
    >
      <p className="text-base text-fg">{a.text}</p>
      <p className="text-base text-muted">
        From {a.from} ({a.deviceName}), for {plural(a.minutes, 'minute')}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          wrap
          variant="primary"
          className="min-h-12 w-full"
          disabled={busy}
          data-testid="remote-queue-ticker"
          onClick={() => void decideQueue(`/api/v1/announcement-queue/${id(a)}/approve`, { as: 'ticker' })}
        >
          In the ticker
        </Button>
        <Button
          size="lg"
          wrap
          className="min-h-12 w-full"
          disabled={busy}
          data-testid="remote-queue-message"
          onClick={() => void decideQueue(`/api/v1/announcement-queue/${id(a)}/approve`, { as: 'message' })}
        >
          As a message
        </Button>
        <Button
          size="lg"
          wrap
          variant="danger"
          className="col-span-2 min-h-12 w-full"
          disabled={busy}
          data-testid="remote-queue-reject"
          onClick={() => void decideQueue(`/api/v1/announcement-queue/${id(a)}/reject`)}
        >
          Reject
        </Button>
      </div>
    </li>
  );
}

export function QueueSheet() {
  const queue = useDesktop((s) => s.queue);
  const busy = useDesktop((s) => s.busy);
  const problem = useDesktop((s) => s.problem);
  return (
    <PhoneSheet
      title="Announcements"
      subtitle="Sent from phones to the Drashti computer"
      testId="remote-queue-sheet"
      onClose={closeSheet}
    >
      {problem && (
        <Notice
          tone="warning"
          data-testid="remote-queue-problem"
          onDismiss={() => useDesktop.setState({ problem: null })}
        >
          {problem}
        </Notice>
      )}
      {queue === null ? (
        <p className="text-base text-muted">Reading the announcements…</p>
      ) : (
        <>
          <section className="space-y-2" aria-labelledby="remote-queue-waiting-title">
            <h3 id="remote-queue-waiting-title" className="text-base font-bold text-fg">
              Waiting
            </h3>
            {queue.waiting.length === 0 ? (
              <p className="text-base text-muted">Nothing is waiting.</p>
            ) : (
              <ul className="space-y-2">
                {queue.waiting.map((a) => (
                  <Waiting key={a.id} a={a} busy={busy} />
                ))}
              </ul>
            )}
          </section>
          <section className="space-y-2" aria-labelledby="remote-queue-showing-title">
            <h3 id="remote-queue-showing-title" className="text-base font-bold text-fg">
              On the screens
            </h3>
            {queue.showing.length === 0 ? (
              <p className="text-base text-muted">None is on the screens.</p>
            ) : (
              <ul className="space-y-2">
                {queue.showing.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 rounded-lg border border-live bg-panel-2 py-1 pr-1 pl-3"
                    data-testid="remote-queue-showing"
                    data-id={a.id}
                  >
                    <Megaphone size={18} aria-hidden className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 text-base text-fg">
                      {a.text} ({a.shownAs === 'ticker' ? 'in the ticker' : 'as a message'})
                    </span>
                    <Button
                      size="lg"
                      className="min-h-12"
                      icon={X}
                      disabled={busy}
                      data-testid="remote-queue-take-off"
                      onClick={() => void decideQueue(`/api/v1/announcement-queue/${id(a)}/take-off`)}
                    >
                      Take off
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PhoneSheet>
  );
}
