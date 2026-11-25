import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog } from '../ui/Dialog';
import { Textarea } from '../ui/Field';
import { ChevronDown, ChevronRight, MessagesSquare, Send, Trash2 } from '../ui/icons';
import { LIVE_SECTION, Panel } from '../ui/Panel';
import { EmptyState, Loading } from '../ui/States';
import { useNetwork } from '../network/network-store';
import { useNow } from '../render/useNow';
import { useOperateOnly } from '../simple/simple-features-store';
import { ChatList } from './ChatList';
import type { ChatInvite, ChatMember, ChatOperatorView } from '../../../shared/chat';
import { CHAT_OPERATOR_ID } from '../../../shared/chat';
import { REPORT_PRIVATE_ATTR } from '../../../shared/report-private';
import {
  chatAction,
  clearChatError,
  connectChat,
  markChatSeen,
  setChatDraft,
  useChat,
  useChatUnread,
} from './chat-store';
import { chatRows, composerCheck, composerKey, unreadWords } from './chat-view';

/*
 * The operator window's Chat section (alpha.23, QA23-CHAT-1; the owner: "a few people scan and a group is created,
 * with the same chat … user's name who message something like in whatsapp groups"): under LIVE, folded at each start
 * as every section there. The day's messages, WhatsApp-style, newest at the bottom; Send as the operator; Clear chat
 * (asked first); the people in it, each removed by unpairing their phone (the Phones panel's own Remove); and a small
 * count of new messages on its heading, folded or not. Only in this window: never on an audience or stage screen.
 *
 * Simple Mode has it while Chat is chosen in Edit › Simple Mode Features… (off to begin with), reading and sending
 * only: Clear chat and removing a person stay Pro Mode's (OperateOnly), as the main process's lock keeps them.
 *
 * The whole section is a box the page marks private (shared/report-private.ts), and so is its open part and the
 * Remove dialog's name: Report a Problem's picture of this window blanks them (main/report/private-parts.ts).
 */

/** The messages' box: one height for a window's size, empty or full (a22-review-chat O-S1). */
const MESSAGES_BOX = 'h-[clamp(10rem,30vh,20rem)] min-h-0';

/** What Report a Problem's picture of the window blanks (the chat's words and names). */
const PRIVATE = { [REPORT_PRIVATE_ATTR]: '' };

/** Whether a box scrolls now (its content taller than it), checked again whenever `content` changes. */
function useScrolls(box: RefObject<HTMLElement | null>, content: unknown): boolean {
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (el) setScrolls(el.scrollHeight > el.clientHeight + 1);
  }, [box, content]);
  return scrolls;
}

/** A person who has given a name (core's M3: every chat phone is listed, named or not). */
const named = (m: ChatMember): boolean => m.name.trim() !== '';

const KIND_WORDS: Record<ChatMember['kind'], string> = {
  remote: 'Remote',
  announcements: 'Announcements',
  chat: 'Chat only',
};

/** The people in the chat, each with Remove… in Pro Mode. */
export function ChatPeople({
  members,
  open,
  onOpen,
  canRemove,
  onRemove,
}: {
  members: readonly ChatMember[];
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Whether this window may remove that person (Simple Mode: a chat phone only). */
  canRemove: (member: ChatMember) => boolean;
  onRemove: (member: ChatMember) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const scrolls = useScrolls(list, members);
  return (
    <div className="space-y-1.5" data-testid="chat-people">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
        className="-ml-1 flex min-h-6 items-center gap-0.5 rounded-sm px-1 text-xs text-muted hover:text-fg"
        data-testid="chat-people-toggle"
      >
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        {`People in the chat (${String(members.length)})`}
      </button>
      {open &&
        (members.length === 0 ? (
          <p className="text-xs text-muted">No one is in the chat yet.</p>
        ) : (
          // A height of its own, whoever joins, so nothing under it moves (a22-review-chat O-S1).
          <ul
            ref={list}
            aria-label="People in the chat"
            // Reached by the keyboard while it scrolls (Simple Mode's has no button in it).
            tabIndex={scrolls ? 0 : undefined}
            className="h-28 space-y-1 overflow-y-auto pr-1"
            data-testid="chat-people-list"
          >
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-1"
                data-testid="chat-person"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cx(
                      'block text-sm break-words [overflow-wrap:anywhere]',
                      named(m) ? 'text-fg' : 'text-muted italic',
                    )}
                  >
                    {named(m) ? m.name : 'No name yet'}
                  </span>
                  <span className="block text-xs text-muted">
                    {KIND_WORDS[m.kind]} · {m.connected ? 'Connected' : 'Not connected'}
                  </span>
                </span>
                {canRemove(m) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    aria-label={
                      named(m)
                        ? `Remove ${m.name} from the chat`
                        : 'Remove a phone with no name yet from the chat'
                    }
                    className="shrink-0"
                    onClick={() => onRemove(m)}
                    data-testid="chat-remove-person"
                  >
                    Remove…
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/** Nothing said yet today: who is in the chat, and how more join. */
export function ChatEmpty({ operateOnly }: { operateOnly: boolean }) {
  return (
    <EmptyState icon={MessagesSquare} title="No messages yet today" compact data-testid="chat-empty">
      {operateOnly
        ? 'Everyone whose phone is paired with Drashti by QR code is in the chat.'
        : 'Everyone whose phone is paired with Drashti by QR code is in the chat. For more people, show the Chat QR code in Phones.'}
    </EmptyState>
  );
}

/**
 * While the Chat QR lets phones join (shown from Phones, Pro Mode), the section says so, with Stop, in either mode
 * (core's S5: Simple Mode may stop it). A line that is always there, so nothing under it moves as the code ends.
 */
function InviteLine({ invite }: { invite: ChatInvite | null }) {
  const now = useNow(1000);
  const left = invite ? Math.max(0, Math.ceil((invite.expiresAt - now) / 1000)) : 0;
  const time = `${String(Math.floor(left / 60))}:${String(left % 60).padStart(2, '0')}`;
  return (
    <div className="flex h-7 items-center gap-2 text-xs text-muted" data-testid="chat-invite-slot">
      {left > 0 && (
        <>
          <span className="min-w-0 flex-1">{`Phones can join by the Chat QR code for ${time} more.`}</span>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => void chatAction((chat) => chat.endInvite())}
            data-testid="chat-section-invite-end"
          >
            Stop the Chat QR code
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The text box and Send: Enter sends, Shift+Enter starts a new line, Escape leaves the box. Its words are kept in the
 * store (`draft`). Sent (or refused), the box lets the focus go (a22-review-chat O-S2): the window takes no show key
 * while a text box has the focus, and the chat is used during the show, so the next key (a clicker's Next) is the
 * show's unless the operator goes back into the box.
 */
function Composer({ draft, onDraft }: { draft: string; onDraft: (text: string) => void }) {
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const check = composerCheck(draft);
  const lineId = useId();
  const send = async () => {
    if (!check.canSend || sending) return;
    setSending(true);
    box.current?.blur();
    const result = await chatAction((chat) => chat.send(draft));
    setSending(false);
    if (result.ok) onDraft('');
  };
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      data-testid="chat-composer"
    >
      <div className="flex items-end gap-1.5">
        <Textarea
          ref={box}
          aria-label="Message to the chat"
          aria-describedby={lineId}
          aria-invalid={!check.canSend && check.line !== null ? true : undefined}
          placeholder="Write a message"
          rows={2}
          value={draft}
          onChange={(e) => {
            onDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            const does = composerKey({
              key: e.key,
              shiftKey: e.shiftKey,
              isComposing: e.nativeEvent.isComposing,
            });
            if (does === null) return;
            // Taken here: nothing else acts on it (the window's keys let a text box's keys go by anyway).
            e.preventDefault();
            if (does === 'send') void send();
            else e.currentTarget.blur();
          }}
          className="min-w-0 flex-1 resize-none px-2 py-1.5"
          data-testid="chat-text-box"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          icon={Send}
          disabled={!check.canSend || sending}
          className="shrink-0"
          data-testid="chat-send"
        >
          Send
        </Button>
      </div>
      {/* A line of its own, there while nothing is said, so the people under it never move as it comes and goes. */}
      <p
        id={lineId}
        className={cx('min-h-4 text-xs', check.canSend ? 'text-muted' : 'text-warning-fg')}
        data-testid="chat-composer-line"
      >
        {check.line}
      </p>
    </form>
  );
}

/** The day's messages, kept at the newest while the operator is there (scrolled up, it stays where it was). */
function Messages({ view }: { view: ChatOperatorView }) {
  const list = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const [scrolls, setScrolls] = useState(false);
  const rows = chatRows(view.messages, CHAT_OPERATOR_ID);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (atEnd.current) el.scrollTop = el.scrollHeight;
    setScrolls(el.scrollHeight > el.clientHeight + 1);
  }, [view.messages]);
  return (
    <ChatList
      ref={list}
      rows={rows}
      // It scrolls on its own, inside the box of one height (MESSAGES_BOX), reached by the keyboard while it scrolls.
      className="h-full overflow-y-auto pr-1"
      tabIndex={scrolls ? 0 : undefined}
      onScroll={() => {
        const el = list.current;
        if (el) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
      }}
    />
  );
}

/** What the open section shows, as the stores have it (ChatContents reads them). */
export interface ChatContentsProps {
  view: ChatOperatorView | null;
  operateOnly: boolean;
  /** The phones' network is on and listening. */
  networkOn: boolean;
  error: string | null;
  draft: string;
  onDraft: (text: string) => void;
  peopleOpen: boolean;
  onPeopleOpen: (open: boolean) => void;
}

/**
 * The open section: the messages, the text box, the people, and the refusal of the last request, all in one box marked
 * private (Report a Problem's picture blanks it).
 */
export function ChatContentsView({
  view,
  operateOnly,
  networkOn,
  error,
  draft,
  onDraft,
  peopleOpen,
  onPeopleOpen,
}: ChatContentsProps) {
  const [removing, setRemoving] = useState<ChatMember | null>(null);
  return (
    <div {...PRIVATE} className="space-y-2" data-testid="chat-contents">
      {view === null ? (
        <Loading label="Loading the chat…" />
      ) : (
        <>
          {!view.reachable && (
            <p className="text-xs text-warning-fg" data-testid="chat-unreachable">
              {networkOn || operateOnly
                ? 'Phones cannot reach the chat now.'
                : 'Phones cannot reach the chat while Phones is off: turn on Let paired phones and tablets connect.'}
            </p>
          )}
          {/* One height, empty or full (a22-review-chat O-S1): a message coming in never moves Timers, Lower Thirds
              and the tools under the section while the operator's pointer is on them. */}
          <div className={MESSAGES_BOX} data-testid="chat-messages-box">
            {view.messages.length === 0 ? <ChatEmpty operateOnly={operateOnly} /> : <Messages view={view} />}
          </div>
          <Composer draft={draft} onDraft={onDraft} />
          <InviteLine invite={view.invite} />
          {/* The last refusal, in a line that is always there (so nothing under it moves when one comes). */}
          <p role="alert" className="min-h-4 text-xs text-warning-fg" data-testid="chat-problem">
            {error}
          </p>
          <ChatPeople
            members={view.members}
            open={peopleOpen}
            onOpen={onPeopleOpen}
            // Simple Mode removes a chat phone, never a Remote or an Announcements device (core's S5: Main bounds it).
            canRemove={(m) => !operateOnly || m.kind === 'chat'}
            onRemove={(m) => {
              clearChatError();
              setRemoving(m);
            }}
          />
          {removing && (
            <ConfirmDialog
              // Its name in the words below, marked private, never in the title (which is the dialog's name too).
              title="Remove this person from the chat?"
              confirmLabel="Remove"
              onCancel={() => setRemoving(null)}
              onConfirm={() => {
                const who = removing;
                setRemoving(null);
                // Unpaired, whatever kind of device, and cut off from the chat and Drashti at once (Main).
                void chatAction((chat) => chat.remove(who.id));
              }}
              testId="chat-remove-confirm"
            >
              {/* The dialog lies over the window, outside the section's box: its name is marked on its own. */}
              <p>
                <span {...PRIVATE} className="font-medium text-fg">
                  {named(removing) ? `${removing.name}’s phone` : 'This phone (no name yet)'}
                </span>{' '}
                is cut off at once, from the chat and from anything else it does with Drashti. To come back,
                it is paired again.
              </p>
            </ConfirmDialog>
          )}
        </>
      )}
    </div>
  );
}

/** The section's open part, from the stores. Open, everything in the chat is seen: the heading's count goes. */
export function ChatContents({ operateOnly }: { operateOnly: boolean }) {
  const view = useChat((s) => s.view);
  const error = useChat((s) => s.error);
  const draft = useChat((s) => s.draft);
  const peopleOpen = useChat((s) => s.peopleOpen);
  const networkOn = useNetwork((s) => s.status?.state === 'listening');
  useEffect(() => {
    markChatSeen();
  }, [view?.messages]);
  return (
    <ChatContentsView
      view={view}
      operateOnly={operateOnly}
      networkOn={networkOn}
      error={error}
      draft={draft}
      onDraft={setChatDraft}
      peopleOpen={peopleOpen}
      onPeopleOpen={(open) => useChat.setState({ peopleOpen: open })}
    />
  );
}

/** The Chat section under LIVE (Simple Mode's too, while it is chosen). */
export function ChatSection() {
  const operateOnly = useOperateOnly();
  const unread = unreadWords(useChatUnread());
  const empty = useChat((s) => (s.view?.messages.length ?? 0) === 0);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    connectChat();
  }, []);
  return (
    <>
      <Panel
        help="chat"
        title="Chat"
        icon={MessagesSquare}
        {...LIVE_SECTION}
        remember="chat"
        // The whole section, folded or open, is blanked in Report a Problem's picture (a22-chat-core's ask), and its
        // open part again on its own (ChatContentsView).
        {...PRIVATE}
        data-testid="section-chat"
        bodyClassName="relative space-y-2 px-3 pb-3"
        badge={
          unread && (
            <Badge tone="info" className="ml-1" data-testid="chat-unread">
              <span aria-hidden="true">{unread.badge}</span>
              <span className="sr-only">{`, ${unread.words}`}</span>
            </Badge>
          )
        }
        actions={
          operateOnly ? undefined : (
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              disabled={empty}
              onClick={() => setClearing(true)}
              data-testid="chat-clear"
            >
              Clear chat
            </Button>
          )
        }
      >
        <ChatContents operateOnly={operateOnly} />
      </Panel>
      {clearing && (
        <ConfirmDialog
          title="Clear the chat?"
          confirmLabel="Clear chat"
          onCancel={() => setClearing(false)}
          onConfirm={() => {
            setClearing(false);
            void chatAction((chat) => chat.clear());
          }}
          testId="chat-clear-confirm"
        >
          <p>Today’s messages go, on this computer and on every phone in the chat. This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
