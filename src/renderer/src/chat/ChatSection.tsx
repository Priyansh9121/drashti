import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog } from '../ui/Dialog';
import { Textarea } from '../ui/Field';
import { ChevronDown, ChevronRight, MessagesSquare, Send, Trash2 } from '../ui/icons';
import { LIVE_SECTION, Panel } from '../ui/Panel';
import { EmptyState, Loading } from '../ui/States';
import { useNetwork } from '../network/network-store';
import { useOperateOnly } from '../simple/simple-features-store';
import { ChatList } from './ChatList';
import type { ChatMember, ChatOperatorView } from '../../../shared/chat';
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
import { chatRows, composerCheck, unreadWords } from './chat-view';

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

/** What Report a Problem's picture of the window blanks (the chat's words and names). */
const PRIVATE = { [REPORT_PRIVATE_ATTR]: '' };

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
  canRemove: boolean;
  onRemove: (member: ChatMember) => void;
}) {
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
          <p className="text-xs text-muted">
            No one yet: a phone joins when its person gives their name on its chat page.
          </p>
        ) : (
          <ul className="space-y-1" data-testid="chat-people-list">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-1"
                data-testid="chat-person"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm break-words text-fg [overflow-wrap:anywhere]">{m.name}</span>
                  <span className="block text-xs text-muted">
                    {KIND_WORDS[m.kind]} · {m.connected ? 'Connected' : 'Not connected'}
                  </span>
                </span>
                {canRemove && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    aria-label={`Remove ${m.name} from the chat`}
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

/** The text box and Send: Enter sends, Shift+Enter starts a new line. Its words are kept in the store (`draft`). */
function Composer({ draft, onDraft }: { draft: string; onDraft: (text: string) => void }) {
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const check = composerCheck(draft);
  const lineId = useId();
  const send = async () => {
    if (!check.canSend || sending) return;
    setSending(true);
    const result = await chatAction((chat) => chat.send(draft));
    setSending(false);
    if (result.ok) onDraft('');
    box.current?.focus();
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
          aria-describedby={check.line === null ? undefined : lineId}
          aria-invalid={!check.canSend && check.line !== null ? true : undefined}
          placeholder="Write a message"
          rows={2}
          value={draft}
          onChange={(e) => {
            onDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
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
      {check.line !== null && (
        <p
          id={lineId}
          className={cx('text-xs', check.canSend ? 'text-muted' : 'text-warning-fg')}
          data-testid="chat-composer-line"
        >
          {check.line}
        </p>
      )}
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
      // It scrolls on its own, so the text box under it stays in reach; reached by the keyboard while it scrolls.
      className="max-h-[40vh] overflow-y-auto pr-1"
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
          {view.messages.length === 0 ? <ChatEmpty operateOnly={operateOnly} /> : <Messages view={view} />}
          <Composer draft={draft} onDraft={onDraft} />
          {error !== null && (
            <p role="alert" className="text-xs text-warning-fg" data-testid="chat-problem">
              {error}
            </p>
          )}
          <ChatPeople
            members={view.members}
            open={peopleOpen}
            onOpen={onPeopleOpen}
            canRemove={!operateOnly}
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
                  {removing.name}
                </span>
                ’s phone is cut off at once, from the chat and from anything else it does with Drashti. To
                come back, it is paired again.
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
