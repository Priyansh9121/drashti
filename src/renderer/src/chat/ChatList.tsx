import type { Ref } from 'react';
import { cx } from '../ui/cx';
import type { ChatRow } from './chat-view';

/*
 * The operator's chat list (QA23-CHAT-1): the day's messages as a WhatsApp group shows them, newest at the bottom: the
 * operator's own on the right, others' on the left with the sender's name above the first of each run, the time under
 * each. Every word from a phone is shown as words (React's text, never HTML), and wraps rather than being cut short.
 * A log for a screen reader: each message says who sent it and when, and a new one is read out as it comes while the
 * section is open.
 */

const WRAP = 'break-words whitespace-pre-wrap [overflow-wrap:anywhere]';

export function ChatList({ rows, ref }: { rows: readonly ChatRow[]; ref?: Ref<HTMLDivElement> }) {
  return (
    // The log's own box (an <ol> keeps its list for a screen reader inside it), positioned so its screen-reader
    // words (sr-only, absolute) stay inside what scrolls.
    <div ref={ref} role="log" aria-label="Chat messages" className="relative" data-testid="chat-list">
      <ol className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid="chat-message"
            data-mine={r.mine ? 'true' : 'false'}
            className={cx(
              'relative flex max-w-[85%] min-w-0 flex-col rounded-lg border bg-panel-2 px-2.5 py-1.5 text-sm',
              r.mine ? 'self-end border-accent/60' : 'self-start border-line',
            )}
          >
            <span className="sr-only">{`${r.sender}, ${r.time}: `}</span>
            {r.name !== null && (
              <span
                aria-hidden="true"
                data-testid="chat-sender"
                className={cx('text-xs font-semibold text-heading', WRAP)}
              >
                {r.name}
              </span>
            )}
            <span className={cx('text-fg', WRAP)} data-testid="chat-text">
              {r.text}
            </span>
            <span aria-hidden="true" className="self-end text-2xs text-muted">
              {r.time}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
