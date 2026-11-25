import type { ChatRow } from './chat-view';

/* The operator's chat list (QA23-CHAT-1). Red: not built yet. */
export function ChatList({ rows }: { rows: readonly ChatRow[] }) {
  return <ol data-count={rows.length} />;
}
