import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../../../shared/chat';
import type { ToDevice } from '../../../shared/network';
import type * as Feed from './feed';

/** The browser's WebSocket as the feed uses it: each one made, what it sent, and a way to hear from Drashti. */
class FakeSocket {
  static readonly OPEN = 1;
  static made: FakeSocket[] = [];
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.made.push(this);
  }
  send(text: string): void {
    this.sent.push(text);
  }
  hear(message: ToDevice): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const kept = new Map<string, string>([
  ['drashti.device', JSON.stringify({ token: 'placeholder-token', name: 'Placeholder phone', kind: 'chat' })],
]);

let feed: typeof Feed;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeSocket.made = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', {
    host: 'drashti.test:8740',
    pathname: '/chat',
    replace: vi.fn(),
    reload: vi.fn(),
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => kept.set(k, v),
    removeItem: (k: string) => kept.delete(k),
  });
  feed = await import('./feed');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the feed brings the chat to its pages (QA23-CHAT-1)', () => {
  it('hands each chat event, as it comes, to every page part listening, and to none once it stops', () => {
    const heard: ChatEvent[] = [];
    const other: ChatEvent[] = [];
    feed.onChatEvent((e) => heard.push(e));
    const stop = feed.onChatEvent((e) => other.push(e));
    feed.startFeed();
    const socket = FakeSocket.made[0];
    if (!socket) throw new Error('no feed opened');
    socket.onopen?.();
    socket.hear({ type: 'welcome', device: { name: 'Placeholder phone', kind: 'chat' } });
    const message: ChatEvent = {
      kind: 'message',
      message: {
        id: 'm1',
        at: '2026-11-25T08:05:00.000Z',
        from: { id: 'operator', name: 'Operator' },
        text: 'Placeholder hello',
      },
    };
    socket.hear({ type: 'chat', event: message });
    stop();
    socket.hear({ type: 'chat', event: { kind: 'cleared', day: '2026-11-25' } });
    expect(heard).toEqual([message, { kind: 'cleared', day: '2026-11-25' }]);
    expect(other).toEqual([message]);
  });

  it('a chat-only phone says hello with its token and is online, with no engine state ever coming', () => {
    const online = vi.fn();
    feed.onOnline(online);
    feed.startFeed();
    const socket = FakeSocket.made[0];
    socket?.onopen?.();
    expect(JSON.parse(socket?.sent[0] ?? '{}')).toMatchObject({ type: 'hello', token: 'placeholder-token' });
    socket?.hear({ type: 'welcome', device: { name: 'Placeholder phone', kind: 'chat' } });
    expect(feed.useFeed.getState().state).toBe('online');
    expect(online).toHaveBeenCalledTimes(1);
  });
});
