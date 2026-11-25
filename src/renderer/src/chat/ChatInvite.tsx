import { useEffect, useState } from 'react';
import type { ChatInvite } from '../../../shared/chat';
import type { NetworkStatus } from '../../../shared/network';
import { Button } from '../ui/Button';
import { MessagesSquare } from '../ui/icons';
import { SectionTitle } from '../ui/Panel';
import { useNow } from '../render/useNow';
import { QrCode } from '../network/QrCode';
import { connectChat, useChat } from './chat-store';

/*
 * The pairing dialog's "Chat" QR (alpha.23, QA23-CHAT-1; the owner: "a few people scan and a group is created"): shown
 * for a while (shared/chat.ts CHAT_INVITE_TTL_MS), it lets more people into the chat, each phone that scans it paired
 * by itself as a chat-only device (it reads and writes the chat, and nothing else). Pro Mode's, as pairing is.
 */

const minutes = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;

/** What the section shows: the button, or the code and how long it still works; refusals in plain words. */
export function ChatInviteView({
  invite,
  listening,
  now,
  problem,
  onShow,
  onEnd,
}: {
  invite: ChatInvite | null;
  listening: boolean;
  now: number;
  problem: string | null;
  onShow: () => void;
  onEnd: () => void;
}) {
  const left = invite ? Math.max(0, Math.ceil((invite.expiresAt - now) / 1000)) : 0;
  const shown = invite !== null && left > 0;
  return (
    <section className="space-y-3" data-testid="chat-invite">
      <SectionTitle>Chat</SectionTitle>
      {!listening ? (
        <p className="text-sm text-muted">Turn the network on to show the Chat QR code.</p>
      ) : shown ? (
        <div className="flex flex-wrap items-center gap-4">
          <QrCode text={invite.url} label="QR code that joins the chat" />
          <div className="min-w-0 space-y-2">
            <p className="text-sm text-muted">
              Let each phone scan it with its camera: each joins the chat only, and runs nothing on the
              screens.
            </p>
            <p className="text-xs text-muted" aria-live="off" data-testid="chat-invite-left">
              Works for {minutes(left)} more, for every phone that scans it. Each is paired for today only.
            </p>
            <Button onClick={onEnd} data-testid="chat-invite-end">
              Stop the Chat QR code
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            Everyone paired as a Remote or for Announcements is in the chat already. For more people, show a
            QR code for the chat: each phone that scans it joins the chat only, and its person gives their
            name there.
          </p>
          <Button icon={MessagesSquare} onClick={onShow} data-testid="chat-invite-show">
            Show the Chat QR code
          </Button>
        </>
      )}
      {problem !== null && (
        <p role="alert" className="text-sm text-warning-fg">
          {problem}
        </p>
      )}
    </section>
  );
}

/** The Chat QR in the Phones panel, as the main process has it (the chat's view, or the network's status). */
export function ChatInviteSection({ status }: { status: NetworkStatus }) {
  const now = useNow(1000);
  const fromChat = useChat((s) => s.view?.invite);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    connectChat();
  }, []);
  const ask = (run: () => ReturnType<typeof window.drashti.chat.invite>) => {
    void run().then((r) => {
      if (r.ok) useChat.setState({ view: r.view });
      setProblem(r.ok ? null : r.message);
    });
  };
  return (
    <ChatInviteView
      invite={fromChat === undefined ? (status.chatInvite ?? null) : fromChat}
      listening={status.state === 'listening'}
      now={now}
      problem={problem}
      onShow={() => ask(() => window.drashti.chat.invite())}
      onEnd={() => ask(() => window.drashti.chat.endInvite())}
    />
  );
}
