import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_API,
  CHAT_HISTORY_MAX,
  CHAT_REFUSAL,
  type ChatEvent,
  type ChatMessage,
  type ChatPhoneView,
} from '../../../../shared/chat';
import type * as ChatStore from './chat-store';

const feed = vi.hoisted(() => ({
  online: [] as (() => void)[],
  chat: [] as ((event: ChatEvent) => void)[],
  followed: 0,
}));
vi.mock('../feed', () => ({
  followChat: () => {
    feed.followed++;
  },
  onOnline: (listener: () => void) => {
    feed.online.push(listener);
    return () => undefined;
  },
  onChatEvent: (listener: (event: ChatEvent) => void) => {
    feed.chat.push(listener);
    return () => undefined;
  },
}));
const alerts = vi.hoisted(() => ({ armed: 0, alerted: 0, ways: [] as string[], answer: 'buzz' }));
vi.mock('./chat-alert', () => ({
  armAlerts: () => {
    alerts.armed++;
  },
  alertNewMessage: (how?: { sound?: boolean }) => {
    alerts.alerted++;
    alerts.ways.push(how?.sound === false ? 'buzz only' : 'buzz or sound');
    return alerts.answer;
  },
}));

const ME = 'phone-me';
const message = (id: string, from: string, text = `Placeholder message ${id}`): ChatMessage => ({
  id,
  at: new Date(Date.UTC(2026, 10, 25, 8, (Number(id) || 0) % 60)).toISOString(),
  from: { id: from, name: from === ME ? 'Placeholder Me' : `Placeholder ${from}` },
  text,
});
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

/** Drashti's side, as the phone's requests meet it. */
interface Drashti {
  messages: ChatMessage[];
  /** The name Drashti has for this phone (null: not given yet, or Drashti was restarted and forgot it). */
  name: string | null;
  names: string[];
  sent: string[];
  refuse: { status: number; message: string } | null;
}

let store: typeof ChatStore;
let page: Page;
let drashti: Drashti;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

/** What Drashti answers a read: after a message it still has, only what came since; else the whole day (since null). */
const view = (after?: string): ChatPhoneView => {
  const at = after === undefined ? -1 : drashti.messages.findIndex((m) => m.id === after);
  return {
    day: '2026-11-25',
    messages: at >= 0 ? drashti.messages.slice(at + 1) : [...drashti.messages],
    people: [{ id: 'operator', name: 'Operator' }],
    you: { id: ME, name: drashti.name },
    since: at >= 0 && after !== undefined ? after : null,
  };
};
const reads = () => fetcher.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET').length;
/** A request's address as fetch was given it. */
const hrefOf = (url: string | URL | Request): string =>
  typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
const readUrls = () =>
  fetcher.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET').map(([url]) => hrefOf(url));
const tell = (event: ChatEvent) => {
  for (const l of feed.chat) l(event);
};
/** A message someone else sent: in Drashti's chat, and told on the feed. */
const arrives = (m: ChatMessage) => {
  drashti.messages.push(m);
  tell({ kind: 'message', message: m });
};

beforeEach(async () => {
  vi.resetModules();
  feed.online = [];
  feed.chat = [];
  feed.followed = 0;
  alerts.armed = 0;
  alerts.alerted = 0;
  alerts.ways = [];
  alerts.answer = 'buzz';
  drashti = {
    messages: [message('1', 'other'), message('2', ME)],
    name: null,
    names: [],
    sent: [],
    refuse: null,
  };
  page = new Page();
  vi.stubGlobal('document', page);
  // The phone's storage for this address: it keeps the name over a new load of the page.
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => kept.set(k, v),
    removeItem: (k: string) => kept.delete(k),
  });
  fetcher = vi.fn<typeof fetch>((url, init) => {
    const body = init?.body === undefined ? {} : (JSON.parse(init.body as string) as Record<string, string>);
    if (init?.method === 'POST' && drashti.refuse)
      return Promise.resolve(json({ ok: false, message: drashti.refuse.message }, drashti.refuse.status));
    const [path = '', query = ''] = hrefOf(url).split('?');
    if (path === CHAT_API.read && init?.method !== 'POST')
      return Promise.resolve(
        json({ ok: true, chat: view(new URLSearchParams(query).get('after') ?? undefined) }),
      );
    if (url === CHAT_API.name && init?.method === 'POST') {
      drashti.names.push(body['name'] ?? '');
      drashti.name = body['name'] ?? null;
      return Promise.resolve(json({ ok: true, chat: view() }));
    }
    if (url === CHAT_API.send && init?.method === 'POST') {
      const text = body['text'] ?? '';
      drashti.sent.push(text);
      const made: ChatMessage = {
        id: `s${String(drashti.sent.length)}`,
        at: '2026-11-25T09:00:00.000Z',
        from: { id: ME, name: drashti.name ?? '' },
        text,
      };
      drashti.messages.push(made);
      return Promise.resolve(json({ ok: true, message: made }));
    }
    return Promise.resolve(json({ ok: false, message: 'Not here.' }, 404));
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
const named = async () => {
  await started();
  expect(await store.setChatName('Placeholder Volunteer')).toBeNull();
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
    // Its feed asks Drashti for the chat's events.
    expect(feed.followed).toBe(1);
  });

  it('starts once per page', async () => {
    await started();
    store.startChat();
    expect(reads()).toBe(1);
  });
});

describe('the name, asked once', () => {
  it('is checked on the phone in Drashti’s words, then given to Drashti and kept', async () => {
    await started();
    expect(store.useChat.getState().name).toBeNull();
    expect(await store.setChatName('   ')).toBe(CHAT_REFUSAL.name);
    expect(drashti.names).toEqual([]);
    expect(await store.setChatName(' Placeholder\tVolunteer ')).toBeNull();
    expect(drashti.names).toEqual(['Placeholder Volunteer']);
    expect(store.useChat.getState().name).toBe('Placeholder Volunteer');
  });

  it('refused by Drashti (the chat is full), is shown in its words and not kept', async () => {
    await started();
    drashti.refuse = { status: 403, message: CHAT_REFUSAL.full };
    expect(await store.setChatName('Placeholder Volunteer')).toBe(CHAT_REFUSAL.full);
    expect(store.useChat.getState().name).toBeNull();
  });

  it('kept on the phone, is given to Drashti again when the page opens and Drashti has none (it was restarted)', async () => {
    await named();
    vi.resetModules();
    feed.online = [];
    feed.chat = [];
    drashti.name = null;
    drashti.names = [];
    store = await import('./chat-store');
    await started();
    await vi.waitFor(() => expect(drashti.names).toEqual(['Placeholder Volunteer']));
    expect(store.useChat.getState().name).toBe('Placeholder Volunteer');
  });

  it('is not given again when Drashti already has it', async () => {
    await named();
    vi.resetModules();
    feed.online = [];
    feed.chat = [];
    drashti.names = [];
    store = await import('./chat-store');
    await started();
    expect(drashti.names).toEqual([]);
  });
});

describe('a new message from someone else, told on the feed', () => {
  it('while the page is open: buzzes or sounds, shows a banner, and is unread while the chat is not in view', async () => {
    await started();
    arrives(message('3', 'other'));
    const s = store.useChat.getState();
    expect(s.chat?.messages.map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(alerts.alerted).toBe(1);
    expect(s.banner?.id).toBe('3');
    expect(s.unread).toEqual(['3']);
    // Brought by the feed itself: no read needed.
    expect(reads()).toBe(1);
  });

  it('with the chat in view: buzzes or sounds, but needs no banner and is not unread', async () => {
    await started();
    store.chatInView(true);
    arrives(message('3', 'operator'));
    expect(alerts.alerted).toBe(1);
    expect(store.useChat.getState().banner).toBeNull();
    expect(store.useChat.getState().unread).toEqual([]);
  });

  it('never for this phone’s own message, and the same message is shown once', async () => {
    await started();
    arrives(message('4', ME));
    tell({ kind: 'message', message: message('4', ME) });
    expect(store.useChat.getState().chat?.messages.filter((m) => m.id === '4')).toHaveLength(1);
    expect(alerts.alerted).toBe(0);
    expect(store.useChat.getState().banner).toBeNull();
  });

  it('told before the first read is in, is not lost', async () => {
    let release: () => void = () => undefined;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(json({ ok: true, chat: { ...view(), messages: [message('1', 'other')] } }));
          };
        }),
    );
    store.startChat();
    arrives(message('5', 'other'));
    release();
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages.map((m) => m.id)).toContain('5'));
  });

  it('seeing the chat takes the banner and the unread count away', async () => {
    await started();
    arrives(message('3', 'other'));
    store.chatInView(true);
    expect(store.useChat.getState().unread).toEqual([]);
    expect(store.useChat.getState().banner).toBeNull();
  });

  it('the banner can be put away without opening the chat (the message stays unread)', async () => {
    await started();
    arrives(message('3', 'other'));
    store.dismissBanner();
    expect(store.useChat.getState().banner).toBeNull();
    expect(store.useChat.getState().unread).toEqual(['3']);
  });

  it('told while the page is put away, is unread with no buzz (the browser allows none then)', async () => {
    await started();
    page.visibilityState = 'hidden';
    arrives(message('8', 'other'));
    expect(store.useChat.getState().unread).toEqual(['8']);
    expect(alerts.alerted).toBe(0);
  });

  it('the people told of are the chat’s people now', async () => {
    await started();
    tell({
      kind: 'people',
      people: [
        { id: 'operator', name: 'Operator' },
        { id: 'p2', name: 'Placeholder Two' },
      ],
    });
    expect(store.useChat.getState().chat?.people.map((p) => p.id)).toEqual(['operator', 'p2']);
  });
});

describe('the Remote of the phone that runs the show (a22-review-chat P-M1, P-S1)', () => {
  it('with the show on its screen: the count, never a banner over the show, and a buzz but never a sound', async () => {
    await started();
    store.chatShowOnScreen(true);
    arrives(message('3', 'other'));
    const s = store.useChat.getState();
    expect(s.unread).toEqual(['3']);
    expect(s.banner).toBeNull();
    // The owner's vibration moves nothing on the screen (lead 2, answered for the owner); a sound would be heard in
    // the sabha.
    expect(alerts.ways).toEqual(['buzz only']);
  });

  it('off the show again: the banner and the buzz or sound come back', async () => {
    await started();
    store.chatShowOnScreen(true);
    store.chatShowOnScreen(false);
    arrives(message('3', 'other'));
    expect(store.useChat.getState().banner?.id).toBe('3');
    expect(alerts.ways).toEqual(['buzz or sound']);
  });

  it('buzzes or sounds at most once in a few seconds, however many messages come (each still counts)', async () => {
    await started();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    arrives(message('3', 'other'));
    now += 1000;
    arrives(message('4', 'other'));
    now += 1000;
    arrives(message('5', 'operator'));
    expect(alerts.alerted).toBe(1);
    expect(store.useChat.getState().unread).toEqual(['3', '4', '5']);
    expect(store.useChat.getState().banner?.id).toBe('5');
    now += store.ALERT_GAP_MS;
    arrives(message('6', 'other'));
    expect(alerts.alerted).toBe(2);
  });

  it('a message that could not buzz or sound (no tap yet, an iPhone on the show) holds the next one back not at all', async () => {
    await started();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    alerts.answer = 'none';
    arrives(message('3', 'other'));
    alerts.answer = 'sound';
    now += 1000;
    arrives(message('4', 'other'));
    expect(alerts.alerted).toBe(2);
  });
});

describe('the list on the phone, between reads (a22-review-chat P-S2)', () => {
  it('keeps the newest of the day as Drashti does, however many messages the feed brings', async () => {
    await started();
    store.chatShowOnScreen(true);
    for (let i = 0; i < CHAT_HISTORY_MAX + 5; i++)
      tell({ kind: 'message', message: message(`f${String(i)}`, 'other') });
    const messages = store.useChat.getState().chat?.messages ?? [];
    expect(messages).toHaveLength(CHAT_HISTORY_MAX);
    expect(messages.at(-1)?.id).toBe(`f${String(CHAT_HISTORY_MAX + 4)}`);
    // The unread are only those still in the list.
    expect(store.useChat.getState().unread).toHaveLength(CHAT_HISTORY_MAX);
  });
});

describe('catching up after the phone wakes or its connection comes back', () => {
  it('reads again when the page is shown again: what came meanwhile is unread with a banner, and no buzz', async () => {
    await started();
    page.show('hidden');
    drashti.messages.push(message('5', 'other'), message('6', 'operator'));
    page.show('visible');
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages).toHaveLength(4));
    const s = store.useChat.getState();
    expect(s.unread).toEqual(['5', '6']);
    expect(s.banner?.id).toBe('6');
    expect(alerts.alerted).toBe(0);
  });

  it('asks only for what is new (after the last message it has), and adds it to the list (review M4)', async () => {
    await started();
    drashti.messages.push(message('5', 'other'));
    page.show('visible');
    await vi.waitFor(() =>
      expect(store.useChat.getState().chat?.messages.map((m) => m.id)).toEqual(['1', '2', '5']),
    );
    expect(readUrls()).toEqual([CHAT_API.read, `${CHAT_API.read}?after=2`]);
    expect(store.useChat.getState().unread).toEqual(['5']);
  });

  it('when Drashti answers with the whole day (since: null: it no longer has that message), shows it in the list’s place', async () => {
    await started();
    drashti.messages = [message('7', 'other')];
    for (const l of feed.online) l();
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages.map((m) => m.id)).toEqual(['7']));
    expect(readUrls()[1]).toBe(`${CHAT_API.read}?after=2`);
  });

  it('reads again each time the feed is back online', async () => {
    await started();
    drashti.messages.push(message('7', 'other'));
    for (const l of feed.online) l();
    await vi.waitFor(() => expect(store.useChat.getState().chat?.messages).toHaveLength(3));
    expect(store.useChat.getState().unread).toEqual(['7']);
    expect(alerts.alerted).toBe(0);
  });

  it('Clear chat on the computer (or the next day) empties the list, the unread count and the banner', async () => {
    await started();
    arrives(message('3', 'other'));
    drashti.messages = [];
    tell({ kind: 'cleared', day: '2026-11-25' });
    const s = store.useChat.getState();
    expect(s.chat?.messages).toEqual([]);
    expect(s.unread).toEqual([]);
    expect(s.banner).toBeNull();
  });
});

describe('sending', () => {
  it('needs the name first, and words, in Drashti’s words, and sends nothing until then', async () => {
    await started();
    expect(await store.sendChat('Placeholder hello')).toBe(false);
    expect(store.useChat.getState().problem).toBe(CHAT_REFUSAL.noName);
    expect(await store.setChatName('Placeholder Volunteer')).toBeNull();
    expect(await store.sendChat('   ')).toBe(false);
    expect(store.useChat.getState().problem).toBe(CHAT_REFUSAL.empty);
    expect(await store.sendChat('a'.repeat(501))).toBe(false);
    expect(store.useChat.getState().problem).toBe(CHAT_REFUSAL.tooLong);
    expect(drashti.sent).toEqual([]);
  });

  it('sends the words and shows the message at once on the right (its own), with no buzz', async () => {
    await named();
    expect(await store.sendChat('Placeholder hello 🙏')).toBe(true);
    expect(drashti.sent).toEqual(['Placeholder hello 🙏']);
    const s = store.useChat.getState();
    expect(s.problem).toBeNull();
    const last = s.chat?.messages.at(-1);
    if (!last) throw new Error('nothing shown');
    expect(last.text).toBe('Placeholder hello 🙏');
    expect(last.from.id).toBe(s.me);
    // The feed brings the same message to every phone, this one too: shown once.
    tell({ kind: 'message', message: last });
    expect(store.useChat.getState().chat?.messages.filter((m) => m.id === last.id)).toHaveLength(1);
    expect(alerts.alerted).toBe(0);
  });

  it('a refusal (too many at once, a removed phone) is shown in Drashti’s words and nothing is added', async () => {
    await named();
    drashti.refuse = { status: 429, message: CHAT_REFUSAL.tooFast };
    expect(await store.sendChat('Placeholder hello')).toBe(false);
    expect(store.useChat.getState().problem).toBe(CHAT_REFUSAL.tooFast);
    expect(store.useChat.getState().chat?.messages).toHaveLength(2);
  });
});
