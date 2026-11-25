import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkChange } from '../../../../shared/network';
import type { ChatMessage, ChatState } from './chat-contract';
import type * as ChatStore from './chat-store';

const feed = vi.hoisted(() => ({
  changed: [] as ((what: NetworkChange) => void)[],
  online: [] as (() => void)[],
}));
vi.mock('../feed', () => ({
  onOnline: (listener: () => void) => {
    feed.online.push(listener);
    return () => undefined;
  },
  onListsChanged: (listener: (what: NetworkChange) => void) => {
    feed.changed.push(listener);
    return () => undefined;
  },
}));
const alerts = vi.hoisted(() => ({ armed: 0, alerted: 0 }));
vi.mock('./chat-alert', () => ({
  armAlerts: () => {
    alerts.armed++;
  },
  alertNewMessage: () => {
    alerts.alerted++;
    return 'buzz';
  },
}));

const ME = 'phone-me';
const message = (id: string, from: string, text = `Placeholder message ${id}`): ChatMessage => ({
  id,
  at: 1_764_000_000_000 + Number(id),
  from: { id: from, name: from === ME ? 'Placeholder Me' : `Placeholder ${from}` },
  text,
});
const chat = (...messages: ChatMessage[]): ChatState => ({ day: '2026-11-25', messages, people: [] });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The page as a phone's browser has it: shown or put away, and told when that changes. */
class Page extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
  show(state: 'visible' | 'hidden'): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

let store: typeof ChatStore;
let page: Page;
let answers: ChatState[];
let sent: unknown[];
let refuse: { status: number; message: string } | null;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

const reads = () => fetcher.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET').length;
const changed = (what: string) => {
  for (const l of feed.changed) l(what as NetworkChange);
};

beforeEach(async () => {
  vi.resetModules();
  feed.changed = [];
  feed.online = [];
  alerts.armed = 0;
  alerts.alerted = 0;
  answers = [chat(message('1', 'other'), message('2', ME))];
  sent = [];
  refuse = null;
  page = new Page();
  vi.stubGlobal('document', page);
  fetcher = vi.fn<typeof fetch>((url, init) => {
    if (url !== '/api/v1/chat') return Promise.resolve(json({ ok: false, message: 'Not here.' }, 404));
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { text: string; name: string };
      sent.push(body);
      if (refuse) return Promise.resolve(json({ ok: false, message: refuse.message }, refuse.status));
      const made = {
        id: `s${String(sent.length)}`,
        at: 1,
        from: { id: ME, name: body.name },
        text: body.text,
      };
      return Promise.resolve(json({ ok: true, message: made }));
    }
    const now = answers[0] ?? chat();
    if (answers.length > 1) answers.shift();
    return Promise.resolve(json({ ok: true, chat: now, you: ME }));
  });
  vi.stubGlobal('fetch', fetcher);
  store = await import('./chat-store');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const started = async () => {
  store.startChat();
  await vi.waitFor(() => expect(store.useChat.getState().chat).not.toBeNull());
};

describe('the phone’s chat: history on opening', () => {
  it('reads the day’s messages once started, knows which are its own, and counts none as new', async () => {
    await started();
    const s = store.useChat.getState();
    expect(s.chat?.messages.map((m) => m.id)).toEqual(['1', '2']);
    expect(s.me).toBe(ME);
    expect(s.unread).toEqual([]);
    expect(s.banner).toBeNull();
    expect(alerts.alerted).toBe(0);
    expect(alerts.armed).toBe(1);
  });

  it('starts once per page', async () => {
    await started();
    store.startChat();
    expect(reads()).toBe(1);
  });
});

describe('a new message from someone else', () => {
  it('while the page is open: buzzes or sounds, shows a banner, and is unread while the chat is not in view', async () => {
    await started();
    answers = [chat(message('1', 'other'), message('2', ME), message('3', 'other'))];
    changed('chat');
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages).toHaveLength(3));
    const s = store.useChat.getState();
    expect(alerts.alerted).toBe(1);
    expect(s.banner?.id).toBe('3');
    expect(s.unread).toEqual(['3']);
  });

  it('with the chat in view: buzzes or sounds, but needs no banner and is not unread', async () => {
    await started();
    store.chatInView(true);
    answers = [chat(message('1', 'other'), message('2', ME), message('3', 'other'))];
    changed('chat');
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages).toHaveLength(3));
    expect(alerts.alerted).toBe(1);
    expect(store.useChat.getState().banner).toBeNull();
    expect(store.useChat.getState().unread).toEqual([]);
  });

  it('never for this phone’s own message', async () => {
    await started();
    answers = [chat(message('1', 'other'), message('2', ME), message('4', ME))];
    changed('chat');
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages).toHaveLength(3));
    expect(alerts.alerted).toBe(0);
    expect(store.useChat.getState().banner).toBeNull();
  });

  it('is read for no other change the feed tells of', async () => {
    await started();
    changed('playlists');
    changed('messages');
    expect(reads()).toBe(1);
  });

  it('seeing the chat takes the banner and the unread count away', async () => {
    await started();
    answers = [chat(message('1', 'other'), message('2', ME), message('3', 'other'))];
    changed('chat');
    await vi.waitFor(() => expect(store.useChat.getState().unread).toEqual(['3']));
    store.chatInView(true);
    expect(store.useChat.getState().unread).toEqual([]);
    expect(store.useChat.getState().banner).toBeNull();
  });

  it('the banner can be put away without opening the chat (the message stays unread)', async () => {
    await started();
    answers = [chat(message('1', 'other'), message('3', 'other'))];
    changed('chat');
    await vi.waitFor(() => expect(store.useChat.getState().banner?.id).toBe('3'));
    store.dismissBanner();
    expect(store.useChat.getState().banner).toBeNull();
    expect(store.useChat.getState().unread).toEqual(['3']);
  });
});

describe('catching up after the phone wakes or its connection comes back', () => {
  it('reads again when the page is shown again: what came meanwhile is unread with a banner, and no buzz', async () => {
    await started();
    page.show('hidden');
    answers = [
      chat(message('1', 'other'), message('2', ME), message('5', 'other'), message('6', 'operator')),
    ];
    page.show('visible');
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages).toHaveLength(4));
    const s = store.useChat.getState();
    expect(s.unread).toEqual(['5', '6']);
    expect(s.banner?.id).toBe('6');
    expect(alerts.alerted).toBe(0);
  });

  it('reads again each time the feed is back online', async () => {
    await started();
    answers = [chat(message('1', 'other'), message('2', ME), message('7', 'other'))];
    for (const l of feed.online) l();
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages).toHaveLength(3));
    expect(store.useChat.getState().unread).toEqual(['7']);
    expect(alerts.alerted).toBe(0);
  });

  it('a message told of while the page is put away is unread, with no buzz (the browser allows none then)', async () => {
    await started();
    page.visibilityState = 'hidden';
    answers = [chat(message('1', 'other'), message('8', 'other'))];
    changed('chat');
    await vi.waitFor(() => expect(store.useChat.getState().unread).toEqual(['8']));
    expect(alerts.alerted).toBe(0);
  });

  it('Clear chat on the computer empties the list and the unread count', async () => {
    await started();
    answers = [chat(message('1', 'other'), message('3', 'other'))];
    changed('chat');
    await vi.waitFor(() => expect(store.useChat.getState().unread).toEqual(['3']));
    answers = [chat()];
    changed('chat');
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages).toEqual([]));
    expect(store.useChat.getState().unread).toEqual([]);
    expect(store.useChat.getState().banner).toBeNull();
  });
});

describe('the name, asked once', () => {
  it('is kept for the page once given, tidied, and refused in plain words when empty', async () => {
    await started();
    expect(store.useChat.getState().name).toBeNull();
    expect(store.setChatName('   ')).toBe('Type your name first.');
    expect(store.useChat.getState().name).toBeNull();
    expect(store.setChatName(' Placeholder  Volunteer ')).toBeNull();
    expect(store.useChat.getState().name).toBe('Placeholder Volunteer');
  });
});

describe('sending', () => {
  it('needs the name first, and words, and sends nothing until then', async () => {
    await started();
    expect(await store.sendChat('Placeholder hello')).toBe(false);
    expect(store.useChat.getState().problem).toBe('Type your name first.');
    store.setChatName('Placeholder Volunteer');
    expect(await store.sendChat('   ')).toBe(false);
    expect(store.useChat.getState().problem).toBe('Type a message first.');
    expect(await store.sendChat('a'.repeat(501))).toBe(false);
    expect(sent).toEqual([]);
  });

  it('sends the words and the name, and shows the message at once on the right (its own)', async () => {
    await started();
    store.setChatName('Placeholder Volunteer');
    expect(await store.sendChat('Placeholder hello 🙏')).toBe(true);
    expect(sent).toEqual([{ text: 'Placeholder hello 🙏', name: 'Placeholder Volunteer' }]);
    const s = store.useChat.getState();
    expect(s.problem).toBeNull();
    const last = s.chat?.messages.at(-1);
    expect(last?.text).toBe('Placeholder hello 🙏');
    expect(last?.from.id).toBe(s.me);
    expect(alerts.alerted).toBe(0);
  });

  it('the same message read again from Drashti is shown once', async () => {
    await started();
    store.setChatName('Placeholder Volunteer');
    await store.sendChat('Placeholder hello');
    answers = [
      chat(message('1', 'other'), message('2', ME), {
        ...message('9', ME),
        id: 's1',
        text: 'Placeholder hello',
      }),
    ];
    changed('chat');
    await vi.waitFor(() => expect(reads()).toBe(2));
    await vi.waitFor(() =>
      expect(store.useChat.getState().chat?.messages.filter((m) => m.id === 's1')).toHaveLength(1),
    );
  });

  it('a refusal (too many at once, a removed phone) is shown in Drashti’s words and nothing is added', async () => {
    await started();
    store.setChatName('Placeholder Volunteer');
    refuse = { status: 403, message: 'Placeholder refusal in plain words.' };
    expect(await store.sendChat('Placeholder hello')).toBe(false);
    expect(store.useChat.getState().problem).toBe('Placeholder refusal in plain words.');
    expect(store.useChat.getState().chat?.messages).toHaveLength(2);
  });
});
