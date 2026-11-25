/*
 * A stand-in for a22-chat-core's contract (src/shared/chat.ts), in the brief's shape, until it lands: the operator's
 * Chat section is built against it, and it goes when the contract is merged.
 */

export interface ChatPerson {
  id: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  /** When it was sent (an ISO time). */
  at: string;
  from: ChatPerson;
  text: string;
}

export interface ChatState {
  /** The day the chat is for (YYYY-MM-DD, this computer's day). */
  day: string;
  messages: ChatMessage[];
  people: ChatPerson[];
}

export type ChatResult = { ok: true; state: ChatState } | { ok: false; message: string };

/** A message's words, at most this long. */
export const CHAT_TEXT_MAX = 500;

/** Who the operator is in the chat. */
export const OPERATOR_ID = 'operator';
