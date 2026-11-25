import { create } from 'zustand';
import type { ChatMessage, ChatState } from './chat-contract';

// Red: not built yet (QA23-CHAT-1).
interface ChatView {
  chat: ChatState | null;
  me: string | null;
  name: string | null;
  problem: string | null;
  sending: boolean;
  unread: string[];
  banner: ChatMessage | null;
}
export const useChat = create<ChatView>(() => ({
  chat: null,
  me: null,
  name: null,
  problem: null,
  sending: false,
  unread: [],
  banner: null,
}));
export const startChat = (): void => undefined;
export const sendChat = (_text: string): Promise<boolean> => Promise.resolve(false);
export const setChatName = (_name: string): string | null => null;
export const chatInView = (_on: boolean): void => undefined;
export const dismissBanner = (): void => undefined;
