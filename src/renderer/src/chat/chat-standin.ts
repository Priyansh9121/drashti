/*
 * A stand-in for a22-chat-core's contract (src/shared/chat.ts), in the shape of its draft (11:2x), until it lands: the
 * operator's Chat section is built against it, and it goes when the contract is merged.
 */

export interface ChatPerson {
  id: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  /** When Drashti took it (an ISO time). */
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

export type ChatDeviceKind = 'remote' | 'announcements' | 'chat';

export interface ChatMember extends ChatPerson {
  kind: ChatDeviceKind;
  connected: boolean;
}

export interface ChatInvite {
  code: string;
  url: string;
  expiresAt: number;
}

export interface ChatOperatorView extends ChatState {
  members: ChatMember[];
  invite: ChatInvite | null;
  reachable: boolean;
}

export type ChatResult = { ok: true; view: ChatOperatorView } | { ok: false; message: string };

/** A message's words, at most (UTF-16 units, as a text box's maxLength counts). */
export const CHAT_TEXT_MAX = 500;
/** At most this many lines in a message. */
export const CHAT_LINES_MAX = 20;

/** Who the operator is in the chat. */
export const OPERATOR_ID = 'operator';
