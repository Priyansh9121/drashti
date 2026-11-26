import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, type Engine, networkOn, NETWORK_ENV, pairByQr, pairingCode, TABLET } from './devices';
import { launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals, slidesOf } from './helpers';
import { expectPhoneRefuses } from './phone-refuses';
import { KIRTAN, PICTURE, PLAYLIST, setUpPlaceholderShow, VIDEO, WELCOME } from './placeholder-show';

/*
 * The phone's rows (Session 55, Part 9: what Parts 4–8 gave the operator window, on a phone and a tablet, in Safari's
 * and Chrome's engines, upright and sideways) under the phone rule (alpha.23, QA23-PHONE-1, the owner: "no video
 * access in either of simple or pro mode in phone, they cant change videos, only ppts an pdfs"; Q4 "Only PPT and PDF";
 * Q8 "View only"). A phone is refused in words, with nothing changed, putting up a kirtan's or a welcome's slide or a
 * picture from its row, Next with none of a PowerPoint or a PDF up, and everything a row's long press offered: Pin to
 * the quick bar, When it ends, Rename, Remove with Undo, the Picture editor. What each did moved to the operator window
 * (as one-click, quick-bar, wallpapers and pictures-part5 walk them): one click on a slide's row puts it up from its row
 * and Next goes on, a presentation's name folds its slides, a picture's card goes up with one click, a pin, a video's
 * When it ends, a rename, a row removed and put back, a picture turned, flipped and cropped. The phone's page still lays
 * itself out upright and sideways, nothing past its edge, passing axe; its rows are the UI builder's. Placeholder
 * content only; codes and tokens made at run time.
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

/** Nothing runs past the page's right edge (no sideways scroll on a phone). */
const overflowsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

/** The playlist's rows by what they play, as the operator window keeps them. */
async function rowsOf(win: Page, playlistId: string) {
  const items = await win.evaluate(
    async (id) => (globalThis as PageGlobals).drashti.playlists.items(id),
    playlistId,
  );
  const of = (match: (i: (typeof items)[number]) => boolean) => items.find(match)?.id ?? '';
  return { items, of };
}

/** A card of the open playlist in the operator window (a presentation's name, a picture's or a video's row). */
const card = (win: Page, name: string): Locator =>
  win.getByTestId('open-playlist').getByTestId('playlist-item').filter({ hasText: name });

/** The playlist open in the operator window. */
async function openPlaylist(win: Page): Promise<void> {
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await expect(slidesOf(win, KIRTAN)).toHaveCount(5);
}

for (const engine of ['webkit', 'chromium'] as const satisfies readonly Engine[])
  test(`the playlist’s rows from a phone (${engine === 'webkit' ? 'Safari’s' : 'Chrome’s'} engine) are refused in words, a kirtan’s slide, Next and a picture; in the window one click on a slide’s row puts it up and Next goes on, its name folds, a picture goes up; the phone upright and sideways, nothing past its edge`, async () => {
    test.setTimeout(240_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    const { of } = await rowsOf(win, show.playlistId);
    const kirtanRow = of((i) => i.kind === 'presentation' && i.presentationId === show.kirtanId);
    const welcomeRow = of((i) => i.kind === 'presentation' && i.presentationId === show.welcomeId);
    const pictureRow = of((i) => i.kind === 'media' && i.mediaId === show.pictureMediaId);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await p.setViewportSize({ width: 375, height: 812 });
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      const fromPhone = { win, page: p };
      const playlist = (itemId: string) => ({ playlistId: show.playlistId, itemId });

      // A tap on the kirtan's fourth slide, from its row: refused (only a PowerPoint or a PDF goes up from a phone).
      await expectPhoneRefuses(
        fromPhone,
        'POST',
        '/api/v1/trigger/slide',
        { presentationId: show.kirtanId, slideIndex: 3, playlist: playlist(kirtanRow) },
        'notDeck',
      );
      // Moved to the window: one click on the slide's row puts it up at once, from its row; Next goes on from it.
      await openPlaylist(win);
      await slidesOf(win, KIRTAN).nth(3).click();
      await expect
        .poll(() => where(win))
        .toEqual({ presentationId: show.kirtanId, slideIndex: 3, itemId: kirtanRow });
      expect(kirtanRow).not.toBe('');
      // The phone's Next, a kirtan up: refused, the slide where it was.
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/trigger/next', {}, 'noDeck');
      await win.getByTestId('show-next').click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(4);

      // Moved to the window: its name folds its slides, and opens them again; it stays where it is in the playlist.
      await card(win, KIRTAN).click();
      await expect(card(win, KIRTAN)).toHaveAttribute('aria-expanded', 'false');
      await expect(slidesOf(win, KIRTAN)).toHaveCount(0);
      await card(win, KIRTAN).focus();
      await win.keyboard.press('Enter');
      await expect(slidesOf(win, KIRTAN)).toHaveCount(5);

      // A picture's row: the phone's tap refused; in the window, up with one click, as the background.
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/trigger/item', playlist(pictureRow), 'notDeck');
      await card(win, PICTURE).click();
      await expect
        .poll(async () => {
          const bg = (await snapshot(win)).layers.background;
          return bg?.kind === 'media' ? bg.mediaId : null;
        })
        .toBe(show.pictureMediaId);
      await expect(card(win, PICTURE)).toHaveAttribute('data-live', 'true');

      // The phone's page: nothing past the edge, and nothing serious for a screen reader.
      expect(await overflowsSideways(p)).toBe(false);
      await expectNoSeriousA11yIssues(p, `the remote on a phone (${engine})`);

      // Sideways (since alpha.21 the tabs at the side): the welcome's slide from a phone refused; in the window, up.
      await p.setViewportSize({ width: 812, height: 375 });
      await expect(p.getByTestId('remote')).toHaveAttribute('data-layout', 'sideways');
      await expectPhoneRefuses(
        fromPhone,
        'POST',
        '/api/v1/trigger/slide',
        { presentationId: show.welcomeId, slideIndex: 0, playlist: playlist(welcomeRow) },
        'notDeck',
      );
      await slidesOf(win, WELCOME).first().click();
      await expect.poll(async () => (await where(win)).presentationId).toBe(show.welcomeId);
      expect(await overflowsSideways(p)).toBe(false);
    } finally {
      await phone.close();
    }
    await app.close();
  });

test('on a tablet, upright and sideways, a kirtan’s slides from its rows are refused in words; in the window one click each puts them up (Safari’s engine)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const { of } = await rowsOf(win, show.playlistId);
  const kirtanRow = of((i) => i.kind === 'presentation' && i.presentationId === show.kirtanId);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder tablet');
  const tablet = await device('webkit', TABLET);
  const t = tablet.page;
  try {
    await pairByQr(t, base, code, '/remote');
    await expect(t.getByTestId('connection')).toHaveText('Connected');
    const fromTablet = { win, page: t };
    const slide = (slideIndex: number) => ({
      presentationId: show.kirtanId,
      slideIndex,
      playlist: { playlistId: show.playlistId, itemId: kirtanRow },
    });
    await openPlaylist(win);
    // Upright: the tablet's page beside the show; its tap on the kirtan's second slide refused, the window's up.
    await expect(t.getByTestId('remote')).toHaveAttribute('data-layout', 'wide');
    await expectPhoneRefuses(fromTablet, 'POST', '/api/v1/trigger/slide', slide(1), 'notDeck');
    await slidesOf(win, KIRTAN).nth(1).click();
    await expect.poll(async () => (await where(win)).slideIndex).toBe(1);
    await expectNoSeriousA11yIssues(t, 'the remote on a tablet, upright');
    // Sideways: the third, the same.
    await t.setViewportSize({ width: 1080, height: 810 });
    await expect(t.getByTestId('remote')).toHaveAttribute('data-layout', 'landscape');
    await expectPhoneRefuses(fromTablet, 'POST', '/api/v1/trigger/slide', slide(2), 'notDeck');
    await slidesOf(win, KIRTAN).nth(2).click();
    await expect.poll(async () => (await where(win)).slideIndex).toBe(2);
    expect(await overflowsSideways(t)).toBe(false);
  } finally {
    await tablet.close();
  }
  await app.close();
});

test('what a long press on a row offered is refused to a phone in words: Pin to the quick bar, When it ends, Rename, Remove with Undo; in the window each as before (Chrome’s engine)', async () => {
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
  const quickBar = () => win.evaluate(() => (globalThis as PageGlobals).drashti.quickBar.view());
  const nameOf = async (mediaId: string) =>
    (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).find(
      (m) => m.id === mediaId,
    )?.name;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const fromPhone = { win, page: p };
    const { of } = await rowsOf(win, show.playlistId);
    const pictureRow = of((i) => i.kind === 'media' && i.mediaId === show.pictureMediaId);
    const videoRow = of((i) => i.kind === 'media' && i.mediaId === show.videoMediaId);
    const welcomeRow = of((i) => i.kind === 'presentation' && i.presentationId === show.welcomeId);
    await openPlaylist(win);

    // Pin to the quick bar: the phone's quick bar and its pin refused; moved to the window: the card's right-click
    // pins it, the window's bar has it, one click putting it up; Unpin (through the window's bridge) takes it off.
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/quick-bar', undefined, 'computer', quickBar);
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/quick-bar',
      { pins: [{ kind: 'item', itemId: pictureRow }] },
      'computer',
      quickBar,
    );
    await card(win, PICTURE).click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Pin to the quick bar' }).click();
    await expect.poll(async () => (await quickBar()).length).toBe(1);
    // Nothing went up as it was pinned.
    expect((await snapshot(win)).layers.background).toBeNull();
    const pin = win.getByTestId('quick-bar').getByTestId('quick-pin');
    await expect(pin).toHaveText([new RegExp(PICTURE, 'u')]);
    await pin.click();
    await expect
      .poll(async () => {
        const bg = (await snapshot(win)).layers.background;
        return bg?.kind === 'media' ? bg.mediaId : null;
      })
      .toBe(show.pictureMediaId);
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.quickBar.set([]))).toMatchObject({
      ok: true,
    });
    await expect(win.getByTestId('quick-bar')).toHaveCount(0);
    expect(await quickBar()).toEqual([]);

    // When it ends, on the video's row: the phone's Loop refused; moved to the window: Loop, kept with the row.
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      `/api/v1/playlist-items/${videoRow}/when-ends`,
      { whenEnds: 'loop' },
      'computer',
      items,
    );
    expect(
      await win.evaluate(
        ({ itemId }) => (globalThis as PageGlobals).drashti.playlists.setWhenEnds(itemId, 'loop'),
        { itemId: videoRow },
      ),
    ).toMatchObject({ ok: true });
    await expect
      .poll(async () => (await items()).find((i) => i.kind === 'media' && i.mediaId === show.videoMediaId))
      .toMatchObject({ whenEnds: 'loop' });
    await expect(card(win, VIDEO)).toBeVisible();

    // Rename…: the phone's refused; moved to the window (its bridge, as the card's Rename… does): the picture in the
    // library, its row following.
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      `/api/v1/media/${show.pictureMediaId}/rename`,
      { name: 'Placeholder backdrop, renamed' },
      'media',
      () => nameOf(show.pictureMediaId),
    );
    const rename = (name: string) =>
      win.evaluate(({ id, name }) => (globalThis as PageGlobals).drashti.media.rename(id, name), {
        id: show.pictureMediaId,
        name,
      });
    expect(await rename('Placeholder backdrop, renamed')).toMatchObject({ ok: true });
    await expect.poll(() => nameOf(show.pictureMediaId)).toBe('Placeholder backdrop, renamed');
    await expect(card(win, 'Placeholder backdrop, renamed')).toBeVisible();
    // Session 58, X3: a name of hidden characters alone is refused in words, and a name kept leaves them out.
    expect(await rename('\u202E')).toMatchObject({ ok: false, message: 'A name needs 1 to 200 characters.' });
    expect(await rename('Placeholder backdrop, kept\u200F')).toMatchObject({ ok: true });
    await expect.poll(() => nameOf(show.pictureMediaId)).toBe('Placeholder backdrop, kept');

    // Remove from playlist: the phone's, and its Undo, refused; moved to the window (its bridge, as the row's Delete
    // and Undo do): the welcome's row goes (the library keeps it), and Undo puts it back where it was.
    const before = (await items()).map((i) => i.id);
    const order = async () => (await items()).map((i) => i.id);
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/playlist-items/delete',
      { itemIds: [welcomeRow] },
      'computer',
      order,
    );
    const removed = await win.evaluate(
      (ids) => (globalThis as PageGlobals).drashti.playlists.removeItems(ids),
      [welcomeRow],
    );
    expect(removed).toMatchObject({ ok: true });
    await expect(slidesOf(win, WELCOME)).toHaveCount(0);
    await expect.poll(async () => (await items()).length).toBe(before.length - 1);
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/playlist-items/restore',
      { itemIds: [welcomeRow] },
      'computer',
      order,
    );
    expect(
      await win.evaluate(
        (ids) => (globalThis as PageGlobals).drashti.playlists.restoreItems(ids),
        [welcomeRow],
      ),
    ).toMatchObject({ ok: true });
    await expect(slidesOf(win, WELCOME).first()).toBeVisible();
    await expect.poll(order).toEqual(before);
    expect(await overflowsSideways(p)).toBe(false);
  } finally {
    await phone.close();
  }
  await app.close();
});

test('on a phone, the Picture editor’s look and its save are refused in words, and Save picture… stays a view of the picture; in the window the Picture editor turns, flips and crops it, kept with the picture (Chrome’s engine)', async () => {
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
    const fromPhone = { win, page: p };

    // Save picture… (the owner's Q8: removed with the phone's page, the UI builder's) read the picture at full
    // quality: that stays a view (both modes), the picture the phone draws.
    const viewed = await p.evaluate(async (id) => {
      const token =
        (JSON.parse(localStorage.getItem('drashti.device') ?? '{}') as { token?: string }).token ?? '';
      const r = await fetch(`/api/v1/media/${id}/picture?width=640`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: r.status, type: r.headers.get('content-type') };
    }, show.pictureMediaId);
    expect(viewed.status).toBe(200);
    expect(viewed.type).toMatch(/^image\//u);

    // The Picture editor: the phone's look and its save refused, the look as it was.
    await expectPhoneRefuses(
      fromPhone,
      'GET',
      `/api/v1/media/${show.pictureMediaId}/look`,
      undefined,
      'media',
      look,
    );
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      `/api/v1/media/${show.pictureMediaId}/look`,
      { turn: 90, flipX: true, cropShape: '1:1' },
      'media',
      look,
    );
    // Moved to the window: a quarter turn, flipped across, cropped square; saved, kept with the picture.
    await openLibrary(win);
    await win.getByRole('tab', { name: 'Media' }).click();
    const mediaRow = win.getByTestId('media-row').filter({ hasText: PICTURE });
    await mediaRow.getByTestId('media-picture').click();
    const editor = win.getByTestId('picture-editor');
    await expect(editor).toBeVisible();
    await editor.getByTestId('pe-rotate').click();
    await editor.getByTestId('pe-flip-across').click();
    await editor.getByTestId('pe-crop').click();
    await editor.getByTestId('pe-crop-1:1').click();
    await editor.getByTestId('pe-crop').click();
    // The blurred fill: on for a photo, its switch says so.
    await expect(editor.getByTestId('pe-blurred-fill')).toHaveAttribute('aria-checked', 'true');
    await editor.getByTestId('pe-save').click();
    await expect(editor).toHaveCount(0);
    await expect.poll(look).toMatchObject({ turn: 90, flipX: true, cropShape: '1:1' });
    // Square, out of a picture turned upright (180 × 320): its whole width, part of its height.
    const kept = await look();
    expect(kept?.crop?.w).toBeCloseTo(1, 5);
    expect(kept?.crop?.h).toBeCloseTo(180 / 320, 2);

    // As it was taken: everything put back; the phone's own refused first.
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      `/api/v1/media/${show.pictureMediaId}/look`,
      { reset: true },
      'media',
      look,
    );
    await mediaRow.getByTestId('media-picture').click();
    await editor.getByTestId('pe-reset-all').click();
    await editor.getByTestId('pe-save').click();
    await expect.poll(look).toBeNull();
  } finally {
    await phone.close();
  }
  await app.close();
});
