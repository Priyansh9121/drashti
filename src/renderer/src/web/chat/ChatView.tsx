import type { ClockStyle } from '../../../../shared/format';
import type { ChatMessage } from './chat-contract';

// Red: not built yet (QA23-CHAT-1).
export const MIC_HINT = '';
export function ChatList(_props: { messages: readonly ChatMessage[]; me: string | null; clock: ClockStyle | null }) {
  return null;
}
export function ChatBannerView(_props: { message: ChatMessage; onOpen: () => void; onDismiss: () => void }) {
  return null;
}
export function ChatNameForm(_props: { onName: (name: string) => string | null; problem: string | null; initial: string }) {
  return null;
}
