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
  opened = false;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.made.push(this);
  }
  send(text: string): void {
    this.sent.push(text);
    // The server's answer to a hello (a socket serve() opened): welcome, and the same device's older chat feed replaced.
    if (!this.opened || (JSON.parse(text) as { type?: string }).type !== 'hello') return;
    for (const older of FakeSocket.made)
      if (older !== this && older.opened && !older.closed) older.end('replaced');
    this.hear({ type: 'welcome', device: { name: 'Placeholder phone', kind: 'chat' } });
  }
  /** Drashti ends this feed, saying why. */
  end(reason: 'replaced' | 'busy'): void {
    this.hear({ type: 'bye', reason });
    this.closed = true;
    this.onclose?.();
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

/** A page's document: shown or put away, and told when that changes. */
class Doc extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
  show(state: 'visible' | 'hidden'): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

/**
 * Drashti's feed as a22-chat-core's server answers it for a chat-only device (server.ts): each socket opens a moment
 * after it is made, and a hello from the same device ends that device's older chat feed with 'replaced'.
 */
function serve(): void {
  for (const socket of FakeSocket.made) {
    if (socket.opened) continue;
    socket.opened = true;
    socket.onopen?.();
  }
}
const open = () => FakeSocket.made.filter((s) => s.opened && !s.closed);

/** A tab of the same device, with its own document: the feed module loaded afresh, as a new page loads it. */
async function tab(doc: Doc): Promise<typeof Feed> {
  vi.resetModules();
  vi.stubGlobal('document', doc);
  const page = await import('./feed');
  page.followChat();
  page.startFeed();
  return page;
}

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

  it('a page that shows the chat says so in its hello (Drashti then sends it the chat)', () => {
    feed.followChat();
    feed.startFeed();
    const socket = FakeSocket.made[0];
    socket?.onopen?.();
    expect(JSON.parse(socket?.sent[0] ?? '{}')).toMatchObject({ type: 'hello', chat: true });
  });

  it('a page that never shows the chat (the stage display) does not ask for it', () => {
    feed.startFeed();
    const socket = FakeSocket.made[0];
    socket?.onopen?.();
    expect(JSON.parse(socket?.sent[0] ?? '{}')).not.toHaveProperty('chat');
  });

  it('two pages of one device (two tabs): the one replaced waits until it is shown again, and the two never take the chat from each other again and again', async () => {
    const first = new Doc();
    const second = new Doc();
    await tab(first);
    serve();
    // The second tab opens: Drashti replaces the first one's feed.
    first.visibilityState = 'hidden';
    await tab(second);
    serve();
    expect(open()).toHaveLength(1);
    // A minute on: no feed made again, by either (each would replace the other's every second).
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1000);
      serve();
    }
    expect(FakeSocket.made).toHaveLength(2);
    expect(open()).toHaveLength(1);
    // The first tab shown again: it follows the chat again (and the second, replaced, now waits).
    second.visibilityState = 'hidden';
    first.show('visible');
    serve();
    expect(FakeSocket.made).toHaveLength(3);
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1000);
      serve();
    }
    expect(FakeSocket.made).toHaveLength(3);
    expect(open()).toHaveLength(1);
  });

  it('as many pages follow the chat as Drashti takes (busy): it tries again only after the longest wait', async () => {
    const page = new Doc();
    await tab(page);
    serve();
    FakeSocket.made[0]?.end('busy');
    vi.advanceTimersByTime(7999);
    expect(FakeSocket.made).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.made).toHaveLength(2);
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
