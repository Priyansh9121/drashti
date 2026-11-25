import { create } from 'zustand';
import { CHAT_API, type ChatMessage, type ChatPhoneView } from '../../../../shared/chat';
import { api } from '../device';
import { onChatEvent, onOnline } from '../feed';
import { oneAtATime } from '../one-at-a-time';
import { alertNewMessage, armAlerts } from './chat-alert';
import { keepChatName, keptChatName } from './chat-name';
import { chatNameProblem, chatTextProblem, newFromOthers, tidyChatName, unreadStill } from './chat-words';

/*
 * The phone's chat (QA23-CHAT-1): the day's group chat of everyone paired with this Drashti computer, kept by Drashti
 * (Main checks who may read and post, the sizes and the rate). The page reads the whole day's chat when it opens,
 * again each time Drashti says it changed, and again when the phone wakes or its connection comes back, so it
 * catches up on what came meanwhile. A message from someone else that arrives while the page is shown buzzes or
 * sounds (chat-alert.ts); one not seen yet (the chat not in view) is unread and shows a banner.
 */

interface ChatView {
  /** The day's chat as last read (null until the first read is in). */
  chat: ChatPhoneView | null;
  /** This phone in the chat (its own messages are on the right), as Drashti says. */
  me: string | null;
  /** The name this phone gave (asked once), or null. */
  name: string | null;
  /** Why the last read or send did not work, in Drashti's or the page's words. */
  problem: string | null;
  sending: boolean;
  /** Messages from others not seen yet, by id. */
  unread: string[];
  /** The newest of them, shown in a banner until seen or put away. */
  banner: ChatMessage | null;
  /** The chat is on the screen now (its tab or side open). */
  inView: boolean;
}

export const useChat = create<ChatView>(() => ({
  chat: null,
  me: null,
  name: null,
  problem: null,
  sending: false,
  unread: [],
  banner: null,
  inView: false,
}));

const PATH = CHAT_API.read;

const shown = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible';

/** A change Drashti told of while the page was shown: what it brings buzzes or sounds. */
let live = false;

/** One read at a time, and one more if asked meanwhile (one-at-a-time.ts). */
const read = oneAtATime(async () => {
  const alerting = live && shown();
  live = false;
  const answer = await api<{ chat: ChatPhoneView }>(PATH);
  if (!answer.ok) {
    useChat.setState({ problem: answer.message });
    return;
  }
  const { chat: before, unread, banner, inView } = useChat.getState();
  // A message this phone sent and already shows (sendChat) is the same message: Drashti's copy replaces it.
  const news = newFromOthers(before?.messages ?? null, answer.chat.messages, answer.chat.you.id);
  const still = unreadStill(unread, answer.chat.messages);
  const newest = news.at(-1) ?? null;
  const bannerStill = banner && answer.chat.messages.some((m) => m.id === banner.id) ? banner : null;
  useChat.setState({
    chat: answer.chat,
    me: answer.chat.you.id,
    problem: null,
    unread: inView ? [] : [...still, ...news.map((m) => m.id)],
    banner: inView ? null : (newest ?? bannerStill),
  });
  if (alerting && newest) alertNewMessage();
});

/** Read the chat again: `told` when Drashti said it changed (live), otherwise a catch-up. */
function readAgain(told: boolean): void {
  if (told) live = true;
  void read();
}

let started = false;

/** Follow the day's chat on this page (once). */
export function startChat(): void {
  if (started) return;
  started = true;
  useChat.setState({ name: keptChatName() });
  armAlerts();
  onChatEvent(() => undefined);
  onOnline(() => {
    readAgain(false);
  });
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') readAgain(false);
    });
  readAgain(false);
}

/** Give (or change) this phone's name: null when kept, or what is wrong with it. */
export function setChatName(name: string): string | null {
  const problem = chatNameProblem(name);
  if (problem) return problem;
  keepChatName(name);
  useChat.setState({ name: tidyChatName(name), problem: null });
  return null;
}

/** Send a message as this phone's person; true when Drashti took it (the text box is then emptied). */
export async function sendChat(text: string): Promise<boolean> {
  const { name, sending } = useChat.getState();
  if (sending) return false;
  const problem = name === null ? 'Type your name first.' : chatTextProblem(text);
  if (problem || name === null) {
    useChat.setState({ problem });
    return false;
  }
  useChat.setState({ sending: true, problem: null });
  try {
    const answer = await api<{ message: ChatMessage }>(PATH, { method: 'POST', body: { text, name } });
    if (!answer.ok) {
      useChat.setState({ problem: answer.message });
      return false;
    }
    const sent = answer.message;
    useChat.setState((s) => ({
      me: s.me ?? sent.from.id,
      chat:
        s.chat && !s.chat.messages.some((m) => m.id === sent.id)
          ? { ...s.chat, messages: [...s.chat.messages, sent] }
          : s.chat,
    }));
    return true;
  } finally {
    useChat.setState({ sending: false });
  }
}

/** The chat came into view (or left it): seen, it has nothing unread and no banner. */
export function chatInView(on: boolean): void {
  useChat.setState(on ? { inView: true, unread: [], banner: null } : { inView: false });
}

/** Put the banner away; its message stays unread until the chat is seen. */
export function dismissBanner(): void {
  useChat.setState({ banner: null });
}
