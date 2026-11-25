import { useEffect, useState } from 'react';
import { Mark } from '../../ui/Mark';
import { Notice } from '../../ui/Notice';
import { ConnectionChip } from '../Connection';
import { api, current, forgetPairing, keepPairing } from '../device';
import { startFeed, useFeed } from '../feed';
import { PhoneStopped } from '../Stopped';
import { type ChatPageStart, startChatPage } from './chat-page-start';
import { startChat } from './chat-store';
import { ChatPanel } from './ChatView';

/*
 * The chat page (QA23-CHAT-1, at /chat): what a phone that scanned the pairing dialog's "Chat" QR opens, a chat-only
 * device that reads and writes the day's chat and nothing else. Any phone in the chat may open it too (a Remote has
 * the same chat on its Chat tab). One screen: the header, the messages scrolling, and the text box under them.
 */

/** Once per page load, whatever React does with its effects: a code from the QR pairs at most once. */
let starting: Promise<ChatPageStart> | null = null;
function startOnce(): Promise<ChatPageStart> {
  starting ??= startChatPage({
    hash: location.hash,
    clearHash: () => {
      history.replaceState(null, '', location.pathname + location.search);
    },
    current,
    keep: keepPairing,
    forget: forgetPairing,
    api,
  });
  return starting;
}

export function ChatApp() {
  const [start, setStart] = useState<ChatPageStart | null>(null);
  const device = useFeed((s) => s.device);
  useEffect(() => {
    void startOnce().then((s) => {
      if (s.kind === 'pair') location.replace('/pair');
      else if (s.kind === 'elsewhere') location.replace(s.page);
      else {
        if (s.kind === 'ready') {
          startFeed();
          startChat();
        }
        setStart(s);
      }
    });
  }, []);
  return (
    <div className="flex h-dvh flex-col bg-ink" data-testid="chat-page">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-3">
        <Mark size={36} />
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold tracking-wide text-fg">Drashti chat</h1>
          <p className="truncate text-base text-muted">{device?.name ?? current()?.name ?? ''}</p>
        </div>
        {start?.kind === 'ready' && <ConnectionChip />}
      </header>
      <main className="relative min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {start === null ? (
          <p role="status" className="text-base text-muted">
            Opening the chat…
          </p>
        ) : start.kind === 'refused' ? (
          <div className="space-y-4" data-testid="chat-refused">
            <Notice tone="warning">{start.message}</Notice>
            <p className="text-base text-fg">
              Ask the operator to show the Chat QR code again, then scan it, or{' '}
              <a className="text-accent underline" href="/pair">
                pair this phone with a code
              </a>
              .
            </p>
          </div>
        ) : (
          <ChatPanel fill />
        )}
      </main>
      <PhoneStopped />
    </div>
  );
}
