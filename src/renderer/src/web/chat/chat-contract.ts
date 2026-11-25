/*
 * STAND-IN for a22-chat-core's shared contract, src/shared/chat.ts (QA23-CHAT-1), in the brief's shape, until core's
 * commit is on the board. When core's routes are merged this file only re-exports that contract.
 */

/** A person in the chat: a paired phone (its pairing's id), or the computer's operator. */
export interface ChatPerson {
  id: string;
  name: string;
}

/** One message: who sent it, when (ms since the epoch, Drashti's clock), and its words. */
export interface ChatMessage {
  id: string;
  at: number;
  from: ChatPerson;
  text: string;
}

/** The day's chat on the Drashti computer: its messages, oldest first, and who is in it. */
export interface ChatState {
  day: string;
  messages: ChatMessage[];
  people: ChatPerson[];
}

/** A message's words at most (UTF-16 units, as a text box's maxLength counts them). */
export const CHAT_TEXT_MAX = 500;
/** A person's name at most. */
export const CHAT_NAME_MAX = 40;
