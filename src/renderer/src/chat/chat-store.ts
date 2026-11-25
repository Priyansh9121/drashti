import { create } from 'zustand';
import type { ChatOperatorView, ChatResult } from './chat-standin';
import { OPERATOR_ID } from './chat-standin';
import { unreadCount } from './chat-view';

/*
 * The chat as the operator window sees it (QA23-CHAT-1): the main process's view of the day's chat (read once, then
 * told of every change), the newest message the operator has seen (the section open), and the last refusal. The main
 * process keeps the chat, checks every request and says no in plain words; the window only shows.
 */

/** The main process's chat requests, as the preload gives them (a22-chat-core). */
interface ChatBridge {
  view(): Promise<ChatOperatorView>;
  onChanged(listener: (view: ChatOperatorView) => void): () => void;
  send(text: string): Promise<ChatResult>;
  clear(): Promise<ChatResult>;
  showInvite(): Promise<ChatResult>;
  cancelInvite(): Promise<ChatResult>;
}

// The stand-in's way to the bridge until a22-chat-core's preload lands (then window.drashti.chat, typed).
const bridge = (): ChatBridge | null =>
  (window.drashti as unknown as { chat?: ChatBridge }).chat ?? null;

interface ChatWindow {
  view: ChatOperatorView | null;
  /** The newest message seen with the section open; what the unread count counts after. */
  seen: string | null;
  error: string | null;
}

export const useChat = create<ChatWindow>(() => ({ view: null, seen: null, error: null }));

const newest = (view: ChatOperatorView | null): string | null => view?.messages.at(-1)?.id ?? null;

let connected = false;

/**
 * Read the chat once and follow its changes (once per window). What was already there as the window opens counts as
 * seen (the section shows it all when opened); what comes after it counts until the section is open.
 */
export function connectChat(): void {
  if (connected) return;
  const chat = bridge();
  if (!chat) return;
  connected = true;
  // A change told before the first read is answered is newer than that answer.
  let told = false;
  chat.onChanged((view) => {
    told = true;
    useChat.setState({ view });
  });
  void chat.view().then(
    (view) => {
      useChat.setState((s) => ({ view: told ? s.view : view, seen: s.seen ?? newest(view) }));
    },
    () => undefined,
  );
}

/** Everything in the chat now counts as seen (the section is open). */
export function markChatSeen(): void {
  const id = newest(useChat.getState().view);
  if (id !== null && useChat.getState().seen !== id) useChat.setState({ seen: id });
}

/** How many came from others since the operator last had the section open. */
export const useChatUnread = (): number =>
  useChat((s) => (s.view ? unreadCount(s.view.messages, s.seen, OPERATOR_ID) : 0));

/** Run a request; its view, or its refusal shown in the section. */
export async function chatAction(run: (chat: ChatBridge) => Promise<ChatResult>): Promise<ChatResult> {
  const chat = bridge();
  if (!chat) return { ok: false, message: 'The chat is not ready yet.' };
  const result = await run(chat);
  useChat.setState(result.ok ? { view: result.view, error: null } : { error: result.message });
  return result;
}

export function clearChatError(): void {
  useChat.setState({ error: null });
}
