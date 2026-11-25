import type { ChatMessage } from './chat-contract';

// Red: not built yet (QA23-CHAT-1).
export const tidyChatName = (name: string): string => name;
export const chatNameProblem = (_name: string): string | null => null;
export const chatTextProblem = (_text: string): string | null => null;
export const newFromOthers = (
  _before: readonly ChatMessage[] | null,
  _after: readonly ChatMessage[],
  _me: string | null,
): ChatMessage[] => [];
export const unreadStill = (_unread: readonly string[], _messages: readonly ChatMessage[]): string[] => [];
