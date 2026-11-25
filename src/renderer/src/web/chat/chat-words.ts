import { CHAT_NAME_MAX, CHAT_TEXT_MAX, type ChatMessage } from './chat-contract';

/*
 * The phone's chat (QA23-CHAT-1), its rules in words before anything is sent: a name and a message as the page checks
 * them (Main checks them again and has the last word), and which messages are news to this phone.
 */

/** A name as the chat keeps it: one space between words, none at its ends. */
export const tidyChatName = (name: string): string => name.replace(/\s+/gu, ' ').trim();

/** What is wrong with a name, in plain words, or null. */
export function chatNameProblem(name: string): string | null {
  const tidy = tidyChatName(name);
  if (tidy === '') return 'Type your name first.';
  if (tidy.length > CHAT_NAME_MAX) return `A name is ${String(CHAT_NAME_MAX)} letters at most.`;
  return null;
}

/** What is wrong with a message's words, in plain words, or null. Counted as the text box counts them. */
export function chatTextProblem(text: string): string | null {
  if (text.trim() === '') return 'Type a message first.';
  if (text.length > CHAT_TEXT_MAX)
    return `A message is ${String(CHAT_TEXT_MAX)} characters at most (this one is ${String(text.length)}).`;
  return null;
}

/**
 * The messages in `after` that were not in `before`, from anyone but this phone (`me`), oldest first. None on the
 * first read (`before` null): the day's history is not news.
 */
export function newFromOthers(
  before: readonly ChatMessage[] | null,
  after: readonly ChatMessage[],
  me: string | null,
): ChatMessage[] {
  if (before === null) return [];
  const known = new Set(before.map((m) => m.id));
  return after.filter((m) => !known.has(m.id) && m.from.id !== me);
}

/** The unread messages still in the chat (the operator's Clear chat, or the next day, takes them away). */
export function unreadStill(unread: readonly string[], messages: readonly ChatMessage[]): string[] {
  const there = new Set(messages.map((m) => m.id));
  return unread.filter((id) => there.has(id));
}
