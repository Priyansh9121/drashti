import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Locator, Page } from '@playwright/test';
import { chromium, expect, test, webkit } from '@playwright/test';
import {
  CHAT_API,
  CHAT_INVITE_TTL_MS,
  CHAT_LINES_MAX,
  CHAT_OPERATOR_NAME,
  CHAT_RATE,
  CHAT_REFUSAL,
  CHAT_TEXT_MAX,
} from '../../src/shared/chat';
import { apiCall, NETWORK_ENV, networkOn, pairByQr, pairingCode, PHONE } from './devices';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';
import {
  bubble,
  chatView,
  feedFrames,
  giveName,
  keptPairing,
  openChatSection,
  operatorSays,
  type Phone,
  phoneIn,
  readAs,
  sayAs,
  scanChatQr,
  sendFrom,
  showChatQr,
  shownTexts,
} from './chat-people';

/*
 * The chat for paired phones, end to end (alpha.23, QA23-CHAT-1; the owner: "a few people scan and a group is created,
 * with the same chat … user's name who message something like in whatsapp groups. anyone can message, anyone can see
 * message in the qr paired"): three phones (two from the Chat QR, one a Remote) and the operator in one chat, each
 * name above its messages, each phone's own on the right, the day's history for a phone that opens it later; the
 * limits refused by Drashti in plain words (500 characters as a phone's text box counts them, an emoji two; too many
 * at once); a person removed cut off at once; Clear chat; and every name and word shown as text (nothing in them ever
 * runs), the banner too. Chrome on Android and Safari on an iPhone. Placeholder names and words only; codes and
 * tokens are made at run time and never printed.
 */

/** Where a message sits in its list: its distance from the list's left and right edges (CSS pixels). */
async function sides(list: Locator, message: Locator): Promise<{ left: number; right: number }> {
  const l = await list.boundingBox();
  const m = await message.boundingBox();
  if (!l || !m) throw new Error('The list or the message is not laid out.');
  return { left: m.x - l.x, right: l.x + l.width - (m.x + m.width) };
}

/** On the right of its list (its own), or on the left (someone else's), as a chat's bubbles sit. */
async function expectSide(
  list: Locator,
  message: Locator,
  side: 'right' | 'left',
  what: string,
): Promise<void> {
  const at = await sides(list, message);
  if (side === 'right') {
    expect(at.right, `${what}: against the right edge`).toBeLessThanOrEqual(1);
    expect(at.left, `${what}: clear of the left edge`).toBeGreaterThan(24);
  } else {
    expect(at.left, `${what}: against the left edge`).toBeLessThanOrEqual(1);
    expect(at.right, `${what}: clear of the right edge`).toBeGreaterThan(24);
  }
}

/** The operator's own messages on a phone: marked by who sent them (a mark no name can give), never by the name. */
async function expectFrom(message: Locator, name: string, operator: boolean): Promise<void> {
  if (operator) await expect(message).toHaveAttribute('data-operator', 'true');
  else await expect(message).not.toHaveAttribute('data-operator', 'true');
  await expect(message.getByTestId('chat-operator-mark')).toHaveCount(operator ? 1 : 0);
  if (operator) await expect(message.getByTestId('chat-from')).toContainText(name);
  else await expect(message.getByTestId('chat-from')).toHaveText(name);
}

test('three phones and the operator in one chat: each phone from the Chat QR paired by itself for its 10 minutes (two from one address, a third refused), every name above its messages, each one’s own on the right, and a phone opening it later sees the day’s history', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp(NETWORK_ENV);
  const browsers: Browser[] = [await chromium.launch(), await webkit.launch()];
  const [android, apple] = browsers as [Browser, Browser];
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const { base } = await networkOn(win);

    // The Chat QR from the Phones panel: for 10 minutes, its address the chat's own page with the code after #.
    await win.getByTestId('open-network').click();
    const qr = win.getByTestId('network-panel').getByTestId('chat-invite');
    const before = Date.now();
    await qr.getByTestId('chat-invite-show').click();
    await expect(qr.getByTestId('qr-code')).toBeVisible();
    await expect(qr.getByTestId('chat-invite-left')).toContainText(/Works for (?:10:00|9:[0-5]\d) more/u);
    const invite = (await chatView(win)).invite;
    const after = Date.now();
    if (!invite) throw new Error('The Chat QR is not in the chat’s view.');
    expect(invite.expiresAt).toBeGreaterThanOrEqual(before + CHAT_INVITE_TTL_MS);
    expect(invite.expiresAt).toBeLessThanOrEqual(after + CHAT_INVITE_TTL_MS);
    const address = new URL(invite.url);
    expect(address.pathname).toBe('/chat');
    expect(address.hash === `#c=${invite.code}`, 'the code is in the address’s #fragment').toBe(true);
    await win.keyboard.press('Escape');
    await expect(win.getByTestId('network-panel')).toHaveCount(0);

    // Two phones scan it: each is paired by itself, as a chat-only device, and gives its name once.
    const one = await phoneIn(android, PHONE.chromium);
    const two = await phoneIn(apple, PHONE.webkit);
    for (const p of [one, two]) await scanChatQr(p.page, base, invite.code);
    const kept = [await keptPairing(one.page), await keptPairing(two.page)];
    expect(kept.map((k) => k.kind)).toEqual(['chat', 'chat']);
    expect(
      kept[0]?.token !== '' && kept[0]?.token !== kept[1]?.token,
      'each phone has a pairing of its own',
    ).toBe(true);
    await giveName(one.page, 'Placeholder Person One');
    await giveName(two.page, 'Placeholder Person Two');
    // These test phones all reach Drashti from one address: a third joining from it is refused in plain words
    // (one phone can never pair a crowd), and keeps no pairing.
    const crowd = await phoneIn(android, PHONE.chromium);
    await crowd.page.goto(`${base}/chat#c=${invite.code}`);
    await expect(crowd.page.getByTestId('chat-refused')).toContainText(CHAT_REFUSAL.joinTooMany);
    expect((await keptPairing(crowd.page)).kind).toBeNull();
    await crowd.close();

    // A third person's phone is a Remote, paired by its own QR: the same chat on its Chat tab.
    const three = await phoneIn(android, PHONE.chromium);
    await pairByQr(three.page, base, await pairingCode(win, 'remote', 'Placeholder Remote phone'), '/remote');
    await expect(three.page.getByTestId('connection')).toHaveText('Connected');
    await three.page.getByTestId('remote-tab-chat').click();
    await giveName(three.page, 'Placeholder Person Three');

    // Each writes in turn, then the operator; everyone sees each message as it is sent.
    const phones: [Phone, string][] = [
      [one, 'Placeholder Person One'],
      [two, 'Placeholder Person Two'],
      [three, 'Placeholder Person Three'],
    ];
    const said: { from: Phone | null; name: string; text: string }[] = [];
    for (const [phone, name] of phones) {
      const text = `Placeholder: hello from ${name} 🙏`;
      await sendFrom(phone.page, text);
      said.push({ from: phone, name, text });
      for (const [p] of phones) await expect(bubble(p.page, text)).toHaveCount(1);
    }
    const section = await openChatSection(win);
    const operatorWords = 'Placeholder: the operator says hello';
    await operatorSays(section, operatorWords);
    said.push({ from: null, name: CHAT_OPERATOR_NAME, text: operatorWords });
    for (const [p] of phones) await expect(bubble(p.page, operatorWords)).toHaveCount(1);
    const texts = said.map((m) => m.text);

    // On each phone: oldest first, the others' names above their messages on the left, its own on the right.
    for (const [phone, name] of phones) {
      const p = phone.page;
      await expect.poll(() => shownTexts(p)).toEqual(texts);
      const list = p.getByTestId('chat-list');
      for (const m of said) {
        const b = bubble(p, m.text);
        const own = m.from === phone;
        await expect(b).toHaveAttribute('data-own', String(own));
        if (own) await expect(b.getByTestId('chat-from')).toHaveCount(0);
        else await expectFrom(b, m.name, m.from === null);
        await expectSide(list, b, own ? 'right' : 'left', `${m.name}’s message on ${name}’s phone`);
      }
    }

    // In the operator's section: the same, the operator's own on the right, each phone's person named.
    await expect(section.getByTestId('chat-message')).toHaveCount(said.length);
    expect(await shownTexts(section)).toEqual(texts);
    const operatorList = section.getByTestId('chat-list').locator('ol');
    for (const m of said) {
      const b = bubble(section, m.text);
      await expect(b).toHaveAttribute('data-mine', String(m.from === null));
      if (m.from === null) await expect(b.getByTestId('chat-sender')).toHaveCount(0);
      else await expect(b.getByTestId('chat-sender')).toHaveText(m.name);
      await expectSide(
        operatorList,
        b,
        m.from === null ? 'right' : 'left',
        `${m.name}’s message in the window`,
      );
    }
    // Who is in it: the operator first, then each person in the order they gave their names; how each is paired.
    expect((await chatView(win)).people.map((p) => p.name)).toEqual([
      CHAT_OPERATOR_NAME,
      'Placeholder Person One',
      'Placeholder Person Two',
      'Placeholder Person Three',
    ]);
    await section.getByTestId('chat-people-toggle').click();
    const people = section.getByTestId('chat-person');
    await expect(people).toHaveCount(3);
    await expect(people.filter({ hasText: 'Placeholder Person One' })).toContainText('Chat only · Connected');
    await expect(people.filter({ hasText: 'Placeholder Person Two' })).toContainText('Chat only · Connected');
    await expect(people.filter({ hasText: 'Placeholder Person Three' })).toContainText('Remote · Connected');

    // A fourth person's phone, paired later (a Remote), opens Chat: the day's history at once, oldest first, each
    // name above, the newest at the bottom and in sight.
    const four = await phoneIn(apple, PHONE.webkit);
    await pairByQr(four.page, base, await pairingCode(win, 'remote', 'Placeholder later phone'), '/remote');
    await four.page.getByTestId('remote-tab-chat').click();
    await giveName(four.page, 'Placeholder Person Four');
    await expect(four.page.getByTestId('chat-message')).toHaveCount(said.length);
    expect(await shownTexts(four.page)).toEqual(texts);
    for (const m of said) {
      await expect(bubble(four.page, m.text)).toHaveAttribute('data-own', 'false');
      await expectFrom(bubble(four.page, m.text), m.name, m.from === null);
    }
    await expect(four.page.getByTestId('chat-message').last()).toBeInViewport();
    await expect(people).toHaveCount(4);

    // The Chat QR stopped from the Phones panel: the phones it paired stay in the chat for the day.
    await win.getByTestId('open-network').click();
    await qr.getByTestId('chat-invite-end').click();
    await expect(qr.getByTestId('chat-invite-show')).toBeVisible();
    await expect.poll(async () => (await chatView(win)).invite).toBeNull();
    await win.keyboard.press('Escape');
    await sendFrom(one.page, 'Placeholder: still here after the Chat QR');
    await expect(bubble(four.page, 'Placeholder: still here after the Chat QR')).toHaveCount(1);
    await expect(bubble(section, 'Placeholder: still here after the Chat QR')).toHaveCount(1);
  } finally {
    for (const b of browsers) await b.close();
    await app.close();
  }
});

test('the limits, refused by Drashti in plain words: 500 characters as a phone’s box counts them (an emoji is two) and not one more, at most 20 lines, never empty, too many at once (the words kept on the phone), and never the operator’s name', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const android = await chromium.launch();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const { port, base } = await networkOn(win);
    const invite = await showChatQr(win);
    const phone = await phoneIn(android, PHONE.chromium);
    const p = phone.page;
    await scanChatQr(p, base, invite.code);
    const { token } = await keptPairing(p);

    // A name: never the operator's, whatever its capitals: refused in plain words on the phone, and by Drashti
    // whoever asks; then the person's own.
    await p.getByTestId('chat-name').fill('operator');
    await p.getByTestId('chat-name-save').click();
    await expect(p.getByTestId('chat-name-form').getByRole('alert')).toHaveText(CHAT_REFUSAL.operatorName);
    const asOperator = await apiCall(port, CHAT_API.name, {
      method: 'POST',
      token,
      body: { name: 'OPERATOR' },
    });
    expect(asOperator.status).toBe(400);
    expect(asOperator.json['message']).toBe(CHAT_REFUSAL.operatorName);
    await giveName(p, 'Placeholder Counter');
    // Nor another person's name of the day: no one can write as someone else.
    const other = await pairingCode(win, 'remote', 'Placeholder script phone');
    const paired = await apiCall(port, '/api/v1/pair', { method: 'POST', body: { code: other } });
    const otherToken = String(paired.json['token']);
    const taken = await apiCall(port, CHAT_API.name, {
      method: 'POST',
      token: otherToken,
      body: { name: 'Placeholder Counter' },
    });
    expect(taken.status).toBe(409);
    expect(taken.json['message']).toBe(CHAT_REFUSAL.nameTaken);

    // 500 characters, as the phone's own text box counts them: an emoji is two. All 500 are taken and shown.
    const box = p.getByTestId('chat-text-box');
    await expect(box).toHaveAttribute('maxlength', String(CHAT_TEXT_MAX));
    const full = `${'a'.repeat(CHAT_TEXT_MAX - 2)}🙏`;
    expect(full.length).toBe(CHAT_TEXT_MAX);
    await box.fill(full);
    await expect(p.getByTestId('chat-count')).toContainText(
      `${String(CHAT_TEXT_MAX)} of ${String(CHAT_TEXT_MAX)}`,
    );
    await p.getByTestId('chat-send').click();
    await expect(box).toHaveValue('');
    await expect(bubble(p, '🙏').getByTestId('chat-text')).toHaveText(full);
    expect((await chatView(win)).messages.map((m) => m.text)).toEqual([full]);

    // One more is refused by Drashti, whatever the page does (here as a page that let it through would send it), in
    // plain words; so are 21 lines, and words with nothing visible in them. None of them reaches anyone.
    const tooLong = await sayAs(port, token, `${'a'.repeat(CHAT_TEXT_MAX - 1)}🙏`);
    expect(tooLong.status).toBe(400);
    expect(tooLong.json['message']).toBe(CHAT_REFUSAL.tooLong);
    const lines = Array.from({ length: CHAT_LINES_MAX + 1 }, (_, i) => `Placeholder line ${String(i + 1)}`);
    const tooMany = await sayAs(port, token, lines.join('\n'));
    expect(tooMany.status).toBe(400);
    expect(tooMany.json['message']).toBe(CHAT_REFUSAL.tooManyLines);
    const nothing = await sayAs(port, token, ' \n\u200B\t ');
    expect(nothing.status).toBe(400);
    expect(nothing.json['message']).toBe(CHAT_REFUSAL.empty);
    expect((await chatView(win)).messages).toHaveLength(1);
    await expect(p.getByTestId('chat-message')).toHaveCount(1);

    // Too many at once (this phone's own, sent together): Drashti refuses the rest in plain words; the phone's next
    // Send is refused in the same words, and its words stay in its box to send again.
    await box.fill('Placeholder: one too many');
    const burst = await p.evaluate(
      async ({ path, token, n }) =>
        Promise.all(
          Array.from({ length: n }, async (_, i) => {
            const answer = await fetch(path, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: `Placeholder burst ${String(i + 1)}` }),
            });
            return {
              status: answer.status,
              message: ((await answer.json()) as { message?: string }).message ?? null,
            };
          }),
        ),
      { path: CHAT_API.send, token, n: CHAT_RATE.burst + 1 },
    );
    const refused = burst.filter((a) => a.status !== 200);
    expect(refused.length, 'some of them refused').toBeGreaterThan(0);
    expect(refused).toEqual(refused.map(() => ({ status: 429, message: CHAT_REFUSAL.tooFast })));
    await p.getByTestId('chat-send').click();
    await expect(p.getByTestId('chat-problem')).toHaveText(CHAT_REFUSAL.tooFast);
    await expect(box).toHaveValue('Placeholder: one too many');
    expect((await chatView(win)).messages.map((m) => m.text)).not.toContain('Placeholder: one too many');

    // The Chat QR stopped: a phone scanning its code now is told it has ended, and keeps no pairing.
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.chat.endInvite())).ok).toBe(true);
    const after = await phoneIn(android, PHONE.chromium);
    await after.page.goto(`${base}/chat#c=${invite.code}`);
    await expect(after.page.getByTestId('chat-refused')).toContainText(CHAT_REFUSAL.ended);
    expect((await keptPairing(after.page)).kind).toBeNull();
  } finally {
    await android.close();
    await app.close();
  }
});

test('a person removed by the operator is cut off at once (their phone neither reads nor posts, its feed ends) and their earlier words stay; Clear chat empties every phone at once and the day’s file, the names kept', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp(NETWORK_ENV);
  const browsers: Browser[] = [await chromium.launch(), await webkit.launch()];
  const [android, apple] = browsers as [Browser, Browser];
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const { port, base } = await networkOn(win);

    // One person from the Chat QR (its feed watched from before its page opens), one on a Remote's Chat tab.
    const invite = await showChatQr(win);
    const leaving = await phoneIn(android, PHONE.chromium);
    const leavingFeed = feedFrames(leaving.page);
    await scanChatQr(leaving.page, base, invite.code);
    await giveName(leaving.page, 'Placeholder Leaving Person');
    const { token } = await keptPairing(leaving.page);
    const staying = await phoneIn(apple, PHONE.webkit);
    await pairByQr(
      staying.page,
      base,
      await pairingCode(win, 'remote', 'Placeholder staying phone'),
      '/remote',
    );
    await staying.page.getByTestId('remote-tab-chat').click();
    await giveName(staying.page, 'Placeholder Staying Person');
    await sendFrom(leaving.page, 'Placeholder: words before leaving');
    await expect(bubble(staying.page, 'Placeholder: words before leaving')).toHaveCount(1);
    await sendFrom(staying.page, 'Placeholder: a reply before the removal');
    await expect(bubble(leaving.page, 'Placeholder: a reply before the removal')).toHaveCount(1);
    // The day's chat is kept on the computer, in its file in the data folder.
    const file = join(userData, 'chat', 'today.json');
    const kept = () => (existsSync(file) ? readFileSync(file, 'utf8') : '');
    await expect.poll(kept).toContain('Placeholder: words before leaving');

    // Removed from the Chat section (asked first): out of the people at once.
    const section = await openChatSection(win);
    await section.getByTestId('chat-people-toggle').click();
    const person = section.getByTestId('chat-person').filter({ hasText: 'Placeholder Leaving Person' });
    await expect(person).toContainText('Chat only');
    await person.getByTestId('chat-remove-person').click();
    await win.getByTestId('chat-remove-confirm').getByRole('button', { name: 'Remove' }).click();
    await expect(section.getByTestId('chat-person')).toHaveCount(1);

    // At once: the phone can neither read the chat nor post in it; its feed ends, and its page goes to pairing.
    const read = await readAs(port, token);
    const post = await sayAs(port, token, 'Placeholder: words after leaving');
    expect([read.status, post.status]).toEqual([401, 401]);
    await expect
      .poll(() => leavingFeed.frames.some((f) => f.includes('"bye"') && f.includes('"revoked"')))
      .toBe(true);
    await leaving.page.waitForURL(`${base}/pair?why=revoked`, { timeout: 15_000 });
    // What is said after it never reaches it; its words from before stay, under its name.
    await sendFrom(staying.page, 'Placeholder: said after the removal');
    await expect(bubble(section, 'Placeholder: said after the removal')).toHaveCount(1);
    expect(leavingFeed.frames.some((f) => f.includes('Placeholder: said after the removal'))).toBe(false);
    expect((await chatView(win)).messages.map((m) => m.text)).not.toContain(
      'Placeholder: words after leaving',
    );
    const before = bubble(staying.page, 'Placeholder: words before leaving');
    await expect(before.getByTestId('chat-from')).toHaveText('Placeholder Leaving Person');
    expect((await chatView(win)).people.map((p) => p.name)).toEqual([
      CHAT_OPERATOR_NAME,
      'Placeholder Staying Person',
    ]);

    // Clear chat (asked first): every phone's chat and the window's empty at once, and the day's file too.
    await section.getByTestId('chat-clear').click();
    await win.getByTestId('chat-clear-confirm').getByRole('button', { name: 'Clear chat' }).click();
    await expect(section.getByTestId('chat-empty')).toBeVisible();
    await expect(staying.page.getByTestId('chat-empty')).toBeVisible();
    await expect(staying.page.getByTestId('chat-message')).toHaveCount(0);
    expect((await chatView(win)).messages).toEqual([]);
    await expect.poll(kept).not.toContain('Placeholder: words before leaving');
    expect(kept()).not.toContain('Placeholder: said after the removal');
    // Opened again: still empty (no history kept anywhere), the name kept, and the person writes on.
    await staying.page.reload();
    await staying.page.getByTestId('remote-tab-chat').click();
    await expect(staying.page.getByTestId('chat-own-name')).toHaveText('Placeholder Staying Person');
    await expect(staying.page.getByTestId('chat-empty')).toBeVisible();
    await sendFrom(staying.page, 'Placeholder: after Clear chat');
    await expect(bubble(section, 'Placeholder: after Clear chat').getByTestId('chat-sender')).toHaveText(
      'Placeholder Staying Person',
    );
  } finally {
    for (const b of browsers) await b.close();
    await app.close();
  }
});

/** A name and words that would run, or be drawn as markup, if a page ever took them as HTML. */
const MARKUP_NAME = '<img src=x onerror="window.__chatRan=1">';
const MARKUP_WORDS =
  '<script>window.__chatRan=2</script><b>Placeholder</b> & <i>words</i> \u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} 🇮🇳';
const OPERATOR_MARKUP = '<img src=x onerror="window.__chatRan=3">Placeholder from the operator';

test('every name and word is shown as text: a name and messages of HTML and script on the phones, the banner and the operator window, nothing in them run or drawn, and no direction mark turning the words around', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const browsers: Browser[] = [await chromium.launch(), await webkit.launch()];
  const [android, apple] = browsers as [Browser, Browser];
  const ran = (page: Page) =>
    page.evaluate(() => (window as unknown as { __chatRan?: number }).__chatRan ?? null);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const { base } = await networkOn(win);

    // The reader: a Remote off its Show tab (its Playlist: a banner there moves nothing). The writer: a phone from the
    // Chat QR, its name markup.
    const reader = await phoneIn(android, PHONE.chromium);
    await pairByQr(
      reader.page,
      base,
      await pairingCode(win, 'remote', 'Placeholder reading phone'),
      '/remote',
    );
    await expect(reader.page.getByTestId('connection')).toHaveText('Connected');
    await reader.page.getByTestId('remote-tab-chat').click();
    await giveName(reader.page, 'Placeholder Reader');
    await reader.page.getByTestId('remote-tab-playlist').click();
    const writer = await phoneIn(apple, PHONE.webkit);
    await scanChatQr(writer.page, base, (await showChatQr(win)).code);
    await giveName(writer.page, MARKUP_NAME);

    // The banner on the reader: the name and the words as they were typed, as text.
    await sendFrom(writer.page, MARKUP_WORDS);
    const banner = reader.page.getByTestId('chat-banner');
    await expect(banner).toContainText(MARKUP_NAME);
    await expect(banner).toContainText(MARKUP_WORDS);
    await expect(banner.locator('img, script, b, i')).toHaveCount(0);

    // Opened from the banner: the same, in the chat.
    await reader.page.getByTestId('chat-banner-open').click();
    await expect(reader.page.getByTestId('remote-tab-chat')).toHaveAttribute('aria-selected', 'true');
    const got = bubble(reader.page, 'Placeholder</b>');
    await expect(got.getByTestId('chat-from')).toHaveText(MARKUP_NAME);
    await expect(got.getByTestId('chat-text')).toHaveText(MARKUP_WORDS);
    await expect(reader.page.getByTestId('chat-list').locator('img, script, b, i')).toHaveCount(0);

    // Direction marks are left out: no message turns the words after it around.
    await sendFrom(writer.page, 'Placeholder \u202Edrow\u202C turned');
    await expect(bubble(reader.page, 'turned').getByTestId('chat-text')).toHaveText(
      'Placeholder drow turned',
    );

    // The operator window: the name above, the words as text, the name in the people and in Remove's question.
    const section = await openChatSection(win);
    const inWindow = bubble(section, 'Placeholder</b>');
    await expect(inWindow.getByTestId('chat-sender')).toHaveText(MARKUP_NAME);
    await expect(inWindow.getByTestId('chat-text')).toHaveText(MARKUP_WORDS);
    await expect(section.getByTestId('chat-list').locator('img, script, b, i')).toHaveCount(0);
    await section.getByTestId('chat-people-toggle').click();
    const person = section.getByTestId('chat-person').filter({ hasText: MARKUP_NAME });
    await expect(person).toHaveCount(1);
    await expect(section.getByTestId('chat-people').locator('img')).toHaveCount(0);
    await person.getByTestId('chat-remove-person').click();
    const ask = win.getByTestId('chat-remove-confirm');
    await expect(ask).toContainText(MARKUP_NAME);
    await expect(ask.locator('img')).toHaveCount(0);
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(person).toHaveCount(1);

    // The operator's own markup reaches the phones as text.
    await operatorSays(section, OPERATOR_MARKUP);
    for (const p of [reader.page, writer.page]) {
      const b = bubble(p, 'Placeholder from the operator');
      await expect(b.getByTestId('chat-text')).toHaveText(OPERATOR_MARKUP);
      await expect(b.locator('img')).toHaveCount(0);
    }

    // Nothing ran anywhere: on the phones (their pages' CSP bypassed, so only their own escaping kept it out) or in
    // the operator window.
    expect([await ran(reader.page), await ran(writer.page), await ran(win)]).toEqual([null, null, null]);
    expect(
      await win.evaluate(async () =>
        (await (globalThis as PageGlobals).drashti.chat.view()).messages.map((m) => m.from.name),
      ),
    ).toContain(MARKUP_NAME);
  } finally {
    for (const b of browsers) await b.close();
    await app.close();
  }
});
