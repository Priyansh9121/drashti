import type { DeviceKind } from '../../../../shared/network';
import type { ApiAnswer, Paired } from '../device';

// Red: not built yet (QA23-CHAT-1).
export type ChatPageStart =
  | { kind: 'ready' }
  | { kind: 'pair' }
  | { kind: 'refused'; message: string }
  | { kind: 'elsewhere'; page: string };

export interface ChatPageDeps {
  hash: string;
  clearHash: () => void;
  current: () => Paired | null;
  keep: (p: Paired) => void;
  forget: () => void;
  api: <T>(
    path: string,
    init?: { method?: 'GET' | 'POST'; body?: unknown; token?: string },
  ) => Promise<ApiAnswer<T>>;
}

export function startChatPage(_deps: ChatPageDeps): Promise<ChatPageStart> {
  return Promise.resolve({ kind: 'pair' } as { kind: 'pair'; device?: DeviceKind });
}
