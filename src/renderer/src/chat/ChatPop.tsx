import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { CHAT_OPERATOR_ID } from '../../../shared/chat';
import { REPORT_PRIVATE_ATTR } from '../../../shared/report-private';
import { usePopPlace } from '../operator/pop-place';
import { motionOff } from '../ui/motion';
import { arrivals, popAfter, popChangesAt, popPhase, popWords, type ChatPop } from './chat-pop';
import { connectChat, useChat } from './chat-store';

/** Only the operator shells mount this: no audience, stage, phone or stream imports it. */
export const useChatOpen = create<{ asked: number }>(() => ({ asked: 0 }));

/** A popup's click asking Chat to open (red: today's rule, whatever the mode). */
export function openChatFromPop(): void {
  useChatOpen.setState((s) => ({ asked: s.asked + 1 }));
}

export interface ChatPopViewProps {
  pop: ChatPop | null;
  leaving: boolean;
  still: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

export function ChatPopView({ pop, leaving, still, onOpen, onDismiss }: ChatPopViewProps) {
  const words = pop ? popWords(pop) : null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="w-full max-w-[32rem]"
      {...{ [REPORT_PRIVATE_ATTR]: '' }}
    >
      {words && (
        <div
          data-testid="chat-pop"
          data-leaving={leaving || undefined}
          className={`pointer-events-auto flex w-full items-start gap-2 rounded-lg border border-line bg-panel p-3 text-fg shadow-lg ${still ? '' : 'transition-opacity [transition-duration:var(--dur-notice)] motion-reduce:transition-none'}`}
          style={{ opacity: leaving ? 0 : 1 }}
        >
          <button
            type="button"
            tabIndex={-1}
            data-testid="chat-pop-open"
            className="min-w-0 flex-1 text-left text-sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onOpen}
          >
            <span className="block truncate font-semibold">{words.from}</span>
            <span
              data-testid="chat-pop-text"
              className="line-clamp-2 whitespace-pre-line [overflow-wrap:anywhere]"
            >
              {words.text}
            </span>
            {words.more && <span className="block text-xs text-muted">{words.more}</span>}
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Dismiss chat popup"
            data-testid="chat-pop-dismiss"
            className="h-6 w-6 shrink-0 rounded hover:bg-panel-2"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onDismiss}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** Subscribe even with Chat folded. Mode switches do not replay already received messages. */
const usePop = create<{ pop: ChatPop | null }>(() => ({ pop: null }));
let watching = false;
function watchChatPop(): void {
  if (watching) return;
  watching = true;
  useChat.subscribe((next, before) => {
    if (next.view === before.view) return;
    const came = arrivals(before.view?.messages ?? null, next.view?.messages ?? [], CHAT_OPERATOR_ID);
    usePop.setState((s) => ({
      pop: next.view?.messages.length ? popAfter(s.pop, came, Date.now(), motionOff()) : null,
    }));
  });
  connectChat();
}

export function ChatPopup() {
  const pop = usePop((s) => s.pop);
  const [now, setNow] = useState(Date.now);
  const still = motionOff();
  useEffect(watchChatPop, []);
  useEffect(() => {
    const at = popChangesAt(pop, Date.now(), motionOff());
    if (at === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [pop, now]);
  const phase = popPhase(pop, now, still);
  const place = usePopPlace((s) => s.place);
  const view = (
    <ChatPopView
      pop={phase === 'gone' ? null : pop}
      leaving={phase === 'leaving'}
      still={still}
      onDismiss={() => usePop.setState({ pop: null })}
      onOpen={() => {
        usePop.setState({ pop: null });
        useChatOpen.setState((s) => ({ asked: s.asked + 1 }));
      }}
    />
  );
  // Over the middle column's foot (operator/pop-place.ts), centred, never wider than the middle.
  if (place)
    return createPortal(
      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-40 flex justify-center">{view}</div>,
      place,
    );
  // Without the columns (the practice show): centred over the window, just above the quick bar and the bar of clears.
  return (
    <div className="relative z-40 h-0 shrink-0">
      <div className="pointer-events-none absolute inset-x-4 bottom-2 flex justify-center">{view}</div>
    </div>
  );
}
