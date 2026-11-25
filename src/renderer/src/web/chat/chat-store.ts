import { create } from 'zustand';
import {
  CHAT_API,
  CHAT_REFUSAL,
  type ChatEvent,
  type ChatMessage,
  type ChatPhoneView,
} from '../../../../shared/chat';
import { api } from '../device';
import { followChat, onChatEvent, onOnline } from '../feed';
import { oneAtATime } from '../one-at-a-time';
import { alertNewMessage, armAlerts } from './chat-alert';
import { keepChatName, keptChatName } from './chat-name';
import { chatNameProblem, chatTextProblem, newFromOthers, tidyChatName, unreadStill } from './chat-words';

/*
 * The phone's chat (QA23-CHAT-1): the day's group chat of everyone paired with this Drashti computer, kept by Drashti
 * (Main checks who may read and post, the sizes and the rate: shared/chat.ts). The page reads the whole day's chat
 * when it opens and again each time the feed is back online or the phone wakes, so it catches up on what came
 * meanwhile; in between the feed brings each message, the people and Clear chat as they happen. A message from
 * someone else that arrives while the page is shown buzzes or sounds (chat-alert.ts); one not seen yet (the chat not
 * in view) is unread and shows a banner. The name, given once, is kept on the phone and given to Drashti again
 * whenever Drashti does not have it (after a restart, the next day).
 */

interface ChatView {
  /** The day's chat as last read and told (null until the first read is in). */
  chat: ChatPhoneView | null;
  /** This phone in the chat (its own messages are on the right), as Drashti says. */
  me: string | null;
  /** The name this phone gave (asked once), or null. */
  name: string | null;
  /** Why the last read, name or send did not work, in Drashti's or the page's words. */
  problem: string | null;
  sending: boolean;
  /** Messages from others not seen yet, by id. */
  unread: string[];
  /** The newest of them, shown in a banner until seen or put away. */
  banner: ChatMessage | null;
  /** The chat is on the screen now (its tab, its side or its page open, and the page shown). */
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

const shown = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * Messages from others that came: unread with a banner while the chat is not in view, and (`live`: told by the feed
 * while the page is shown) a buzz or a sound.
 */
function heard(news: readonly ChatMessage[], live: boolean): void {
  const newest = news.at(-1);
  if (!newest) return;
  if (!useChat.getState().inView)
    useChat.setState((s) => ({ unread: [...s.unread, ...news.map((m) => m.id)], banner: newest }));
  if (live && shown()) alertNewMessage();
}

/** The chat as Drashti has it now: what is new in it is heard (never with a buzz: it is a catch-up). */
function took(view: ChatPhoneView): void {
  const { chat: before, unread, banner } = useChat.getState();
  const news = newFromOthers(before?.messages ?? null, view.messages, view.you.id);
  useChat.setState({
    chat: view,
    me: view.you.id,
    unread: unreadStill(unread, view.messages),
    banner: banner && view.messages.some((m) => m.id === banner.id) ? banner : null,
  });
  heard(news, false);
}

/** Give Drashti this phone's name; null when taken, or why not in Drashti's words. */
async function giveName(name: string): Promise<string | null> {
  const answer = await api<{ chat: ChatPhoneView }>(CHAT_API.name, { method: 'POST', body: { name } });
  if (!answer.ok) return answer.message;
  took(answer.chat);
  return null;
}

/** Events told before the first read is in (the read may have been answered before them): read once more. */
const early = { told: false };
// Read as it is after the awaits (set by told() meanwhile).
const toldEarly = () => early.told;

/** One read at a time, and one more if asked meanwhile (one-at-a-time.ts). */
const read = oneAtATime(async () => {
  early.told = false;
  const answer = await api<{ chat: ChatPhoneView }>(CHAT_API.read);
  if (!answer.ok) {
    useChat.setState({ problem: answer.message });
    return;
  }
  useChat.setState({ problem: null });
  took(answer.chat);
  // The name kept on this phone, given again when Drashti has none (or another): asked once, never again.
  const { name } = useChat.getState();
  if (name !== null && answer.chat.you.name !== name) {
    const wrong = await giveName(name);
    if (wrong) useChat.setState({ problem: wrong });
  }
  if (toldEarly()) void read();
});

/** A chat event from the feed, as it happens. */
function told(event: ChatEvent): void {
  const { chat } = useChat.getState();
  if (!chat) {
    early.told = true;
    return;
  }
  switch (event.kind) {
    case 'message': {
      const m = event.message;
      if (chat.messages.some((had) => had.id === m.id)) return;
      useChat.setState({ chat: { ...chat, messages: [...chat.messages, m] } });
      if (m.from.id !== chat.you.id) heard([m], true);
      return;
    }
    case 'people':
      useChat.setState({ chat: { ...chat, people: event.people } });
      return;
    case 'cleared':
      useChat.setState({ chat: { ...chat, day: event.day, messages: [] }, unread: [], banner: null });
      // Who is in it, and this phone's name, as Drashti has them after it (a new day starts without names).
      void read();
      return;
  }
}

let started = false;

/** Follow the day's chat on this page (once). */
export function startChat(): void {
  if (started) return;
  started = true;
  useChat.setState({ name: keptChatName() });
  followChat();
  armAlerts();
  onChatEvent(told);
  onOnline(() => {
    void read();
  });
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void read();
    });
  void read();
}

/** Give (or change) this phone's name: null when Drashti took it (then kept on the phone), or why not. */
export async function setChatName(name: string): Promise<string | null> {
  const problem = chatNameProblem(name);
  if (problem) return problem;
  const tidy = tidyChatName(name);
  const wrong = await giveName(tidy);
  if (wrong) return wrong;
  keepChatName(tidy);
  useChat.setState({ name: tidy, problem: null });
  return null;
}

/** Send a message as this phone's person; true when Drashti took it (the text box is then emptied). */
export async function sendChat(text: string): Promise<boolean> {
  const { name, sending } = useChat.getState();
  if (sending) return false;
  const problem = name === null ? CHAT_REFUSAL.noName : chatTextProblem(text);
  if (problem) {
    useChat.setState({ problem });
    return false;
  }
  useChat.setState({ sending: true, problem: null });
  try {
    const answer = await api<{ message: ChatMessage }>(CHAT_API.send, { method: 'POST', body: { text } });
    if (!answer.ok) {
      useChat.setState({ problem: answer.message });
      return false;
    }
    // Shown at once; the feed's copy of the same message is then shown once (told() knows it by its id).
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

/** Red: not built yet. */
export const ALERT_GAP_MS = 5000;
export function chatShowOnScreen(_on: boolean): void {
  return;
}

/** Put the banner away; its message stays unread until the chat is seen. */
export function dismissBanner(): void {
  useChat.setState({ banner: null });
}
