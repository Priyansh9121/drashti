import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  closeLibrary,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';
import { makeTestImage, makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The quick bar (Session 55, Part 8, the owner's idea F): up to 8 pinned items (a row, a picture, a video, a message),
 * one press each, just above the bar of clears, with keys (Alt+1 to Alt+8; Option+1 to Option+8 on a Mac). Hidden when
 * empty. Pinned from the one right-click menu and from Messages; taken off from its own right-click. Pro Mode's only:
 * Simple Mode shows none, its keys do nothing there, and the main process refuses changing it. At CI's 1024 × 645 and
 * at 1280 × 720. Placeholder files and words only, made here.
 */

const PICTURE = 'Placeholder backdrop';
const VIDEO = 'Placeholder clip';
const WORDS = 'Placeholder words';
const MESSAGE = 'Placeholder welcome';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);
/** The engine's revision: it moves with every change. */
const revOf = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).rev);
/** What the background shows, by its media id (null for none or a colour). */
const backgroundOf = (s: Awaited<ReturnType<typeof state>>) =>
  s.layers.background?.kind === 'media' ? s.layers.background.mediaId : null;

const bar = (win: Page) => win.getByTestId('quick-bar');
const pins = (win: Page) => bar(win).getByTestId('quick-pin');

/** Right-click on something, then choose a menu entry by its words. */
async function menuChoose(win: Page, on: Locator, entry: string): Promise<void> {
  await on.click({ button: 'right' });
  const item = win.getByRole('menuitem', { name: entry });
  await expect(item).toBeVisible();
  await item.click();
  await expect(item).toHaveCount(0);
}

/** The quick bar just above the bar of clears, both whole in the window, every pin's words inside it. */
async function expectFits(win: Page, what: string): Promise<void> {
  const problems = await win.evaluate(() => {
    const out: string[] = [];
    const quick = document.querySelector('[data-testid="quick-bar"]');
    const layers = document.querySelector('[data-testid="layer-bar"]');
    if (!quick || !layers) return ['no quick bar or no bar of clears'];
    const q = quick.getBoundingClientRect();
    const l = layers.getBoundingClientRect();
    if (Math.abs(q.bottom - l.top) > 1.5)
      out.push(
        `the quick bar (bottom ${String(q.bottom)}) is not just above the bar of clears (${String(l.top)})`,
      );
    for (const [name, r] of [
      ['quick bar', q],
      ['bar of clears', l],
    ] as const)
      if (r.left < -0.5 || r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5)
        out.push(`the ${name} is cut off`);
    if (q.height > 48) out.push(`the quick bar is ${String(q.height)} px tall: more than one row`);
    if (document.documentElement.scrollWidth > window.innerWidth) out.push('the page scrolls sideways');
    for (const b of quick.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (r.right > q.right + 0.5 || r.left < q.left - 0.5)
        out.push(`${b.textContent.trim()}: outside the bar`);
      if (r.width < 24 || r.height < 24) out.push(`${b.textContent.trim()}: smaller than 24 × 24`);
    }
    return out;
  });
  expect(problems, what).toEqual([]);
}

test('the quick bar: hidden when empty; a picture, a slide row, a video row and a message pinned; one press or Alt+N puts each up; taken off; kept after a restart; at 1024 × 645 and 1280 × 720', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // Hidden when empty.
  await expect(win.getByTestId('layer-bar')).toBeVisible();
  await expect(bar(win)).toHaveCount(0);

  const dir = mkdtempSync(join(tmpdir(), 'drashti-quick-bar-'));
  const files = [
    await makeTestImage(win, join(dir, `${PICTURE}.png`), { color: '#1e3a8a' }),
    await makeTestVideo(win, join(dir, `${VIDEO}.webm`), { seconds: 2 }),
  ];
  const [pictureId = '', videoId = ''] = await importAndGetIds(win, files);
  const made = await win.evaluate(
    async (adding) => {
      const d = (globalThis as PageGlobals).drashti;
      const words = await d.library.newFromWords(
        adding.words,
        'Placeholder first slide\n\nPlaceholder second slide',
      );
      if (!words.ok) throw new Error(words.message);
      const list = await d.playlists.create('Placeholder quick', null, false);
      if (!list.ok) throw new Error(list.message);
      const added = await d.playlists.addItems(list.ids[0] ?? '', null, [
        { kind: 'presentation', presentationId: words.id },
        { kind: 'media', mediaId: adding.videoId },
      ]);
      if (!added.ok) throw new Error(added.message);
      const message = await d.messages.create({
        name: adding.message,
        template: 'Placeholder welcome words',
        fields: {},
      });
      if (!message.ok) throw new Error(message.message);
      return { playlistId: list.ids[0] ?? '', items: added.ids, wordsId: words.id };
    },
    { videoId, words: WORDS, message: MESSAGE },
  );
  const [wordsItem = '', videoItem = ''] = made.items;
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder quick' }).click();
  const row = (itemId: string) => win.getByTestId('open-playlist').locator(`[data-item-row="${itemId}"]`);
  await expect(row(wordsItem).getByTestId('slide-thumb')).toHaveCount(2);

  // A picture from Media, by its right-click: the quick bar appears with it, its key beside it.
  await openLibrary(win);
  await win.getByRole('tab', { name: 'Media' }).click();
  const picture = win.getByTestId('media-row').filter({ hasText: PICTURE }).getByTestId('media-item');
  await menuChoose(win, picture, 'Pin to the quick bar');
  await expect(pins(win)).toHaveCount(1);
  await expect(pins(win).first()).toContainText(PICTURE);
  await expect(pins(win).first().getByTestId('quick-key')).toHaveText(/^(⌥1|Alt\+1)$/u);
  // Pinned once: its menu now offers to take it off instead.
  await picture.click({ button: 'right' });
  await expect(win.getByRole('menuitem', { name: 'Unpin from the quick bar' })).toBeVisible();
  await expect(win.getByRole('menuitem', { name: 'Pin to the quick bar' })).toHaveCount(0);
  await win.keyboard.press('Escape');
  await closeLibrary(win);

  // A slide's row (the presentation's second), and the video's row, from the open playlist.
  await menuChoose(win, row(wordsItem).getByTestId('slide-thumb').nth(1), 'Pin to the quick bar');
  await menuChoose(win, row(videoItem).getByTestId('playlist-item'), 'Pin to the quick bar');
  // A message, from Messages.
  const message = win.getByTestId('messages').getByTestId('message-row').filter({ hasText: MESSAGE });
  await message.getByRole('button', { name: `Pin “${MESSAGE}” to the quick bar` }).click();
  await expect(pins(win)).toHaveCount(4);
  await expect(pins(win)).toContainText([PICTURE, `${WORDS}_2`, VIDEO, MESSAGE]);
  await expectFits(win, 'the quick bar at 1024 × 645');
  await expectNoSeriousA11yIssues(win, 'the quick bar', '[data-testid="quick-bar"]');

  // Alt+2 (Option+2 on a Mac): the slide, up from its playlist row, so Next goes on from it.
  await win.keyboard.press('Alt+Digit2');
  await expect
    .poll(async () => (await state(win)).live)
    .toMatchObject({ presentationId: made.wordsId, slideIndex: 1, playlist: { itemId: wordsItem } });
  // Alt+1: the picture, instead of the slide.
  await win.keyboard.press('Alt+Digit1');
  await expect
    .poll(async () => {
      const s = await state(win);
      return { background: backgroundOf(s), slide: s.layers.slide };
    })
    .toEqual({ background: pictureId, slide: null });
  // A click on the third: the video's row, as a click on the row does.
  await pins(win).nth(2).click();
  await expect
    .poll(async () => {
      const s = await state(win);
      return { background: backgroundOf(s), item: s.live.playlist?.itemId ?? null };
    })
    .toEqual({ background: videoId, item: videoItem });
  // Alt+4: the message, on the screens.
  await win.keyboard.press('Alt+Digit4');
  await expect
    .poll(async () => (await state(win)).layers.messages.map((m) => m.text))
    .toEqual(['Placeholder welcome words']);
  // A key with no pin does nothing.
  const before = await revOf(win);
  await win.keyboard.press('Alt+Digit7');
  expect(await revOf(win)).toBe(before);

  // Taken off from its own right-click; the rest move up a key.
  await menuChoose(win, pins(win).first(), 'Unpin from the quick bar');
  await expect(pins(win)).toHaveCount(3);
  await expect(pins(win).first()).toContainText(`${WORDS}_2`);
  await expect(pins(win).first().getByTestId('quick-key')).toHaveText(/^(⌥1|Alt\+1)$/u);

  // At 1280 × 720 too.
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  await expectFits(win, 'the quick bar at 1280 × 720');

  // Kept with the library: there after a restart, in its order.
  await app.close();
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await expect(pins(win2)).toHaveCount(3);
  await expect(pins(win2)).toContainText([`${WORDS}_2`, VIDEO, MESSAGE]);
  // Every pin taken off: hidden again.
  for (let i = 0; i < 3; i++) await menuChoose(win2, pins(win2).first(), 'Unpin from the quick bar');
  await expect(bar(win2)).toHaveCount(0);
  await again.app.close();
});

test('Simple Mode has no quick bar: none shows, its keys do nothing, and the main process refuses changing it', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-quick-simple-'));
  const [pictureId = ''] = await importAndGetIds(win, [
    await makeTestImage(win, join(dir, `${PICTURE}.png`), { color: '#14532d' }),
  ]);
  const set = await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.quickBar.set([
        { kind: 'media', mediaId: id, media: 'image', label: 'Placeholder backdrop' },
      ]),
    pictureId,
  );
  expect(set.ok).toBe(true);
  await expect(pins(win)).toHaveCount(1);

  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(bar(win)).toHaveCount(0);
  // Alt+1 puts nothing up in Simple Mode.
  const before = await revOf(win);
  await win.keyboard.press('Alt+Digit1');
  expect((await state(win)).layers.background).toBeNull();
  expect(await revOf(win)).toBe(before);
  // Changing the pins is refused by the main process, whoever asks.
  const refused = await win.evaluate(() => (globalThis as PageGlobals).drashti.quickBar.set([]));
  expect(refused.ok).toBe(false);
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.quickBar.view())).toHaveLength(1);

  // Back in Pro Mode, there it is again.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
  await expect(pins(win)).toHaveCount(1);
  await app.close();
});
