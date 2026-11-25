import type { ChatMessage } from './chat-standin';
import { CHAT_LINES_MAX, CHAT_TEXT_MAX } from './chat-standin';

/*
 * The operator's Chat section's words and counts (QA23-CHAT-1), apart from the window: the day's messages as a
 * WhatsApp group shows them (the sender's name above the first of each run of theirs, the operator's own on the right
 * with no name), how many came in from others since the operator last looked, and what the text box says before Send.
 * The main process keeps the chat and checks every message again (its limits are the ones that count).
 */

export interface ChatRow {
  id: string;
  /** The operator's own (on the right). */
  mine: boolean;
  /** The sender's name above it: on the first of a run of someone else's, otherwise none. */
  name: string | null;
  /** Who sent it, for a screen reader, named above it or not ("You" for the operator's own). */
  sender: string;
  /** When it was sent, as this computer's clock says it. */
  time: string;
  text: string;
}

/** A time of day the way this computer says it (hours and minutes). */
export function clockTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The day's messages as rows, in the order they came (newest last). */
export function chatRows(
  messages: readonly ChatMessage[],
  meId: string,
  timeOf: (at: string) => string = clockTime,
): ChatRow[] {
  return messages.map((m, i) => {
    const mine = m.from.id === meId;
    // The same sender as the one before: one run, named once (by who sent it: two people may share a name).
    const run = i > 0 && messages[i - 1]?.from.id === m.from.id;
    return {
      id: m.id,
      mine,
      name: mine || run ? null : m.from.name,
      sender: mine ? 'You' : m.from.name,
      time: timeOf(m.at),
      text: m.text,
    };
  });
}

/**
 * How many came from others after the last one the operator saw (`seenId`): all of others' when none was seen, or the
 * one seen is gone (Clear chat, or a new day). The operator's own never count.
 */
export function unreadCount(messages: readonly ChatMessage[], seenId: string | null, meId: string): number {
  const seen = seenId === null ? -1 : messages.findIndex((m) => m.id === seenId);
  return messages.slice(seen + 1).filter((m) => m.from.id !== meId).length;
}

/** The count on the section's heading (small) and in words for a screen reader; none, nothing. */
export function unreadWords(count: number): { badge: string; words: string } | null {
  if (count <= 0) return null;
  return {
    badge: count > 99 ? '99+' : String(count),
    words: `${String(count)} new ${count === 1 ? 'message' : 'messages'}`,
  };
}

/**
 * A message's words as Main keeps them, near enough to count them before Send: the spaces at the ends of each line and
 * of the whole trimmed. (Main cleans them fully and checks again: its limits are the ones that count.)
 */
const kept = (text: string): string =>
  text
    .split(/\r\n?|\n/u)
    .map((line) => line.trim())
    .join('\n')
    .trim();

/** How near the limit the box starts saying how many are left. */
const NEAR = 50;

const characters = (n: number) => `${String(n)} ${n === 1 ? 'character' : 'characters'}`;

/**
 * Whether the text box's words can be sent, and the line under it: how many are left near the limit, or how many too
 * many past it (the words stay in the box, whole, for the operator to shorten). Counted as Main counts them: in UTF-16
 * units, as a text box's maxLength does (an emoji is two).
 */
export function composerCheck(text: string): { canSend: boolean; line: string | null } {
  const words = kept(text);
  if (words === '') return { canSend: false, line: null };
  if (words.split('\n').length > CHAT_LINES_MAX)
    return { canSend: false, line: `${String(CHAT_LINES_MAX)} lines at most` };
  if (words.length > CHAT_TEXT_MAX)
    return {
      canSend: false,
      line: `${characters(words.length - CHAT_TEXT_MAX)} too many: ${String(CHAT_TEXT_MAX)} at most`,
    };
  const left = CHAT_TEXT_MAX - words.length;
  return { canSend: true, line: left <= NEAR ? `${characters(left)} left` : null };
}
