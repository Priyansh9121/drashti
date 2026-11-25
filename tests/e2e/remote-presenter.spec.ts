import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  apiCall,
  device,
  type Engine,
  networkOn,
  NETWORK_ENV,
  pairByQr,
  pairingCode,
  pairToken,
  TABLET,
} from './devices';
import {
  holdStill,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { expectPhoneRefuses } from './phone-refuses';
import { KIRTAN, NOTE_ONE, NOTE_TWO, placeholderTalk, setUpPlaceholderShow } from './placeholder-show';
import { PDF_ENV, phoneAsks, phoneShowsLive, placeholderPdf, playlistOf } from './pro-phone';

/*
 * The presenter's remote (Session 18), as a Pro Mode phone has it since alpha.23 (QA23-PHONE-1, the owner's "Only PPT
 * and PDF"): from a phone or an iPad, a PDF put up from the playlist it opens, stepped inside with Next and Back (Next
 * stopping at its last page, never the playlist's next row), the screens following; the live slide's notes and the
 * next one's under the live picture; on an iPad held sideways, the live picture, the notes and Next beside the slides.
 * The library, a talk of words, a kirtan and a passage are refused, in words. In Simple Mode a Remote only reads what
 * is live: the library, a presentation's slides and putting one up are refused, even of Simple Mode's playlist, and
 * the window runs the show. The talk is outside the playlist on purpose. Placeholder words and generated pages;
 * codes and tokens are made at run time and never printed.
 */

const TABLET_SIDEWAYS = 'iPad (gen 7) landscape';

/** Where the show is, as the engine says: the live presentation and slide position. */
async function where(win: Page) {
  const { state } = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
  return { presentationId: state.live.presentationId, slideIndex: state.layers.slide?.slideIndex ?? null };
}

/** The hall's screen draws the slide live now: by its id (a PDF's page is a picture, with no words to read). */
async function hallDrawsLive(win: Page, output: Page): Promise<void> {
  const id = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.slide.id ?? '',
  );
  expect(id, 'a slide is live').not.toBe('');
  await expect(output.locator(`[data-layer="slide"] [data-slide="${id}"]`).first()).toBeVisible();
}

/** The presenter's PDF: three placeholder pages, the first two with notes (their comments). */
const presenterPdf = (win: Page) =>
  placeholderPdf(win, 'Placeholder presenter PDF', [
    { width: 960, height: 540, color: [30, 58, 138], text: 'Placeholder PDF opening', note: NOTE_ONE },
    { width: 960, height: 540, color: [127, 29, 29], text: 'Placeholder PDF point two', note: NOTE_TWO },
    { width: 960, height: 540, color: [20, 83, 45], text: 'Placeholder PDF closing' },
  ]);

for (const engine of ['chromium', 'webkit'] as Engine[]) {
  test(`a presenter's phone puts a PDF up from its playlist, steps inside it and reads its notes; the library, a talk of words, a kirtan and a passage are refused (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp({ ...NETWORK_ENV, ...PDF_ENV });
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    const talkId = await placeholderTalk(win);
    const pdfId = await presenterPdf(win);
    // The presenter's playlist: the PDF, then the kirtan.
    const list = await playlistOf(win, 'Placeholder presenter list', [
      { kind: 'presentation', presentationId: pdfId },
      { kind: 'presentation', presentationId: show.kirtanId },
    ]);
    const [pdfRow = '', kirtanRow = ''] = list.rows;
    await setUpScreen(win);
    const output = await outputPage(app);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder presenter phone');
    const phone = await device(engine);
    const p = phone.page;
    // Every address the phone loads, to see it never fetches a whole picture or video.
    const loads: string[] = [];
    p.on('request', (r) => loads.push(new URL(r.url()).pathname));
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      await expect(p.getByTestId('remote')).toHaveAttribute('data-layout', 'phone');

      // The whole library, searched or a page of it, the talk (words, outside the playlist), the kirtan's row and a
      // passage: refused in words, nothing up (before alpha.23 the phone found the talk in the library and put it up).
      const asks = { win, page: p };
      await expectPhoneRefuses(asks, 'GET', '/api/v1/presentations', undefined, 'library');
      await expectPhoneRefuses(asks, 'GET', '/api/v1/search?q=talk%20point%20two', undefined, 'library');
      await expectPhoneRefuses(
        asks,
        'POST',
        '/api/v1/trigger/slide',
        { presentationId: talkId, slideIndex: 1 },
        'notDeck',
      );
      await expectPhoneRefuses(
        asks,
        'POST',
        '/api/v1/trigger/item',
        { playlistId: list.playlistId, itemId: kirtanRow },
        'notDeck',
      );
      await expectPhoneRefuses(asks, 'POST', '/api/v1/shastra', { reference: 'Placeholder 1:1' }, 'notDeck');
      expect((await where(win)).presentationId).toBeNull();

      // Its playlist read: the PDF's row is the one it may put up.
      const items = await phoneAsks(p, 'GET', `/api/v1/playlists/${list.playlistId}/items`);
      expect(items.status).toBe(200);
      expect(items.json['items']).toMatchObject([
        { id: pdfRow, kind: 'presentation', presentationId: pdfId, phonePlays: true },
        { id: kirtanRow, kind: 'presentation', presentationId: show.kirtanId, phonePlays: false },
      ]);

      // The PDF's row, tapped: the screens follow.
      expect(
        (await phoneAsks(p, 'POST', '/api/v1/trigger/item', { playlistId: list.playlistId, itemId: pdfRow }))
          .status,
      ).toBe(200);
      await expect.poll(() => where(win)).toEqual({ presentationId: pdfId, slideIndex: 0 });
      await hallDrawsLive(win, output);
      await phoneShowsLive(p, win);

      // The live slide's notes, and the next slide's, under the live picture.
      await expect(p.getByTestId('remote-notes-live')).toHaveText(NOTE_ONE);
      await expect(p.getByTestId('remote-notes-next')).toHaveText(`Next: ${NOTE_TWO}`);
      await p.getByTestId('remote-next-button').click();
      await expect.poll(() => where(win)).toEqual({ presentationId: pdfId, slideIndex: 1 });
      await hallDrawsLive(win, output);
      await expect(p.getByTestId('remote-notes-live')).toHaveText(NOTE_TWO);
      await expect(p.getByTestId('remote-notes-next')).toHaveText('Next: no notes');
      await p.getByTestId('remote-back').click();
      await expect.poll(() => where(win)).toEqual({ presentationId: pdfId, slideIndex: 0 });
      await expect(p.getByTestId('remote-notes-live')).toHaveText(NOTE_ONE);
      await expect(p.getByTestId('remote-notes-next')).toHaveText(`Next: ${NOTE_TWO}`);
      await expectNoSeriousA11yIssues(p, `the remote's notes on a phone (${engine})`);

      // One tap hides them; this phone remembers, and one tap shows them again.
      await p.getByTestId('remote-notes-toggle').click();
      await expect(p.getByTestId('remote-notes')).toHaveCount(0);
      await expect(p.getByTestId('remote-notes-toggle')).toHaveAttribute('aria-expanded', 'false');
      await p.reload();
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      await expect(p.getByTestId('remote-notes-toggle')).toHaveAttribute('aria-expanded', 'false');
      await expect(p.getByTestId('remote-notes')).toHaveCount(0);
      await p.getByTestId('remote-notes-toggle').click();
      await expect(p.getByTestId('remote-notes-live')).toHaveText(NOTE_ONE);

      // To its last page, and Next again: it stops there, never the kirtan after it in the playlist.
      await phoneShowsLive(p, win);
      for (const slideIndex of [1, 2]) {
        await p.getByTestId('remote-next-button').click();
        await expect.poll(() => where(win)).toEqual({ presentationId: pdfId, slideIndex });
      }
      await p.getByTestId('remote-next-button').click();
      // A Next with no revision of its own (the review's MUST-2): a tap's carries the revision its page saw, and the
      // engine lets an older one do nothing (TST-11), so only Next's `within` (the main process's) keeps the deck still.
      expect(await phoneAsks(p, 'POST', '/api/v1/trigger/next', {})).toMatchObject({
        status: 200,
        json: { ok: true, changed: false },
      });
      await holdStill(
        async () => {
          const now = await where(win);
          return now.presentationId === pdfId && now.slideIndex === 2;
        },
        1500,
        'Next on the phone at the PDF’s last page changes nothing',
      );
      await expect(output.locator('[data-layer="slide"]')).not.toContainText('Placeholder chorus line');

      // At the smallest phone size too.
      await p.setViewportSize({ width: 375, height: 667 });
      await expect(p.getByTestId('remote-back')).toBeInViewport();
      await expectNoSeriousA11yIssues(p, `the remote at 375 x 667 (${engine})`);

      // The phone only ever gets pictures of media, at the width it draws them (Session 54, D1; small previews
      // before), never a file in pieces: nothing here plays a video on the phone.
      expect(loads.filter((path) => path.includes('/media/') && !path.endsWith('/picture'))).toEqual([]);
    } finally {
      await phone.close();
    }
    await app.close();
  });
}

for (const [engine, name] of [
  ['chromium', undefined],
  ['webkit', TABLET],
] as const) {
  test(`a remote shows the slide in the hall’s languages, Drashti’s time, a running timer and its notes’ language (${engine}${name ? ', a tablet' : ''}; Sessions 31–36, SLD-6)`, async () => {
    test.setTimeout(120_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpPlaceholderShow(win, { video: false });
    const talkId = await placeholderTalk(win);
    await setUpScreen(win);
    // The hall shows a kirtan's Gujarati only; its first slide is up.
    await win.evaluate(async (kirtan) => {
      const d = (globalThis as PageGlobals).drashti;
      const hall = (await d.screens.get()).groups.find((g) => g.role === 'audience');
      const set = await d.screens.setGroupLanguages(hall?.id ?? '', ['gu']);
      if (!set.ok) throw new Error(set.message);
      const id = (await d.library.listPresentations()).find((p) => p.name === kirtan)?.id ?? '';
      await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
    }, KIRTAN);
    const langs = (page: Page, scope: string) =>
      page
        .locator(`${scope} [data-lang]`)
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-lang') ?? '').sort());
    // LIVE shows the hall's Gujarati only.
    await expect
      .poll(async () => {
        const shown = await langs(win, '[data-testid="live-preview"]');
        return shown.length > 0 && shown.every((l) => l === 'gu');
      })
      .toBe(true);
    const onLive = await langs(win, '[data-testid="live-preview"]');
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder presenter');
    const phone = await device(engine, name);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      // The same languages as LIVE, and Next in them too.
      await expect.poll(() => langs(p, '[data-testid="remote-live"]')).toEqual(onLive);
      expect((await langs(p, '[data-testid="remote-next"]')).every((l) => l === 'gu')).toBe(true);
      // Drashti's time, in figures that do not jump.
      const style = await app.evaluate(({ app }) => ({
        locale: app.getLocale(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }));
      const clock = p.getByTestId('remote-clock');
      const times = [0, 60_000].map((later) =>
        new Date(Date.now() + later).toLocaleTimeString(style.locale, {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: style.timeZone,
        }),
      );
      expect(times).toContain(await clock.textContent());
      expect(await clock.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
      // A running timer beside it.
      await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        const made = await d.timers.create({
          name: 'Placeholder countdown',
          kind: 'countdown',
          durationMs: 300_000,
          targetTime: null,
          allowsOverrun: false,
        });
        if (!made.ok) throw new Error(made.message);
        await d.engine.dispatch({ type: 'startTimer', timerId: made.id });
      });
      await expect(p.getByTestId('remote-running-timer')).toContainText(/Placeholder countdown 4:\d\d/u);
      // The notes: in their own language, never machine-translated.
      await win.evaluate(
        (id) =>
          (globalThis as PageGlobals).drashti.engine.dispatch({
            type: 'goLive',
            presentationId: id,
            slideIndex: 0,
          }),
        talkId,
      );
      await expect(p.getByTestId('remote-notes-live')).toHaveText(NOTE_ONE);
      await expect(p.getByTestId('remote-notes-live')).toHaveAttribute('lang', 'en');
      await expect(p.getByTestId('remote-notes')).toHaveAttribute('translate', 'no');
      await expectNoSeriousA11yIssues(p, `the remote's clock and notes (${engine})`);
    } finally {
      await phone.close();
    }
    await app.close();
  });
}

test('a presenter’s iPad held sideways: the live picture, the notes and Next beside the slides', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...NETWORK_ENV, ...PDF_ENV });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  const pdfId = await presenterPdf(win);
  const list = await playlistOf(win, 'Placeholder presenter list', [
    { kind: 'presentation', presentationId: pdfId },
  ]);
  await setUpScreen(win);
  const output = await outputPage(app);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder presenter iPad');
  const tablet = await device('webkit', TABLET_SIDEWAYS);
  const t = tablet.page;
  try {
    await pairByQr(t, base, code, '/remote');
    await expect(t.getByTestId('connection')).toHaveText('Connected');
    await expect(t.getByTestId('remote')).toHaveAttribute('data-layout', 'landscape');
    const presenter = t.getByTestId('remote-presenter');
    await expect(presenter.getByTestId('remote-live')).toBeVisible();
    await expect(presenter.getByTestId('remote-notes-section')).toBeVisible();
    await expect(presenter.getByTestId('remote-next')).toBeVisible();

    // The PDF from its playlist row, put up from the iPad (before alpha.23, a talk from the library a tab away).
    expect(
      (
        await phoneAsks(t, 'POST', '/api/v1/trigger/item', {
          playlistId: list.playlistId,
          itemId: list.rows[0] ?? '',
        })
      ).status,
    ).toBe(200);
    await expect.poll(() => where(win)).toEqual({ presentationId: pdfId, slideIndex: 0 });
    await hallDrawsLive(win, output);
    await expect(presenter.getByTestId('remote-notes-live')).toHaveText(NOTE_ONE);
    await expect(presenter.getByTestId('remote-notes-next')).toHaveText(`Next: ${NOTE_TWO}`);
    await phoneShowsLive(t, win);

    // Side by side, all in view: the live picture left of the slides, Next below both.
    await expect(t.getByTestId('remote-slides')).toBeVisible();
    const live = await presenter.getByTestId('remote-live').boundingBox();
    const slides = await t.getByTestId('remote-slides').boundingBox();
    expect(live && slides ? live.x + live.width <= slides.x : false).toBe(true);
    await expect(t.getByTestId('remote-next-button')).toBeInViewport();
    await expect(presenter.getByTestId('remote-notes-live')).toBeInViewport();
    await t.getByTestId('remote-next-button').click();
    await expect.poll(() => where(win)).toEqual({ presentationId: pdfId, slideIndex: 1 });
    await expect(presenter.getByTestId('remote-notes-live')).toHaveText(NOTE_TWO);
    await expectNoSeriousA11yIssues(t, 'the remote on an iPad held sideways');
    // The library beside it: refused (before alpha.23 a tab away).
    await expectPhoneRefuses({ win, page: t }, 'GET', '/api/v1/presentations', undefined, 'library');

    // Held upright: the playlist beside the show. The iPad opened the first playlist when it connected (nothing was
    // live then) and keeps its own choice (the owner's Q10: the playlist the phone opens), so the presenter opens the
    // talk's list: its PDF's row (QA23-PHONE-1: a playlist's PowerPoints and PDFs only).
    await t.setViewportSize({ width: 810, height: 1080 });
    await expect(t.getByTestId('remote')).toHaveAttribute('data-layout', 'wide');
    await t.getByTestId('remote-playlist').selectOption(list.playlistId);
    await expect(t.getByTestId('remote-items')).toBeVisible();
    await expect(t.getByTestId('remote-items').getByTestId('remote-item')).toHaveCount(1);
    await expectNoSeriousA11yIssues(t, 'the playlist beside the show on an iPad held upright');
  } finally {
    await tablet.close();
  }
  await app.close();
});

test('in Simple Mode a Remote reads only what is live: the library, a presentation’s slides and putting one up refused in words, even of Simple Mode’s playlist; the window puts it up', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  const talkId = await placeholderTalk(win);
  await setUpScreen(win);
  const output = await outputPage(app);
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder presenter script');
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const asks = { win, port, token };

  // The library, a page at a time and searched: refused (alpha.23, QA23-PHONE-1: the library is never a phone's);
  // a presentation's slides: Pro Mode's, refused in Simple Mode's words.
  await expectPhoneRefuses(asks, 'GET', '/api/v1/presentations?limit=2', undefined, 'library');
  await expectPhoneRefuses(asks, 'GET', '/api/v1/search?q=talk%20point%20two', undefined, 'library');
  await expectPhoneRefuses(asks, 'GET', `/api/v1/presentations/${talkId}`, undefined, 'simple');

  // Putting one of its slides up: refused in Simple Mode's words, nothing up; and still refused once the talk is in
  // Simple Mode's playlist (brought in as its window does): a Simple Mode phone shows the Sabha flow, what is on the
  // screens and the chat (the owner, alpha.23).
  const slide = { presentationId: talkId, slideIndex: 2 };
  await expectPhoneRefuses(asks, 'POST', '/api/v1/trigger/slide', slide, 'simple');
  expect((await where(win)).presentationId).toBeNull();
  await expect(output.locator('[data-layer="slide"]')).toHaveCount(0);
  await win.evaluate(async (presentationId) => {
    const d = (globalThis as PageGlobals).drashti;
    const one = await d.app.simplePlaylist();
    if (one === null) throw new Error('Simple Mode has no playlist');
    const added = await d.playlists.addItems(one, null, [{ kind: 'presentation', presentationId }]);
    if (!added.ok) throw new Error(added.message);
  }, talkId);
  await expectPhoneRefuses(asks, 'POST', '/api/v1/trigger/slide', slide, 'simple');
  // The window puts it up (moved from the phone): Simple Mode runs the show on the computer.
  const up = await win.evaluate(
    (s) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', ...s }),
    slide,
  );
  expect(up.ok).toBe(true);
  await expect.poll(() => where(win)).toEqual({ presentationId: talkId, slideIndex: 2 });
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder talk closing');
  // What is live, it still reads.
  for (const path of ['/api/v1/state', '/api/v1/hall', '/api/v1/status'])
    expect((await apiCall(port, path, { token })).status, path).toBe(200);

  // The library is read by no phone, and never changed (switching a Look, refused here before Session 55, went with
  // Looks).
  expect((await apiCall(port, '/api/v1/presentations', { method: 'POST', token })).status).toBe(405);
  expect((await apiCall(port, '/api/v1/search?q=talk', { method: 'POST', token })).status).toBe(405);
  await app.close();
});
