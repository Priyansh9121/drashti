import type { ChatMessage } from './chat-standin';

/*
 * The operator's Chat section's words and counts (QA23-CHAT-1), apart from the window. Red: not built yet.
 */

export interface ChatRow {
  id: string;
  mine: boolean;
  name: string | null;
  sender: string;
  time: string;
  text: string;
}

export function chatRows(
  _messages: readonly ChatMessage[],
  _meId: string,
  _timeOf: (at: string) => string,
): ChatRow[] {
  return [];
}

export function unreadCount(_messages: readonly ChatMessage[], _seenId: string | null, _meId: string): number {
  return -1;
}

export function unreadWords(_count: number): { badge: string; words: string } | null {
  return null;
}

export function composerCheck(_text: string): { canSend: boolean; line: string | null } {
  return { canSend: true, line: 'not built' };
}
