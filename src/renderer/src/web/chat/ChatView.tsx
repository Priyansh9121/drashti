import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatClock, type ClockStyle } from '../../../../shared/format';
import { cutText } from '../../../../shared/text';
import { ClockStyleContext } from '../../render/clock-style';
import { textLang } from '../../render/lang';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { ArrowDown, MessageCircle, Send, X } from '../../ui/icons';
import { CHAT_NAME_MAX, CHAT_OPERATOR_ID, CHAT_TEXT_MAX, type ChatMessage } from '../../../../shared/chat';
import { BYE_TEXT } from '../../../../shared/network';
import { Notice } from '../../ui/Notice';
import { useFeed } from '../feed';
import { Badge } from '../../ui/Badge';
import { chatInView, dismissBanner, sendChat, setChatName, useChat } from './chat-store';

/*
 * The phone's Chat (QA23-CHAT-1), as WhatsApp's groups look: each message in a bubble, the sender's name above the
 * others' messages, this phone's own on the right, the time under each, newest at the bottom; the day's history when
 * it opens. The person gives a name once (kept on the phone). The text box takes up to 500 characters, emoji too;
 * to speak, the phone keyboard's own microphone types the words (Drashti listens to nothing itself: a phone's browser
 * gives a page on plain http no microphone). Every name and message is shown as plain words, never as markup.
 */

/** Said by the text box: the phone keyboard's own voice typing, then Send. */
export const MIC_HINT = 'Tap 🎤 on your keyboard to speak';

/** Words cut to fit a banner's line (the whole message is in the chat). */
const BANNER_WORDS = 140;
/** How long a banner stays before it goes by itself (ms). */
const BANNER_MS = 8000;
/** Within this of the bottom, the list follows each new message down (px). */
const NEAR_BOTTOM_PX = 64;

/**
 * The operator's messages carry a mark no name can give (a22-review-chat P-S3): they are known by who sent them (the
 * operator's id, which no device has), never by the name, so a phone named "Operator." looks like any phone.
 */
const fromOperator = (message: ChatMessage): boolean => message.from.id === CHAT_OPERATOR_ID;

function OperatorMark() {
  return (
    <Badge tone="info" data-testid="chat-operator-mark">
      On the computer
    </Badge>
  );
}

function Bubble({ message, own, clock }: { message: ChatMessage; own: boolean; clock: ClockStyle | null }) {
  const operator = fromOperator(message);
  return (
    <li
      data-testid="chat-message"
      data-own={String(own)}
      data-operator={String(operator)}
      className={cx('flex max-w-[85%] flex-col', own ? 'self-end' : 'self-start')}
    >
      <div
        className={cx(
          'min-w-0 rounded-2xl border px-3 py-2',
          own
            ? 'rounded-br-md border-accent/40 bg-accent/15'
            : operator
              ? 'rounded-bl-md border-l-4 border-line-strong border-l-accent bg-panel-3'
              : 'rounded-bl-md border-line bg-panel-2',
        )}
      >
        {!own && (
          <p className="flex flex-wrap items-center gap-x-2 text-base font-bold break-words text-accent">
            <span data-testid="chat-from">{message.from.name}</span>
            {operator && <OperatorMark />}
          </p>
        )}
        <p
          data-testid="chat-text"
          lang={textLang(message.text)}
          className="text-lg break-words whitespace-pre-wrap text-fg"
        >
          {message.text}
        </p>
        <p className="text-right text-base text-muted">
          {own && <span className="sr-only">You, </span>}
          <time dateTime={message.at}>{formatClock(Date.parse(message.at), clock)}</time>
        </p>
      </div>
    </li>
  );
}

/** The day's messages, oldest first: newest at the bottom. */
export function ChatList({
  messages,
  me,
  clock,
}: {
  messages: readonly ChatMessage[];
  me: string | null;
  clock: ClockStyle | null;
}) {
  if (messages.length === 0)
    return (
      <p className="py-6 text-center text-base text-muted" data-testid="chat-empty">
        No messages yet today.
      </p>
    );
  return (
    <ol className="flex flex-col gap-2" data-testid="chat-list" aria-label="Messages">
      {messages.map((m) => (
        <Bubble key={m.id} message={m} own={m.from.id === me} clock={clock} />
      ))}
    </ol>
  );
}

/** Asked once: the person's name, as everyone in the chat sees it above their messages. */
export function ChatNameForm({
  onName,
  problem,
  initial,
  onCancel,
}: {
  /** Null when Drashti took the name (it is then kept on the phone), or what is wrong with it. */
  onName: (name: string) => Promise<string | null>;
  problem: string | null;
  initial: string;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial);
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const said = wrong ?? problem;
  return (
    <form
      className="space-y-3"
      data-testid="chat-name-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        void onName(name).then((answer) => {
          setBusy(false);
          setWrong(answer);
        });
      }}
    >
      <label className="block space-y-2">
        <span className="block text-base font-bold text-fg">Your name in the chat</span>
        <input
          data-testid="chat-name"
          className="h-14 w-full rounded-lg border border-field bg-panel-2 px-3 text-lg text-fg"
          value={name}
          maxLength={CHAT_NAME_MAX}
          autoComplete="name"
          enterKeyHint="done"
          lang={textLang(name)}
          aria-describedby="chat-name-about"
          onChange={(e) => {
            setName(e.target.value);
            setWrong(null);
          }}
        />
      </label>
      <p id="chat-name-about" className="text-base text-muted">
        Everyone in the chat sees it above your messages. This phone remembers it.
      </p>
      {said && (
        <p role="alert" className="text-base text-danger-fg">
          {said}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="min-h-12"
          disabled={busy}
          data-testid="chat-name-save"
        >
          {onCancel ? 'Save name' : 'Join the chat'}
        </Button>
        {onCancel && (
          <Button size="lg" className="min-h-12" data-testid="chat-name-cancel" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** The text box, the microphone hint and Send. */
function Composer() {
  const sending = useChat((s) => s.sending);
  const problem = useChat((s) => s.problem);
  const [text, setText] = useState('');
  const near = text.length > CHAT_TEXT_MAX - 50;
  return (
    <form
      className="shrink-0 space-y-1 border-t border-line pt-3"
      data-testid="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void sendChat(text).then((sent) => {
          if (sent) setText('');
        });
      }}
    >
      <div className="flex items-end gap-2">
        <label htmlFor="chat-text-box" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-text-box"
          data-testid="chat-text-box"
          rows={1}
          value={text}
          maxLength={CHAT_TEXT_MAX}
          lang={textLang(text)}
          aria-describedby="chat-mic-hint"
          placeholder="Message"
          // One line to start, growing with the words up to a few lines (where the browser can), as a chat's box does.
          className="field-sizing-content max-h-32 min-h-12 min-w-0 flex-1 resize-none rounded-2xl border border-field bg-panel-2 px-3 py-2.5 text-lg text-fg placeholder:text-faint"
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="min-h-12"
          icon={Send}
          disabled={sending}
          data-testid="chat-send"
        >
          Send
        </Button>
      </div>
      <p id="chat-mic-hint" className="text-base text-muted" data-testid="chat-mic-hint">
        {MIC_HINT}
        {near && (
          <span data-testid="chat-count">
            {' '}
            · {text.length} of {CHAT_TEXT_MAX}
          </span>
        )}
      </p>
      {problem && (
        <p role="alert" className="text-base text-danger-fg" data-testid="chat-problem">
          {problem}
        </p>
      )}
    </form>
  );
}

/** While this is on the screen (and the page is shown), the chat is seen: nothing unread, no banner. */
function useInView(): void {
  useEffect(() => {
    const on = () => {
      chatInView(document.visibilityState === 'visible');
    };
    on();
    document.addEventListener('visibilitychange', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      chatInView(false);
    };
  }, []);
}

/**
 * The chat: the list scrolling, and the text box under it. `fill`: it takes its place's whole height (the phone's
 * middle, a tablet's panel), the list scrolling within it; otherwise the list is a part of the screen high.
 */
export function ChatPanel({ fill }: { fill: boolean }) {
  const chat = useChat((s) => s.chat);
  const me = useChat((s) => s.me);
  const name = useChat((s) => s.name);
  const problem = useChat((s) => s.problem);
  const clock = useContext(ClockStyleContext);
  // The chat opened on this device in another page: this one waits until it is shown again (feed.ts).
  const elsewhere = useFeed((s) => s.state === 'offline' && s.reason === BYE_TEXT.replaced);
  const [renaming, setRenaming] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // At the bottom of the list (as its scrolling last said), and how many messages there were when it left it.
  const [atBottom, setAtBottom] = useState(true);
  const [leftAt, setLeftAt] = useState(0);
  useInView();
  const count = chat?.messages.length ?? 0;
  const last = chat?.messages.at(-1);
  const behind = !atBottom && count > leftAt;
  // Newest at the bottom: the list opens there and follows each new message down, unless the person has scrolled
  // up to read (then "New messages" takes them down). Their own message always takes them down.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && (atBottom || last?.from.id === me)) el.scrollTop = el.scrollHeight;
  }, [atBottom, count, last, me, name, renaming]);
  if (name === null || renaming)
    return (
      <section className="space-y-3" data-testid="chat" aria-labelledby="chat-title">
        <h2 id="chat-title" className="text-base font-bold tracking-wider text-muted uppercase">
          Chat
        </h2>
        <p className="text-base text-fg">
          Everyone paired with this Drashti computer can read and send messages here, today only.
        </p>
        <ChatNameForm
          initial={name ?? ''}
          problem={null}
          onName={async (given) => {
            const wrong = await setChatName(given);
            if (!wrong) setRenaming(false);
            return wrong;
          }}
          {...(name !== null ? { onCancel: () => setRenaming(false) } : {})}
        />
      </section>
    );
  return (
    <section
      className={cx('flex flex-col gap-2', fill && 'h-full min-h-0')}
      data-testid="chat"
      aria-labelledby="chat-title"
    >
      {elsewhere && (
        <Notice tone="info" data-testid="chat-elsewhere" className="shrink-0">
          {BYE_TEXT.replaced} Come back to this page to follow it here.
        </Notice>
      )}
      <div className="flex shrink-0 items-center gap-2">
        <h2 id="chat-title" className="shrink-0 text-base font-bold tracking-wider text-muted uppercase">
          Chat
        </h2>
        {/* A long name is cut to fit (the whole of it is in Change name). */}
        <p className="min-w-0 flex-1 truncate text-base text-muted">
          as{' '}
          <span className="text-fg" data-testid="chat-own-name">
            {name}
          </span>
        </p>
        <Button
          size="lg"
          variant="ghost"
          className="min-h-11"
          data-testid="chat-rename"
          onClick={() => setRenaming(true)}
        >
          Change name
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-col" style={fill ? { flex: '1 1 0%' } : undefined}>
        <div
          ref={scroller}
          className={cx('overflow-y-auto overscroll-contain', fill ? 'min-h-0 flex-1' : 'max-h-[55dvh]')}
          data-testid="chat-scroller"
          onScroll={(e) => {
            const el = e.currentTarget;
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
            if (bottom === atBottom) return;
            setAtBottom(bottom);
            if (!bottom) setLeftAt(count);
          }}
        >
          {chat === null ? (
            <p role="status" className="py-6 text-center text-base text-muted">
              {problem ?? 'Reading the chat…'}
            </p>
          ) : (
            <ChatList messages={chat.messages} me={me} clock={clock} />
          )}
        </div>
        {behind && (
          <Button
            size="lg"
            variant="primary"
            icon={ArrowDown}
            className="absolute right-2 bottom-2 min-h-11"
            data-testid="chat-jump"
            onClick={() => {
              setAtBottom(true);
            }}
          >
            New messages
          </Button>
        )}
      </div>
      <Composer />
    </section>
  );
}

/** A new message from someone else, over the page: who and what, a tap to open the chat, and a Close. */
export function ChatBannerView({
  message,
  onOpen,
  onDismiss,
  className,
}: {
  message: ChatMessage;
  onOpen: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  const words = cutText(message.text, BANNER_WORDS, '…');
  return (
    <div
      role="status"
      data-testid="chat-banner"
      className={cx(
        'flex items-center gap-2 rounded-xl border border-l-4 border-line-strong border-l-accent bg-panel-2 py-0.5 pr-1 pl-3',
        className,
      )}
    >
      <MessageCircle size={20} aria-hidden="true" className="shrink-0 text-accent" />
      <button
        type="button"
        className="min-w-0 flex-1 py-1 text-left"
        data-testid="chat-banner-open"
        onClick={onOpen}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-base font-bold text-fg">
            <span className="sr-only">New message from </span>
            {message.from.name}
          </span>
          {fromOperator(message) && <OperatorMark />}
        </span>
        <span className="block truncate text-base text-muted" lang={textLang(message.text)}>
          {words}
        </span>
      </button>
      <button
        type="button"
        aria-label="Close the message"
        className="flex shrink-0 items-center justify-center rounded-lg text-muted"
        data-testid="chat-banner-close"
        onClick={onDismiss}
      >
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The banner for the newest message not seen yet, laid over its place (the remote's header) so nothing on the page
 * moves (a22-review-chat P-M1); it goes by itself after a few seconds. Never while the show is on the screen.
 */
export function ChatBanner({ onOpen }: { onOpen: () => void }) {
  const banner = useChat((s) => s.banner);
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(dismissBanner, BANNER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [banner]);
  if (!banner) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-stretch px-2 py-1">
      <ChatBannerView message={banner} onOpen={onOpen} onDismiss={dismissBanner} className="min-w-0 flex-1" />
    </div>
  );
}

/** How many messages from others are not seen yet (for the Chat tab's count). */
export function useUnread(): number {
  return useChat((s) => s.unread.length);
}
