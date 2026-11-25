import { CHAT_REFUSAL, type ChatMessage, chatNameSchema, chatTextSchema } from '../../../../shared/chat';
import { cleanRenameName } from '../../../../shared/rename-name';

/*
 * The phone's chat (QA23-CHAT-1), its rules before anything is sent: a name and a message checked by the contract's
 * own rules (shared/chat.ts), so the page says what Main would say, in its words, without asking (Main checks them
 * again and has the last word); and which messages are news to this phone.
 */

/** A name as Drashti keeps it (cleaned as Rename… cleans a name). */
export const tidyChatName = (name: string): string => cleanRenameName(name);

/** What is wrong with a name, in Drashti's words, or null. */
export function chatNameProblem(name: string): string | null {
  return chatNameSchema.safeParse(name).success ? null : CHAT_REFUSAL.name;
}

/** What is wrong with a message's words, in Drashti's words, or null. */
export function chatTextProblem(text: string): string | null {
  const checked = chatTextSchema.safeParse(text);
  if (checked.success) return null;
  return checked.error.issues[0]?.message ?? CHAT_REFUSAL.empty;
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
