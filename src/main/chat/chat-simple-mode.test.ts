import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { type SimpleScope, SIMPLE_MODE_BOUNDED, SIMPLE_MODE_LOCKED } from '../simple-mode';

/*
 * The chat in Simple Mode (alpha.23, QA23-CHAT-1; round 1 of the review, S5): Clear chat and showing the Chat QR stay
 * Pro Mode's; stopping the Chat QR and removing a chat phone never touch the screens, so Simple Mode may (removing a
 * Remote or an Announcements device stays Pro Mode's: Main refuses it there).
 */

const scope = (chatPhones: readonly string[] | null) =>
  ({
    kindOf: () => null,
    listsMedia: () => false,
    listsPresentation: () => false,
    ...(chatPhones ? { isChatPhone: (id: string) => chatPhones.includes(id) } : {}),
  }) as unknown as SimpleScope;

describe('the chat in Simple Mode', () => {
  it('locks Clear chat and showing the Chat QR; reading the chat and stopping the Chat QR stay open', () => {
    for (const channel of [IPC.chat.clear, IPC.chat.invite])
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
    for (const channel of [IPC.chat.view, IPC.chat.endInvite, IPC.chat.remove])
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
  });

  it('removes a chat phone, never another device (the lock fails closed without the chat’s phones)', () => {
    const bound = SIMPLE_MODE_BOUNDED.get(IPC.chat.remove);
    if (!bound) throw new Error('chat:remove is not bounded');
    expect(bound(['chat-phone-1'], scope(['chat-phone-1']))).toBe(true);
    expect(bound(['remote-1'], scope(['chat-phone-1']))).toBe(false);
    expect(bound([42], scope(['chat-phone-1']))).toBe(false);
    expect(bound(['chat-phone-1'], scope(null))).toBe(false);
  });
});
