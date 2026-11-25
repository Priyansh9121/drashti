import { describe, expect, it, vi } from 'vitest';
import type { DeviceKind } from '../../../../shared/network';
import type { ApiAnswer, Paired } from '../device';
import { type ChatPageDeps, startChatPage } from './chat-page-start';

/** The page's world: the address's #fragment, the pairing this browser keeps, and Drashti's answers. */
function world(given: {
  hash?: string;
  kept?: DeviceKind | null;
  me?: ApiAnswer<{ device: { name: string; kind: DeviceKind } }>;
  pair?: ApiAnswer<{ token: string; device: { name: string; kind: DeviceKind } }>;
}) {
  let kept: Paired | null =
    given.kept === undefined || given.kept === null
      ? null
      : { token: 'placeholder-kept-token', name: 'Placeholder phone', kind: given.kept };
  const asked: { path: string; token?: string; body?: unknown }[] = [];
  const cleared = vi.fn();
  const deps: ChatPageDeps = {
    hash: given.hash ?? '',
    clearHash: cleared,
    current: () => kept,
    keep: (p) => {
      kept = p;
    },
    forget: () => {
      kept = null;
    },
    api: (path, init) => {
      asked.push({ path, ...(init?.token ? { token: init.token } : {}), ...(init?.body ? { body: init.body } : {}) });
      if (path === '/api/v1/me')
        return Promise.resolve(given.me ?? { ok: false, status: 401, message: 'Not paired.' }) as never;
      return Promise.resolve(given.pair ?? { ok: false, status: 403, message: 'Placeholder code refused.' }) as never;
    },
  };
  return { deps, asked, cleared, kept: () => kept };
}

const chatDevice = { name: 'Placeholder phone', kind: 'chat' as const };

describe('the chat page as it opens (a phone that scanned the Chat QR, or opened it again)', () => {
  it('pairs this phone with the code from the QR, takes the code out of the address, and opens the chat', async () => {
    const w = world({ hash: '#c=123456', pair: { ok: true, token: 'placeholder-new-token', device: chatDevice } });
    expect(await startChatPage(w.deps)).toEqual({ kind: 'ready' });
    expect(w.cleared).toHaveBeenCalledTimes(1);
    expect(w.asked).toEqual([{ path: '/api/v1/pair', body: { code: '123456' } }]);
    expect(w.kept()).toEqual({ token: 'placeholder-new-token', name: 'Placeholder phone', kind: 'chat' });
  });

  it('keeps a Remote pairing Drashti still knows (its Chat tab is the same chat): never paired again over it', async () => {
    const w = world({
      hash: '#c=123456',
      kept: 'remote',
      me: { ok: true, device: { name: 'Placeholder phone', kind: 'remote' } },
    });
    expect(await startChatPage(w.deps)).toEqual({ kind: 'ready' });
    expect(w.asked).toEqual([{ path: '/api/v1/me', token: 'placeholder-kept-token' }]);
    expect(w.kept()?.kind).toBe('remote');
  });

  it('pairs with the code when the kept pairing was removed in Drashti', async () => {
    const w = world({
      hash: '#c=654321',
      kept: 'chat',
      me: { ok: false, status: 401, message: 'Not paired.' },
      pair: { ok: true, token: 'placeholder-new-token', device: chatDevice },
    });
    expect(await startChatPage(w.deps)).toEqual({ kind: 'ready' });
    expect(w.asked.map((a) => a.path)).toEqual(['/api/v1/me', '/api/v1/pair']);
    expect(w.kept()?.token).toBe('placeholder-new-token');
  });

  it('says Drashti’s words when the code is refused (its ten minutes are over), with the pairing page to go to', async () => {
    const w = world({ hash: '#c=123456', pair: { ok: false, status: 403, message: 'Placeholder code refused.' } });
    expect(await startChatPage(w.deps)).toEqual({ kind: 'refused', message: 'Placeholder code refused.' });
  });

  it('opened again with no code: the chat with the kept pairing, or the pairing page without one', async () => {
    const known = world({ kept: 'chat', me: { ok: true, device: chatDevice } });
    expect(await startChatPage(known.deps)).toEqual({ kind: 'ready' });
    const none = world({});
    expect(await startChatPage(none.deps)).toEqual({ kind: 'pair' });
    expect(none.asked).toEqual([]);
  });

  it('a kept pairing not in the chat (a Stage screen) goes to its own page', async () => {
    const w = world({ kept: 'stage', me: { ok: true, device: { name: 'Placeholder screen', kind: 'stage' } } });
    expect(await startChatPage(w.deps)).toEqual({ kind: 'elsewhere', page: '/stage' });
  });

  it('with Drashti out of reach or stopped, keeps the pairing and opens the chat, which says so and tries again', async () => {
    const w = world({ kept: 'chat', me: { ok: false, status: 0, message: 'Drashti cannot be reached.' } });
    expect(await startChatPage(w.deps)).toEqual({ kind: 'ready' });
    expect(w.kept()?.kind).toBe('chat');
  });
});
