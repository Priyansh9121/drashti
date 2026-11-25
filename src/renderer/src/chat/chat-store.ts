import { create } from 'zustand';
import type { ChatOperatorView, ChatResult } from '../../../shared/chat';
import { CHAT_OPERATOR_ID } from '../../../shared/chat';
import type { DrashtiBridge } from '../../../shared/bridge';
import { unreadCount } from './chat-view';

/*
 * The chat as the operator window sees it (QA23-CHAT-1): the main process's view of the day's chat (read once, then
 * told of every change), the newest message the operator has seen (the section open), and the last refusal. The main
 * process keeps the chat, checks every request and says no in plain words; the window only shows.
 */

interface ChatWindow {
  view: ChatOperatorView | null;
  /** The newest message seen with the section open; what the unread count counts after. */
  seen: string | null;
  error: string | null;
  /** The text box's words not sent yet: kept while the section folds, and through Report a Problem's picture. */
  draft: string;
  /** People in the chat, opened under the text box. */
  peopleOpen: boolean;
}

export const useChat = create<ChatWindow>(() => ({
  view: null,
  seen: null,
  error: null,
  draft: '',
  peopleOpen: false,
}));

const newest = (view: ChatOperatorView | null): string | null => view?.messages.at(-1)?.id ?? null;

let connected = false;

/**
 * Read the chat once and follow its changes (once per window). What was already there as the window opens counts as
 * seen (the section shows it all when opened); what comes after it counts until the section is open.
 */
export function connectChat(): void {
  if (connected) return;
  connected = true;
  // A change told before the first read is answered is newer than that answer.
  let told = false;
  window.drashti.chat.onChanged((view) => {
    told = true;
    useChat.setState({ view });
  });
  void window.drashti.chat.view().then(
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
  useChat((s) => (s.view ? unreadCount(s.view.messages, s.seen, CHAT_OPERATOR_ID) : 0));

/** Run a request; its view, or its refusal shown where it was asked (`error`). */
export async function chatAction(
  run: (chat: DrashtiBridge['chat']) => Promise<ChatResult>,
): Promise<ChatResult> {
  const result = await run(window.drashti.chat);
  useChat.setState(result.ok ? { view: result.view, error: null } : { error: result.message });
  return result;
}

export function clearChatError(): void {
  useChat.setState({ error: null });
}

/** The text box's words, as typed (a refusal shown goes as the words change). */
export function setChatDraft(draft: string): void {
  useChat.setState({ draft, error: null });
}
