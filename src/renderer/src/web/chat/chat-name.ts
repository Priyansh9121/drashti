import { chatNameProblem, tidyChatName } from './chat-words';

/*
 * The person's name in the chat, asked once and kept on that phone (QA23-CHAT-1): in the browser's storage for this
 * address, beside the pairing (device.ts), never in a cookie. Where the browser keeps nothing (private browsing), it
 * lasts until the page is closed.
 */

const KEY = 'drashti.chat.name';

let memory: string | null = null;

/** The name this phone gave, or null until it gives one. */
export function keptChatName(): string | null {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept !== null) return chatNameProblem(kept) === null ? tidyChatName(kept) : null;
  } catch {
    // Storage refused: the page's own copy.
  }
  return memory;
}

/** Keep the name (tidied) on this phone. */
export function keepChatName(name: string): void {
  const tidy = tidyChatName(name);
  memory = tidy;
  try {
    localStorage.setItem(KEY, tidy);
  } catch {
    // Private browsing without storage: it works until the page is closed.
  }
}
