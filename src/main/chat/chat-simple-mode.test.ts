import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { SIMPLE_MODE_LOCKED } from '../simple-mode';

/* The chat in Simple Mode (alpha.23, QA23-CHAT-1): Clear chat, removing a person and the Chat QR stay Pro Mode's. */

describe('the chat in Simple Mode', () => {
  it('locks Clear chat, Remove and the Chat QR; reading the chat stays open', () => {
    for (const channel of [IPC.chat.clear, IPC.chat.remove, IPC.chat.invite, IPC.chat.endInvite])
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.chat.view);
  });
});
