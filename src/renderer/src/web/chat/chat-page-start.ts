import { CHAT_DEVICE_KINDS } from '../../../../shared/chat';
import type { DeviceKind } from '../../../../shared/network';
import { type ApiAnswer, type Paired, PAGE_OF } from '../device';

/*
 * The chat page as it opens (QA23-CHAT-1): a phone that scanned the pairing dialog's "Chat" QR (its code in the
 * address's #fragment, which browsers never send), or one opening the chat again. A pairing this browser keeps that
 * Drashti still knows and that is in the chat (a Remote, an Announcements phone, a chat-only phone) opens the chat as
 * it is: a phone that runs the show is never paired again over (its Chat tab is the same chat), nor a Stage screen
 * (it is not in the chat, and keeps its pairing). Otherwise the code
 * pairs this phone by itself as a chat-only device, as the pairing page pairs one; with neither, the pairing page.
 */

export type ChatPageStart =
  /** Paired and in the chat: show it. */
  | { kind: 'ready' }
  /** No pairing and no code: to the pairing page. */
  | { kind: 'pair' }
  /** The code was refused (its time is over, the chat is full): Drashti's words. */
  | { kind: 'refused'; message: string }
  /** A pairing of a kind not in the chat (a Stage screen): its own page. */
  | { kind: 'elsewhere'; page: string }
  /** The same, opened from a Chat QR link: its pairing kept, and the page says why it is not in the chat. */
  | { kind: 'notInChat'; page: string };

export interface ChatPageDeps {
  hash: string;
  /** Take the code out of the address at once (it works once). */
  clearHash: () => void;
  current: () => Paired | null;
  keep: (p: Paired) => void;
  forget: () => void;
  api: <T>(
    path: string,
    init?: { method?: 'GET' | 'POST'; body?: unknown; token?: string },
  ) => Promise<ApiAnswer<T>>;
}

const inChat = (kind: DeviceKind): boolean => (CHAT_DEVICE_KINDS as readonly DeviceKind[]).includes(kind);

export async function startChatPage(deps: ChatPageDeps): Promise<ChatPageStart> {
  const code = /^#c=(\d{6})$/u.exec(deps.hash)?.[1] ?? null;
  if (deps.hash !== '') deps.clearHash();
  const known = deps.current();
  if (known) {
    // With its own token, so a pairing Drashti no longer knows is not sent to the pairing page before the code works.
    const me = await deps.api<{ device: { name: string; kind: DeviceKind } }>('/api/v1/me', {
      token: known.token,
    });
    if (me.ok && inChat(me.device.kind)) return { kind: 'ready' };
    // A Stage screen is never paired over by a Chat QR (a22-review-chat P-S4): it keeps showing the stage.
    if (me.ok)
      return code
        ? { kind: 'notInChat', page: PAGE_OF[me.device.kind] }
        : { kind: 'elsewhere', page: PAGE_OF[me.device.kind] };
    // Out of reach or stopped: the chat page says so and tries again. Removed (401): forgotten, then the code.
    if (me.status !== 401) return { kind: 'ready' };
    deps.forget();
  }
  if (!code) return { kind: 'pair' };
  const paired = await deps.api<{ token: string; device: { name: string; kind: DeviceKind } }>(
    '/api/v1/pair',
    {
      method: 'POST',
      body: { code },
    },
  );
  if (!paired.ok) return { kind: 'refused', message: paired.message };
  deps.keep({ token: paired.token, name: paired.device.name, kind: paired.device.kind });
  // A code for another kind of device (typed here by mistake): that device's own page.
  return inChat(paired.device.kind)
    ? { kind: 'ready' }
    : { kind: 'elsewhere', page: PAGE_OF[paired.device.kind] };
}
