import type { ChatPop } from './chat-pop';

/*
 * The chat's popup in the operator window (alpha.24, QA24-CHATPOP-1): not built yet (red first).
 */

export interface ChatPopViewProps {
  pop: ChatPop | null;
  leaving: boolean;
  still: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

export function ChatPopView(_props: ChatPopViewProps) {
  return <div />;
}
