import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { CHAT_API } from '../../src/shared/chat';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, device, networkOn, NETWORK_ENV, pairByQr, pairingCode, pairToken } from './devices';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { addPhoneDeck, putUpFromComputer } from './phone-deck';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * The chat for paired phones, on the phones (alpha.23, QA23-CHAT-1): a Remote phone's Chat tab, in Pro Mode and in
 * Simple Mode, and the chat page (/chat). Chrome on an Android phone and Safari on an iPhone, with a script's Remote as
 * a third person. The name is asked once and remembered; WhatsApp-style: the sender's name above another's message,
 * this phone's own on the right, newest at the bottom, the day's history on opening; the hint to speak with the
 * keyboard's own microphone; a new message from someone else buzzes an Android phone, or plays a short sound on an
 * iPhone, only after a first tap, with a banner and a count while the chat is not in view; every word shown as words
 * (nothing a message says ever runs); a removed phone cut off at once; and a new phone from the Chat QR, paired for the
 * chat alone, catching up on what came while the network was off. Placeholder names and messages only; codes and
 * tokens are made at run time and never printed.
 */

test.use({ actionTimeout: 20_000 });

/**
 * What the page asked the phone for (before its own code runs): each buzz's pattern, and each sound started. The
 * browser's own vibration and Web Audio stay as they are; this only counts.
 */
const COUNT_ALERTS = () => {
  const seen = { buzz: [] as number[][], sound: 0 };
  (window as unknown as { __chatAlerts: typeof seen }).__chatAlerts = seen;
  if (typeof navigator.vibrate === 'function') {
    const vibrate = navigator.vibrate.bind(navigator);
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: number | number[]) => {
        seen.buzz.push(Array.isArray(pattern) ? [...pattern] : [pattern]);
        return vibrate(pattern);
      },
    });
  }
  // An engine with no Web Audio (Playwright's WebKit on Windows; an iPhone's Safari has it): a stand-in with what the
  // page's sound uses, which only counts, so the page's sound rules are checked there too (CI run 45532541843).
  const audio = window as unknown as { AudioContext?: typeof AudioContext; __chatAudioStandIn?: boolean };
  if (!audio.AudioContext) {
    const none = () => undefined;
    const param = () => ({ value: 0, setValueAtTime: none, exponentialRampToValueAtTime: none });
    const node = () => ({ connect: none, disconnect: none });
    class StandInContext {
      state = 'running';
      currentTime = 0;
      destination = node();
      resume() {
        return Promise.resolve();
      }
      createBuffer() {
        return {};
      }
      createBufferSource() {
        return { ...node(), buffer: null, start: none };
      }
      createGain() {
        return { ...node(), gain: param() };
      }
      createOscillator() {
        return { ...node(), type: 'sine', frequency: param(), start: none, stop: none };
      }
    }
    audio.AudioContext = StandInContext as unknown as typeof AudioContext;
    audio.__chatAudioStandIn = true;
  }
  // Counted where the engine defines it: a real engine's createOscillator is BaseAudioContext's (Web Audio's own
  // interfaces), not AudioContext's own, so the prototype chain is walked (CI Mac run of a22-chat-1125-192312-10846: a
  // patch on AudioContext.prototype alone counted nothing with WebKit's real Web Audio).
  let owner: object | null = audio.AudioContext.prototype;
  while (owner && !Object.getOwnPropertyDescriptor(owner, 'createOscillator'))
    owner = Object.getPrototypeOf(owner) as object | null;
  const make = owner
    ? (Object.getOwnPropertyDescriptor(owner, 'createOscillator')?.value as
        ((this: AudioContext) => OscillatorNode) | undefined)
    : undefined;
  (window as unknown as { __chatSoundCounted?: boolean }).__chatSoundCounted =
    owner !== null && make !== undefined;
  if (owner && make)
    Object.defineProperty(owner, 'createOscillator', {
      configurable: true,
      value: function (this: AudioContext) {
        const tone = make.call(this);
        const start = tone.start.bind(tone);
        tone.start = (when?: number) => {
          seen.sound++;
          start(when);
        };
        return tone;
      },
    });
};

const alertsOf = (p: Page) =>
  p.evaluate(() => (window as unknown as { __chatAlerts: { buzz: number[][]; sound: number } }).__chatAlerts);

/** Give a name on the phone's Chat (asked once). */
async function join(p: Page, name: string): Promise<void> {
  await expect(p.getByTestId('chat-name')).toBeVisible();
  await p.getByTestId('chat-name').fill(name);
  await p.getByTestId('chat-name-save').click();
  await expect(p.getByTestId('chat-own-name')).toHaveText(name);
}

async function send(p: Page, text: string): Promise<void> {
  await p.getByTestId('chat-text-box').fill(text);
  await p.getByTestId('chat-send').click();
  await expect(p.getByTestId('chat-text-box')).toHaveValue('');
}

const bubble = (p: Page, text: string) => p.getByTestId('chat-message').filter({ hasText: text });

/**
 * Where the controls of the show are on a Remote (each slide, Clear slide, Back and Next: a Pro Mode phone's while a
 * PDF is up, QA23-PHONE-1), in CSS pixels.
 */
const showBoxes = (p: Page) =>
  p.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="remote-slide"], [data-testid="remote-clear-slide"], [data-testid="remote-back"], [data-testid="remote-next-button"]',
      ),
    ].map((el) => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height].map((n) => Math.round(n)).join(',');
    }),
  );

test('two phones chat on the remote’s Chat tab: the name once, WhatsApp-style, a buzz on Android and a sound on an iPhone only after a first tap, the banner and the count, words never run, in Simple Mode too', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp(NETWORK_ENV);
  const android = await device('chromium');
  const iphone = await device('webkit');
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    const { port, base } = await networkOn(win);
    for (const phone of [android, iphone]) await phone.context.addInitScript(COUNT_ALERTS);
    // A PDF up from its row: its pages, Clear slide, Back and Next on the Show tab of the phone that runs the show (a
    // phone puts up and turns a PowerPoint or a PDF alone, QA23-PHONE-1).
    const deck = await addPhoneDeck(win, show.playlistId);
    await putUpFromComputer(win, show.playlistId, deck.itemId);

    // A third person (a script's Remote) chatted before the phones opened the chat: the day's history.
    const third = await pairToken(win, port, 'remote', 'Placeholder script phone');
    const named = await apiCall(port, CHAT_API.name, {
      method: 'POST',
      token: third,
      body: { name: 'Placeholder Third Person' },
    });
    expect(named.status).toBe(200);
    const said = await apiCall(port, CHAT_API.send, {
      method: 'POST',
      token: third,
      body: { text: 'Placeholder history message' },
    });
    expect(said.status).toBe(200);

    const a = android.page;
    const b = iphone.page;
    await pairByQr(a, base, await pairingCode(win, 'remote', 'Placeholder Android phone'), '/remote');
    await pairByQr(b, base, await pairingCode(win, 'remote', 'Placeholder iPhone'), '/remote');
    for (const p of [a, b]) await expect(p.getByTestId('connection')).toHaveText('Connected');

    // The Android phone opens Chat: its name asked once, then the history, the other's name above it on the left.
    await a.getByTestId('remote-tab-chat').click();
    await expect(a.getByTestId('remote-tab-chat')).toHaveAttribute('aria-selected', 'true');
    await expect(a.getByTestId('chat-text-box')).toHaveCount(0);
    await join(a, 'Placeholder Volunteer A');
    const history = bubble(a, 'Placeholder history message');
    await expect(history).toHaveAttribute('data-own', 'false');
    await expect(history.getByTestId('chat-from')).toHaveText('Placeholder Third Person');
    await expect(a.getByTestId('chat-mic-hint')).toHaveText('Tap 🎤 on your keyboard to speak');

    // The iPhone runs the show (Show tab, slides up) and has not been tapped yet. Where its controls are, before.
    await expect(b.getByTestId('remote-slide').first()).toBeVisible();
    await expect(b.getByTestId('remote-next-button')).toBeVisible();
    const before = await showBoxes(b);

    // The Android phone sends: on the right, with no name above it, the newest at the bottom.
    await send(a, 'Placeholder first message 🙏');
    const mine = bubble(a, 'Placeholder first message 🙏');
    await expect(mine).toHaveAttribute('data-own', 'true');
    await expect(mine.getByTestId('chat-from')).toHaveCount(0);
    await expect(a.getByTestId('chat-message').last()).toContainText('Placeholder first message 🙏');

    // On the iPhone running the show: the count on Chat. Nothing under its finger moved (no banner over the slides,
    // the clears or Back and Next: a tap meant for one slide never lands on the next), and no sound (it would be
    // heard in the sabha; an Android phone there only buzzes).
    await expect(b.getByTestId('remote-tab-chat').getByTestId('chat-unread')).toContainText('1');
    expect(await showBoxes(b)).toEqual(before);
    await expect(b.getByTestId('chat-banner')).toHaveCount(0);
    expect(await alertsOf(b)).toEqual({ buzz: [], sound: 0 });

    // Off the Show tab (its first tap: Playlist), a new message: a banner in the header's place, which moves
    // nothing, and (Safari's Web Audio; no vibration for web pages) a short sound, never a buzz.
    expect(await b.evaluate(() => [typeof AudioContext, typeof navigator.vibrate])).toEqual([
      'function',
      'undefined',
    ]);
    // Its sounds are counted, whichever Web Audio it has (a count that could not be set up would read 0 for ever).
    expect(
      await b.evaluate(
        () => (window as unknown as { __chatSoundCounted?: boolean }).__chatSoundCounted ?? false,
      ),
      'the sounds are counted',
    ).toBe(true);
    // Safari's own Web Audio where the engine has it (a Mac); elsewhere the counting stand-in above.
    if (process.platform === 'darwin')
      expect(
        await b.evaluate(
          () => (window as unknown as { __chatAudioStandIn?: boolean }).__chatAudioStandIn ?? false,
        ),
        'WebKit’s own Web Audio on a Mac',
      ).toBe(false);
    await b.getByTestId('remote-tab-playlist').click();
    await expect(b.getByTestId('remote-playlist')).toBeVisible();
    const playlistBox = await b.getByTestId('remote-playlist').boundingBox();
    await send(a, 'Placeholder second message');
    const banner = b.getByTestId('chat-banner');
    await expect(banner).toContainText('Placeholder Volunteer A');
    await expect(banner).toContainText('Placeholder second message');
    await expect(b.getByTestId('remote-tab-chat').getByTestId('chat-unread')).toContainText('2');
    expect(await b.getByTestId('remote-playlist').boundingBox()).toEqual(playlistBox);
    await expect.poll(async () => (await alertsOf(b)).sound).toBe(1);
    expect((await alertsOf(b)).buzz).toEqual([]);

    // A tap on the banner opens Chat: seen, nothing unread; its name asked once.
    await b.getByTestId('chat-banner-open').click();
    await expect(b.getByTestId('remote-tab-chat')).toHaveAttribute('aria-selected', 'true');
    await expect(b.getByTestId('chat-banner')).toHaveCount(0);
    await expect(b.getByTestId('chat-unread')).toHaveCount(0);
    await join(b, 'Placeholder Volunteer B');
    await expect(bubble(b, 'Placeholder first message').getByTestId('chat-from')).toHaveText(
      'Placeholder Volunteer A',
    );

    // Words that look like a page's code stay words on the other phone: nothing in them runs or is drawn.
    const hostile = '<img src=x onerror="window.__chatRan=1">Placeholder <b>bold</b>';
    await send(b, hostile);
    const got = bubble(a, 'Placeholder <b>bold</b>');
    await expect(got.getByTestId('chat-text')).toHaveText(hostile);
    await expect(got.locator('img, b')).toHaveCount(0);
    expect(await a.evaluate(() => (window as unknown as { __chatRan?: number }).__chatRan)).toBeUndefined();
    // The Android phone, tapped before and with the chat open: one short buzz, no banner, no sound.
    await expect.poll(() => alertsOf(a)).toEqual({ buzz: [[120, 80, 120]], sound: 0 });
    await expect(a.getByTestId('chat-banner')).toHaveCount(0);

    // A reply soon after: the iPhone shows it; one sound in a few seconds at most, and never a buzz.
    await send(a, 'Placeholder reply');
    await expect(bubble(b, 'Placeholder reply')).toHaveAttribute('data-own', 'false');
    expect((await alertsOf(b)).buzz).toEqual([]);
    await expectNoSeriousA11yIssues(b, 'the remote’s Chat on an iPhone');

    // The computer in Simple Mode (its one playlist open): the phones' Chat is there and works the same.
    await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
    await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect(b.getByTestId('remote-simple')).toBeVisible();
    await expect(b.getByTestId('remote-tab-chat')).toBeVisible();
    await send(b, 'Placeholder in Simple Mode');
    await expect(bubble(a, 'Placeholder in Simple Mode').getByTestId('chat-from')).toHaveText(
      'Placeholder Volunteer B',
    );

    // Reloaded, the phone remembers its name and shows the day's history at once.
    await a.reload();
    await a.getByTestId('remote-tab-chat').click();
    await expect(a.getByTestId('chat-own-name')).toHaveText('Placeholder Volunteer A');
    await expect(bubble(a, 'Placeholder history message')).toBeVisible();
    await expect(bubble(a, 'Placeholder in Simple Mode')).toBeVisible();
  } finally {
    await android.close();
    await iphone.close();
    await app.close();
  }
});

test('the chat page (/chat): a phone in the chat opens it with its own pairing and is never paired again over it, remembers its name, and is cut off at once when removed', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const phone = await device('chromium');
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const { port, base } = await networkOn(win);
    const p = phone.page;
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder Remote phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');

    // The chat page with a code in its address (as a Chat QR's would be): the Remote's own pairing is kept.
    await p.goto(`${base}/chat#c=123456`);
    await expect(p.getByTestId('chat-page')).toBeVisible();
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    expect(new URL(p.url()).hash).toBe('');
    expect(
      await p.evaluate(
        () => (JSON.parse(localStorage.getItem('drashti.device') ?? '{}') as { kind?: string }).kind,
      ),
    ).toBe('remote');
    await join(p, 'Placeholder Page Person');
    await send(p, 'Placeholder from the chat page');
    await expect(bubble(p, 'Placeholder from the chat page')).toHaveAttribute('data-own', 'true');

    // Another person writes: it arrives on the page as it happens.
    const other = await pairToken(win, port, 'remote', 'Placeholder script phone');
    await apiCall(port, CHAT_API.name, { method: 'POST', token: other, body: { name: 'Placeholder Other' } });
    await apiCall(port, CHAT_API.send, {
      method: 'POST',
      token: other,
      body: { text: 'Placeholder to the page' },
    });
    await expect(bubble(p, 'Placeholder to the page').getByTestId('chat-from')).toHaveText(
      'Placeholder Other',
    );
    await expectNoSeriousA11yIssues(p, 'the chat page on an Android phone');

    // Opened again: the name remembered, the history there; and the Remote still works.
    await p.reload();
    await expect(p.getByTestId('chat-own-name')).toHaveText('Placeholder Page Person');
    await expect(bubble(p, 'Placeholder to the page')).toBeVisible();
    await p.goto(`${base}/remote`);
    await expect(p.getByTestId('remote')).toBeVisible();
    await expect(p.getByTestId('connection')).toHaveText('Connected');

    // Removed in Drashti: cut off at once, back to pairing, saying why.
    await p.goto(`${base}/chat`);
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const it = (await d.network.status()).devices.find((x) => x.name === 'Placeholder Remote phone');
      const revoked = await d.network.revokeDevice(it?.id ?? '');
      if (!revoked.ok) throw new Error(revoked.message);
    });
    await p.waitForURL(`${base}/pair?why=revoked`, { timeout: 15_000 });
    await expect(p.getByTestId('pair-page')).toBeVisible();
  } finally {
    await phone.close();
    await app.close();
  }
});

test('a new phone scans the Chat QR: paired by itself for the chat alone, its name once, the history; it catches up on what came while it was not connected, and a removed person is cut off', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const phone = await device('webkit');
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const { base } = await networkOn(win);
    const said = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.chat.send('Placeholder from the operator'),
    );
    expect(said.ok).toBe(true);
    const invited = await win.evaluate(() => (globalThis as PageGlobals).drashti.chat.invite());
    if (!invited.ok || !invited.view.invite) throw new Error('no Chat QR');
    const p = phone.page;
    // The page's own errors, none: this WebKit has no Web Audio on Windows (the sound simply is not made).
    const errors: string[] = [];
    p.on('pageerror', (error) => errors.push(error.message));
    // The QR's address (whatever core makes it: /pair#c= or /chat#c=) ends on the chat page.
    await p.goto(invited.view.invite.url.replace(/^https?:\/\/[^/]+/u, base));
    await p.waitForURL(`${base}/chat`);
    expect(
      await p.evaluate(
        () => (JSON.parse(localStorage.getItem('drashti.device') ?? '{}') as { kind?: string }).kind,
      ),
    ).toBe('chat');
    await join(p, 'Placeholder QR Person');
    await expect(bubble(p, 'Placeholder from the operator').getByTestId('chat-from')).toHaveText('Operator');
    // Not connected for a while (the network off): what the operator wrote meanwhile is there once it is back.
    await win.evaluate(async () => {
      const off = await (globalThis as PageGlobals).drashti.network.setOn(false);
      if (!off.ok) throw new Error(off.message);
    });
    await expect(p.getByTestId('connection')).not.toHaveText('Connected');
    await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.chat.send('Placeholder while you were away'),
    );
    await win.evaluate(async () => {
      const on = await (globalThis as PageGlobals).drashti.network.setOn(true);
      if (!on.ok) throw new Error(on.message);
    });
    await expect(p.getByTestId('connection')).toHaveText('Connected', { timeout: 30_000 });
    await expect(bubble(p, 'Placeholder while you were away')).toBeVisible();
    // Removed by the operator: cut off at once.
    const view = await win.evaluate(() => (globalThis as PageGlobals).drashti.chat.view());
    const person = view.members.find((m) => m.name === 'Placeholder QR Person');
    const removed = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.chat.remove(id),
      person?.id ?? '',
    );
    expect(removed.ok).toBe(true);
    await p.waitForURL(`${base}/pair?why=revoked`, { timeout: 15_000 });
    expect(errors, 'the chat page’s own errors').toEqual([]);
  } finally {
    await phone.close();
    await app.close();
  }
});
