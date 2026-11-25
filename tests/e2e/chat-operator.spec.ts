import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { CHAT_API, CHAT_TEXT_MAX } from '../../src/shared/chat';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import { expectFits, fitFaults } from './fit';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The operator window's Chat section (alpha.23, QA23-CHAT-1; the owner: "a few people scan and a group is created, with
 * the same chat … user's name who message something like in whatsapp groups"): under LIVE, after Messages, folded at
 * the start; the day's messages WhatsApp-style, Send as the operator (every word shown as words), the count near the
 * limit, Clear chat asked first; a phone's message counted on the folded heading and named above; a person removed
 * (cut off at once); the Phones panel's Chat QR; Simple Mode with Chat chosen (read and send only); and Report a
 * Problem's picture of the window with the chat blanked. Never on a screen. Placeholder names and words only; codes
 * and tokens are made at run time and never printed.
 */

const live = (win: Page) => win.getByRole('complementary', { name: 'Live', exact: true });
const section = (win: Page) => live(win).getByTestId('section-chat');
const toggle = (win: Page) => win.getByTestId('group-chat-toggle');

async function openChat(win: Page): Promise<Locator> {
  if ((await toggle(win).getAttribute('aria-expanded')) !== 'true') await toggle(win).click();
  await expect(toggle(win)).toHaveAttribute('aria-expanded', 'true');
  await section(win).scrollIntoViewIfNeeded();
  return section(win);
}

/**
 * The fit rule for the section in the live column at 1024 × 645 (nothing cut short): the section can be taller than the
 * part of the column in sight (it scrolls, as Audio and Lower Thirds open do), so it is checked part by part: nothing
 * sideways (expectFits' own checks of the window's width and every button's words), and each part, brought into sight
 * by the column's scroll, whole inside the column's visible box and the window.
 */
async function expectSectionFits(chat: Locator, what: string): Promise<void> {
  const parts = ['chat-messages-box', 'chat-composer', 'chat-invite-slot', 'chat-people'];
  if ((await chat.getByTestId('chat-people-list').count()) > 0) parts.push('chat-people-list');
  for (const id of parts) {
    const part = chat.getByTestId(id);
    await part.scrollIntoViewIfNeeded();
    const problems = await part.evaluate((el) => {
      const out: string[] = [];
      let scroller: HTMLElement | null = el.parentElement;
      while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY))
        scroller = scroller.parentElement;
      const r = el.getBoundingClientRect();
      const s = scroller?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
      const top = Math.max(s.top, 0);
      const bottom = Math.min(s.bottom, innerHeight);
      if (r.top < top - 0.5 || r.bottom > bottom + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5)
        out.push(
          `cut off: ${[r.left, r.top, r.right, r.bottom].map(Math.round).join(',')} in ${[s.left, top, s.right, bottom].map(Math.round).join(',')}`,
        );
      for (const b of el.querySelectorAll('button'))
        if (b.getBoundingClientRect().width > 0 && b.scrollWidth > b.clientWidth + 1)
          out.push(`“${b.textContent}”: its words do not fit`);
      if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways');
      return out;
    });
    expect(problems, `${what}: ${id}`).toEqual([]);
  }
}

const chatView = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.chat.view());

/** Every part of the window that scrolls, at its top or at its end, then two frames (as operator-fit.spec.ts does). */
async function scrollEverything(win: Page, end: boolean): Promise<void> {
  await win.evaluate((end) => {
    for (const el of document.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
      const y = getComputedStyle(el).overflowY;
      if (y === 'auto' || y === 'scroll') el.scrollTop = end ? el.scrollHeight : 0;
    }
  }, end);
  await win.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test('the Chat section under LIVE: folded after Messages, then Send as the operator (its words stay words), the count near the limit, Clear chat asked first; it fits 1024 × 645 ', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);

  // Under LIVE, after Messages and before Timers, folded at the start.
  await expect(toggle(win)).toHaveAttribute('aria-expanded', 'false');
  const tops = await win.evaluate(() =>
    ['group-messages-toggle', 'group-chat-toggle', 'group-timers-toggle'].map(
      (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? null,
    ),
  );
  expect(tops).not.toContain(null);
  expect((tops[0] ?? 0) < (tops[1] ?? 0) && (tops[1] ?? 0) < (tops[2] ?? 0), 'Messages, Chat, Timers').toBe(
    true,
  );

  const chat = await openChat(win);
  await expect(chat.getByTestId('chat-empty')).toContainText('No messages yet today');
  await expect(chat.getByTestId('chat-clear')).toBeDisabled();

  // Sent with Enter, as the operator: on the right, no name above, its words as words (never HTML).
  const box = chat.getByTestId('chat-text-box');
  const words = '<b>Placeholder</b> words & 👍🏽';
  await box.fill(words);
  await box.press('Enter');
  const mine = chat.getByTestId('chat-message');
  await expect(mine).toHaveCount(1);
  await expect(mine).toHaveAttribute('data-mine', 'true');
  await expect(mine.getByTestId('chat-text')).toHaveText(words);
  await expect(mine.locator('b')).toHaveCount(0);
  await expect(mine.getByTestId('chat-sender')).toHaveCount(0);
  await expect(box).toHaveValue('');
  // Sent, the box lets the focus go: the next key (a clicker's Next) is the show's (a22-review-chat O-S2).
  await expect(box).not.toBeFocused();
  expect(await win.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');
  // Escape leaves the box too, the words kept.
  await box.fill('Placeholder half typed');
  await box.press('Escape');
  await expect(box).not.toBeFocused();
  await expect(box).toHaveValue('Placeholder half typed');
  await expect.poll(async () => (await chatView(win)).messages.map((m) => m.text)).toEqual([words]);

  // Shift+Enter starts a new line; Enter sends both.
  await box.fill('Placeholder line one');
  await box.press('Shift+Enter');
  await box.pressSequentially('Placeholder line two');
  await box.press('Enter');
  await expect(chat.getByTestId('chat-message')).toHaveCount(2);
  await expect(chat.getByTestId('chat-text').last()).toHaveText('Placeholder line one\nPlaceholder line two');

  // Near the limit the box says how many are left; past it, how many too many, and Send waits (the words all kept).
  await box.fill('a'.repeat(CHAT_TEXT_MAX - 20));
  await expect(chat.getByTestId('chat-composer-line')).toHaveText('20 characters left');
  await expect(chat.getByTestId('chat-send')).toBeEnabled();
  await box.fill('a'.repeat(CHAT_TEXT_MAX + 1));
  await expect(chat.getByTestId('chat-composer-line')).toHaveText(
    `1 character too many: ${String(CHAT_TEXT_MAX)} at most`,
  );
  await expect(chat.getByTestId('chat-send')).toBeDisabled();
  await expect(box).toHaveValue('a'.repeat(CHAT_TEXT_MAX + 1));
  await box.fill('');

  // Laid out at CI's window, and for a screen reader and the keyboard.
  await chat.getByTestId('chat-people-toggle').click();
  await expectSectionFits(chat, 'the Chat section, open, at 1024 × 645');
  await chat.getByTestId('chat-people-toggle').click();
  await expectNoSeriousA11yIssues(win, 'the Chat section, open', '[data-testid="section-chat"]');

  // Clear chat: asked first; Cancel keeps it; Clear chat empties it.
  await chat.getByTestId('chat-clear').click();
  const confirm = win.getByTestId('chat-clear-confirm');
  await expect(confirm).toContainText('This cannot be undone.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(chat.getByTestId('chat-message')).toHaveCount(2);
  await chat.getByTestId('chat-clear').click();
  await confirm.getByRole('button', { name: 'Clear chat' }).click();
  await expect(chat.getByTestId('chat-empty')).toBeVisible();
  await expect.poll(async () => (await chatView(win)).messages.length).toBe(0);
  await app.close();
});

test('a phone’s message: counted on the folded heading, named above it on the left, the count gone once opened; the person removed is cut off at once; the Chat QR in Phones', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder phone');
  const named = await apiCall(port, CHAT_API.name, {
    method: 'POST',
    token,
    body: { name: 'Placeholder Sender' },
  });
  expect(named.status).toBe(200);

  // Folded: a message from the phone is counted on the heading, in words for a screen reader.
  await expect(toggle(win)).toHaveAttribute('aria-expanded', 'false');
  const sent = await apiCall(port, CHAT_API.send, {
    method: 'POST',
    token,
    body: { text: 'Placeholder from a phone' },
  });
  expect(sent.status).toBe(200);
  const unread = section(win).getByTestId('chat-unread');
  await expect(unread).toHaveText(/^1, 1 new message$/u);
  await expect(toggle(win)).toHaveAccessibleName(/Chat.*1 new message/u);

  // Opened: named above, on the left; the count goes.
  const chat = await openChat(win);
  const theirs = chat.getByTestId('chat-message');
  await expect(theirs).toHaveCount(1);
  // More coming in move nothing under the section (a22-review-chat O-S1): Timers' heading stays where it is.
  const timersTop = async () => (await win.getByTestId('group-timers-toggle').boundingBox())?.y ?? null;
  const before = await timersTop();
  for (const n of [2, 3, 4])
    expect(
      (
        await apiCall(port, CHAT_API.send, {
          method: 'POST',
          token,
          body: { text: `Placeholder more ${String(n)}` },
        })
      ).status,
    ).toBe(200);
  await expect(theirs).toHaveCount(4);
  expect(await timersTop()).toBe(before);
  for (const one of await theirs.all()) await expect(one).toHaveAttribute('data-mine', 'false');
  // Named above the first of the run only, as a WhatsApp group does.
  await expect(chat.getByTestId('chat-sender')).toHaveText(['Placeholder Sender']);
  await expect(theirs.getByTestId('chat-text').first()).toHaveText('Placeholder from a phone');
  await expect(unread).toHaveCount(0);

  // The people: Remove… asks first, then the phone is cut off at once.
  await chat.getByTestId('chat-people-toggle').click();
  const person = chat.getByTestId('chat-person').filter({ hasText: 'Placeholder Sender' });
  await expect(person).toContainText('Remote');
  await person.getByTestId('chat-remove-person').click();
  const confirm = win.getByTestId('chat-remove-confirm');
  await expect(confirm).toContainText('Placeholder Sender’s phone is cut off at once');
  await expect(confirm.getByRole('heading')).not.toContainText('Placeholder Sender');
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(chat.getByTestId('chat-person')).toHaveCount(0);
  const after = await apiCall(port, CHAT_API.send, {
    method: 'POST',
    token,
    body: { text: 'Placeholder again' },
  });
  expect(after.status).toBe(401);

  // The Chat QR in Phones: shown with how long it works, then stopped.
  await win.getByTestId('open-network').click();
  const panel = win.getByTestId('network-panel');
  const invite = panel.getByTestId('chat-invite');
  await invite.getByTestId('chat-invite-show').click();
  await expect(invite.getByTestId('qr-code')).toBeVisible();
  await expect(invite.getByTestId('chat-invite-left')).toContainText(/Works for \d+:\d\d more/u);
  await expect
    .poll(() =>
      win.evaluate(async () => (await (globalThis as PageGlobals).drashti.network.status()).chatInvite),
    )
    .not.toBeNull();
  await expectFits(panel, 'the Phones panel with the Chat QR');
  await invite.getByTestId('chat-invite-end').click();
  await expect(invite.getByTestId('chat-invite-show')).toBeVisible();
  await expect.poll(async () => (await chatView(win)).invite).toBeNull();
  await app.close();
});

test('Simple Mode with Chat chosen: the section under Audio, reading and sending; no Clear chat, no Remove…', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder phone');
  expect(
    (await apiCall(port, CHAT_API.name, { method: 'POST', token, body: { name: 'Placeholder Sender' } }))
      .status,
  ).toBe(200);
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSimpleFeature('chat', true)),
  ).toEqual({ ok: true, chosen: ['chat'] });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toHaveCount(1);

  const chat = await openChat(win);
  await expect(chat.getByTestId('chat-clear')).toHaveCount(0);
  const box = chat.getByTestId('chat-text-box');
  await box.fill('Placeholder from Simple Mode');
  await box.press('Enter');
  await expect(chat.getByTestId('chat-message')).toHaveCount(1);
  await chat.getByTestId('chat-people-toggle').click();
  await expect(chat.getByTestId('chat-person')).toHaveCount(1);
  await expect(chat.getByTestId('chat-remove-person')).toHaveCount(0);
  await expectSectionFits(chat, 'Simple Mode’s Chat section at 1024 × 645');
  // The live column's full rule too (operator-fit.spec.ts's fitFaults, a22-review-chat): Simple Mode's window with Chat
  // and its people open, every scroller at its top and at its end. The names given here may be cut short with an
  // ellipsis; Drashti's own words may not.
  const given = ['Placeholder Sender', 'Placeholder phone', 'Placeholder from Simple Mode'];
  for (const end of [false, true]) {
    await scrollEverything(win, end);
    expect(
      await fitFaults(win, given),
      `Simple Mode, Chat and its people open${end ? ', scrolled to the end' : ''}`,
    ).toEqual([]);
  }
  // Its Clear chat and Remove stay Pro Mode's in the main process too.
  const refused = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return [await d.chat.clear(), await d.chat.remove('placeholder-id'), await d.chat.invite()].map(
      (r) => r.ok,
    );
  });
  expect(refused).toEqual([false, false, false]);

  // Chat turned off in Pro Mode: gone from Simple Mode, and its Send refused there.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSimpleFeature('chat', false));
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toHaveCount(1);
  await expect(toggle(win)).toHaveCount(0);
  const send = await win.evaluate(() => (globalThis as PageGlobals).drashti.chat.send('Placeholder refused'));
  expect(send.ok).toBe(false);
  await app.close();
});

test('Report a Problem’s picture of the window has the open Chat section blanked: none of its words or names', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const chat = await openChat(win);
  // Words that draw dark and light marks across the box, so a picture that kept them could never read as one grey.
  const box = chat.getByTestId('chat-text-box');
  for (const line of [
    'Placeholder WWWW MMMM 8888',
    'Placeholder ████ ▓▓▓▓',
    'Placeholder words half typed',
  ]) {
    await box.fill(line);
    if (!line.includes('half typed')) await box.press('Enter');
  }
  await expect(chat.getByTestId('chat-message')).toHaveCount(2);
  // Where the private box is, as a share of the window (the picture's small copy is the window at 320 wide).
  const share = await win.evaluate(() => {
    const el = document.querySelector('[data-testid="section-chat"][data-report-private]');
    const scroller = document.querySelector('[data-testid="live-rest"]');
    if (!el || !scroller) return null;
    const r = el.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const top = Math.max(r.top, s.top);
    const bottom = Math.min(r.bottom, s.bottom, innerHeight);
    return {
      left: r.left / innerWidth,
      right: r.right / innerWidth,
      top: top / innerHeight,
      bottom: bottom / innerHeight,
    };
  });
  expect(share).not.toBeNull();
  expect((share?.bottom ?? 0) - (share?.top ?? 0), 'the open section is in sight').toBeGreaterThan(0.1);

  await chooseMenuItem(app, 'report-problem');
  const dialog = win.getByRole('dialog', { name: 'Report a Problem' });
  await expect(dialog).toBeVisible();
  const thumb = dialog.locator('img[src^="data:image/jpeg"]');
  await expect(thumb).toHaveCount(1);
  // Every pixel well inside the box is the flat grey the blanking draws (a JPEG's few levels either way).
  const seen = await thumb.evaluate(async (img: HTMLImageElement, at) => {
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d');
    if (!g || !at) return null;
    g.drawImage(img, 0, 0);
    const x0 = Math.ceil(at.left * canvas.width) + 3;
    const x1 = Math.floor(at.right * canvas.width) - 3;
    const y0 = Math.ceil(at.top * canvas.height) + 3;
    const y1 = Math.floor(at.bottom * canvas.height) - 3;
    const data = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let off = 0;
    for (let i = 0; i < data.length; i += 4)
      off = Math.max(off, ...[0, 1, 2].map((c) => Math.abs((data[i + c] ?? 0) - 128)));
    return { pixels: data.length / 4, off };
  }, share);
  expect(seen?.pixels ?? 0, 'pixels looked at').toBeGreaterThan(200);
  expect(seen?.off ?? 255, 'the furthest any pixel in the box is from the blank grey').toBeLessThanOrEqual(
    12,
  );
  await app.close();
});
