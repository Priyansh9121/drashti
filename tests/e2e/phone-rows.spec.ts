import { longPress } from './phone-gestures';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, type Engine, networkOn, NETWORK_ENV, pairByQr, pairingCode, TABLET } from './devices';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { KIRTAN, PICTURE, setUpPlaceholderShow, VIDEO, WELCOME } from './placeholder-show';

/*
 * The phone (Session 55, Part 9): what Parts 4–8 gave the operator window, on a phone and a tablet, in Safari's and
 * Chrome's engines, upright and sideways. The playlist as rows (a presentation's name, which folds, and a row a slide
 * under it, "<name>_N"), one tap putting a row up; a long press opening the row's menu (Look at it, the Picture editor,
 * Save picture, When it ends, Pin to the quick bar, Rename, Remove with Undo); the quick bar's pins, one tap each.
 * Every control a thumb's size (44 px). Placeholder content only; codes and tokens made at run time.
 */

const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** Where the show is: the live presentation, its slide's place, and the playlist row it is from. */
async function where(win: Page) {
  const s = await snapshot(win);
  return {
    presentationId: s.live.presentationId,
    slideIndex: s.layers.slide?.slideIndex ?? null,
    itemId: s.live.playlist?.itemId ?? null,
  };
}

/** Every visible control under 44 × 44 CSS pixels in this part of the page. */
const tooSmall = (within: Locator) =>
  within.evaluate((root) =>
    [
      ...root.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type="hidden"]), select, [role="tab"], [role="button"]',
      ),
    ]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 40),
          w: r.width,
          h: r.height,
        };
      })
      .filter(({ w, h }) => w < 44 || h < 44)
      .map(({ name, w, h }) => `${name} (${String(Math.round(w))} × ${String(Math.round(h))})`),
  );

/** Nothing runs past the page's right edge (no sideways scroll on a phone). */
const overflowsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

const rows = (p: Page) => p.getByTestId('remote-items');
const slideRow = (p: Page, label: string) => rows(p).getByTestId('remote-row').filter({ hasText: label });
const nameRow = (p: Page, name: string) =>
  rows(p).locator('[data-testid="remote-item"][data-kind="group"]').filter({ hasText: name });
const fileRow = (p: Page, name: string) =>
  rows(p).locator('[data-testid="remote-item"][data-kind="media"]').filter({ hasText: name });

for (const engine of ['webkit', 'chromium'] as const satisfies readonly Engine[])
  test(`the playlist on a phone (${engine === 'webkit' ? 'Safari’s' : 'Chrome’s'} engine) is rows: a presentation’s name that folds and a row a slide under it, one tap puts a row up and Next goes on from it, upright and sideways, every row a thumb’s size`, async () => {
    test.setTimeout(240_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await p.setViewportSize({ width: 375, height: 812 });
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      await p.getByTestId('remote-tab-playlist').click();
      await p.getByTestId('remote-playlist').selectOption(show.playlistId);

      // The kirtan: its name, and a row a slide under it, "<name>_N" with its first line.
      await expect(nameRow(p, KIRTAN)).toHaveAttribute('aria-expanded', 'true');
      await expect(slideRow(p, `${KIRTAN}_`)).toHaveCount(5);
      await expect(slideRow(p, `${KIRTAN}_1`)).toContainText('Placeholder chorus line');
      await expect(slideRow(p, `${KIRTAN}_2`)).toContainText('Placeholder first verse');
      await expect(slideRow(p, `${WELCOME}_1`)).toContainText('Placeholder welcome to the sabha');
      await expect(rows(p).getByTestId('remote-row-header').filter({ hasText: 'Kirtan' })).toBeVisible();

      // One tap on a slide's row puts it up at once, from its row: Next goes on from it.
      await slideRow(p, `${KIRTAN}_4`).click();
      const kirtanItem = (await where(win)).itemId;
      await expect
        .poll(() => where(win))
        .toEqual({ presentationId: show.kirtanId, slideIndex: 3, itemId: kirtanItem });
      expect(kirtanItem).not.toBeNull();
      await expect(slideRow(p, `${KIRTAN}_4`)).toHaveAttribute('data-live', 'true');
      await p.getByTestId('remote-next-button').click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(4);
      await expect(slideRow(p, `${KIRTAN}_5`)).toHaveAttribute('data-live', 'true');

      // Its name folds its slides, and opens them again; it stays where it is in the playlist.
      await nameRow(p, KIRTAN).click();
      await expect(nameRow(p, KIRTAN)).toHaveAttribute('aria-expanded', 'false');
      await expect(slideRow(p, `${KIRTAN}_`)).toHaveCount(0);
      await nameRow(p, KIRTAN).click();
      await expect(slideRow(p, `${KIRTAN}_`)).toHaveCount(5);

      // A picture's row: up with one tap, as the background.
      await fileRow(p, PICTURE).click();
      await expect
        .poll(async () => {
          const bg = (await snapshot(win)).layers.background;
          return bg?.kind === 'media' ? bg.mediaId : null;
        })
        .toBe(show.pictureMediaId);
      await expect(fileRow(p, PICTURE)).toHaveAttribute('data-live', 'true');

      // A thumb's size, nothing past the edge, and nothing serious for a screen reader.
      expect(await tooSmall(rows(p))).toEqual([]);
      expect(await overflowsSideways(p)).toBe(false);
      await expectNoSeriousA11yIssues(p, `the playlist’s rows on a phone (${engine})`);

      // Sideways: the same rows, still one tap each.
      await p.setViewportSize({ width: 812, height: 375 });
      await expect(p.getByTestId('remote')).toHaveAttribute('data-layout', 'phone');
      await p.getByTestId('remote-tab-playlist').click();
      await slideRow(p, `${WELCOME}_1`).click();
      await expect.poll(async () => (await where(win)).presentationId).toBe(show.welcomeId);
      expect(await tooSmall(rows(p))).toEqual([]);
      expect(await overflowsSideways(p)).toBe(false);
    } finally {
      await phone.close();
    }
    await app.close();
  });

test('on a tablet, upright and sideways, the playlist beside the show is rows too, one tap each (Safari’s engine)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder tablet');
  const tablet = await device('webkit', TABLET);
  const t = tablet.page;
  try {
    await pairByQr(t, base, code, '/remote');
    await expect(t.getByTestId('connection')).toHaveText('Connected');
    // Upright: the playlist beside the show.
    await expect(t.getByTestId('remote')).toHaveAttribute('data-layout', 'wide');
    await t.getByTestId('remote-playlist').selectOption(show.playlistId);
    await expect(slideRow(t, `${KIRTAN}_2`)).toBeVisible();
    await slideRow(t, `${KIRTAN}_2`).click();
    await expect.poll(async () => (await where(win)).slideIndex).toBe(1);
    expect(await tooSmall(rows(t))).toEqual([]);
    await expectNoSeriousA11yIssues(t, 'the playlist’s rows on a tablet, upright');
    // Sideways: the panel beside the live picture, its Playlist tab.
    await t.setViewportSize({ width: 1080, height: 810 });
    await expect(t.getByTestId('remote')).toHaveAttribute('data-layout', 'landscape');
    await t.getByTestId('remote-panel-playlist').click();
    await slideRow(t, `${KIRTAN}_3`).click();
    await expect.poll(async () => (await where(win)).slideIndex).toBe(2);
    expect(await tooSmall(rows(t))).toEqual([]);
    expect(await overflowsSideways(t)).toBe(false);
  } finally {
    await tablet.close();
  }
  await app.close();
});

test('a long press on a row opens its menu on a phone: Rename, When it ends, Pin to the quick bar (its pin one tap on the Show tab), Remove with Undo (Chrome’s engine)', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win, { video: true });
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  const items = () =>
    win.evaluate(async (id) => (globalThis as PageGlobals).drashti.playlists.items(id), show.playlistId);
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-playlist').click();
    await p.getByTestId('remote-playlist').selectOption(show.playlistId);
    const menu = p.getByTestId('remote-row-menu');

    // The picture's menu: what the window's has that a phone can do, a thumb's size, in its order.
    await longPress(fileRow(p, PICTURE));
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('heading')).toContainText(PICTURE);
    await expect(menu.locator('[data-testid^="remote-menu-"]')).toHaveText([
      /Look at it on this phone/u,
      /Picture editor/u,
      /Save picture/u,
      /Pin to the quick bar/u,
      /Rename/u,
      /Remove from playlist/u,
    ]);
    // Nothing went up as the finger lifted.
    expect((await snapshot(win)).layers.background).toBeNull();
    expect(await tooSmall(menu)).toEqual([]);
    await expectNoSeriousA11yIssues(p, 'a row’s menu on a phone');

    // Pin to the quick bar: the window's bar has it, and the phone's Show tab has it, one tap putting it up.
    await menu.getByTestId('remote-menu-pin').click();
    await expect(menu).toHaveCount(0);
    await expect
      .poll(
        async () => (await win.evaluate(() => (globalThis as PageGlobals).drashti.quickBar.view())).length,
      )
      .toBe(1);
    await p.getByTestId('remote-tab-show').click();
    const bar = p.getByTestId('remote-quick-bar');
    await expect(bar.getByTestId('remote-quick-pin')).toHaveText([new RegExp(PICTURE, 'u')]);
    await bar.getByTestId('remote-quick-pin').click();
    await expect
      .poll(async () => {
        const bg = (await snapshot(win)).layers.background;
        return bg?.kind === 'media' ? bg.mediaId : null;
      })
      .toBe(show.pictureMediaId);
    // A pin's own long press: Unpin (and Move left, Move right).
    await longPress(bar.getByTestId('remote-quick-pin'));
    await expect(menu.getByTestId('remote-menu-unpin')).toBeVisible();
    await menu.getByTestId('remote-menu-unpin').click();
    await expect(bar).toHaveCount(0);
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.quickBar.view())).toEqual([]);

    // When it ends, on the video's row: Loop, kept with the row.
    await p.getByTestId('remote-tab-playlist').click();
    await longPress(fileRow(p, VIDEO));
    await expect(menu.getByTestId('remote-menu-when-wallpaper')).toHaveAttribute('aria-pressed', 'true');
    await menu.getByTestId('remote-menu-when-loop').click();
    await expect
      .poll(async () => (await items()).find((i) => i.kind === 'media' && i.mediaId === show.videoMediaId))
      .toMatchObject({ whenEnds: 'loop' });

    // Rename…: the picture in the library, its row following.
    await longPress(fileRow(p, PICTURE));
    await menu.getByTestId('remote-menu-rename').click();
    const renaming = p.getByTestId('remote-rename');
    await renaming.getByRole('textbox').fill('Placeholder backdrop, renamed');
    await renaming.getByTestId('remote-rename-save').click();
    await expect(fileRow(p, 'Placeholder backdrop, renamed')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).find(
            (m) => m.id === show.pictureMediaId,
          )?.name,
      )
      .toBe('Placeholder backdrop, renamed');

    // Remove from playlist: the welcome's row goes (the library keeps it), and Undo puts it back where it was.
    const before = (await items()).map((i) => i.id);
    await longPress(slideRow(p, `${WELCOME}_1`));
    await menu.getByTestId('remote-menu-remove').click();
    await expect(slideRow(p, `${WELCOME}_1`)).toHaveCount(0);
    await expect.poll(async () => (await items()).length).toBe(before.length - 1);
    await p.getByTestId('remote-rows-undo').click();
    await expect(slideRow(p, `${WELCOME}_1`)).toBeVisible();
    await expect.poll(async () => (await items()).map((i) => i.id)).toEqual(before);
    expect(await overflowsSideways(p)).toBe(false);
  } finally {
    await phone.close();
  }
  await app.close();
});

test('on a phone, Save picture… hands the picture over, and the Picture editor turns, flips and crops it, kept with the picture (Chrome’s engine)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  const look = () =>
    win.evaluate(async (id) => (globalThis as PageGlobals).drashti.media.look(id), show.pictureMediaId);
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-playlist').click();
    await p.getByTestId('remote-playlist').selectOption(show.playlistId);
    const menu = p.getByTestId('remote-row-menu');

    // Save picture…: handed to the phone's Share sheet where it has one (a stand-in here, which keeps what it was
    // handed), else downloaded (a phone's browser over plain http has none).
    await p.evaluate(() => {
      const kept: { name: string; type: string; size: number }[] = [];
      Object.assign(globalThis, { sharedFiles: kept });
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data: { files: File[] }) => {
          for (const f of data.files) kept.push({ name: f.name, type: f.type, size: f.size });
          return Promise.resolve();
        },
      });
    });
    await longPress(fileRow(p, PICTURE));
    await menu.getByTestId('remote-menu-save').click();
    await expect
      .poll(() => p.evaluate(() => (globalThis as unknown as { sharedFiles: unknown[] }).sharedFiles))
      .toEqual([{ name: `${PICTURE}.png`, type: 'image/png', size: expect.any(Number) as unknown }]);
    await p.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
    });
    await longPress(fileRow(p, PICTURE));
    const downloaded = p.waitForEvent('download');
    await menu.getByTestId('remote-menu-save').click();
    expect((await downloaded).suggestedFilename()).toBe(`${PICTURE}.png`);

    // The Picture editor: a quarter turn, flipped across, cropped square; saved, kept with the picture.
    await longPress(fileRow(p, PICTURE));
    await menu.getByTestId('remote-menu-edit').click();
    const editor = p.getByTestId('remote-picture-editor');
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('remote-pe-frame')).toBeVisible();
    await editor.getByTestId('remote-pe-turn').click();
    await editor.getByTestId('remote-pe-flip-x').click();
    await editor.getByTestId('remote-pe-crop-1:1').click();
    // The blurred fill: on for a photo, its switch says so.
    await expect(editor.getByTestId('remote-pe-fill')).toHaveAttribute('aria-checked', 'true');
    expect(await tooSmall(editor)).toEqual([]);
    expect(await overflowsSideways(p)).toBe(false);
    await expectNoSeriousA11yIssues(p, 'the Picture editor on a phone');
    await editor.getByTestId('remote-pe-save').click();
    await expect(editor).toHaveCount(0);
    await expect.poll(look).toMatchObject({ turn: 90, flipX: true, cropShape: '1:1' });
    // Square, out of a picture turned upright (180 × 320): its whole width, part of its height.
    const kept = await look();
    expect(kept?.crop?.w).toBe(1);
    expect(kept?.crop?.h).toBeCloseTo(180 / 320, 2);

    // As it was taken: everything put back.
    await longPress(fileRow(p, PICTURE));
    await menu.getByTestId('remote-menu-edit').click();
    await editor.getByTestId('remote-pe-reset').click();
    await editor.getByTestId('remote-pe-save').click();
    await expect.poll(look).toBeNull();
  } finally {
    await phone.close();
  }
  await app.close();
});
