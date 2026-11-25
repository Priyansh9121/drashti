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
  killApp,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  relaunchApp,
  savedLive,
  setUpScreen,
} from './helpers';
import { PHONE_REFUSAL } from '../../src/shared/phone-rule';
import { addPhoneDeck, DECK } from './phone-deck';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow, WELCOME } from './placeholder-show';

/*
 * The phone remote runs a PDF, each step seen on a real output: a page's row and a page tapped, Next and Back inside
 * it (Next stops at its last page), and Clear slide. Since alpha.23 (QA23-PHONE-1, the owner's "Only PPT and PDF")
 * that is all a phone puts up or changes: the other clears, black-out, the Wallpaper, Put it back, timers and messages
 * are the computer's, and Drashti refuses them from a phone in its words. The remote comes back by itself after the
 * server stops and starts again, and a remote and a stage display left open while Drashti restarts follow its new run
 * (Session 53). Placeholder content and a generated PDF; codes and tokens are made at run time.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/**
 * The icons a page names (Session 19), each fetched and opened as a picture in the phone's own browser:
 * by rel and sizes, its status, type and size in pixels.
 */
function pageIcons(phone: Page, path: string): Promise<Record<string, string>> {
  return phone.evaluate(async (path) => {
    const page = new URL(path, location.href);
    const html = await (await fetch(page)).text();
    const links = new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]');
    const out: Record<string, string> = {};
    for (const link of links) {
      const response = await fetch(new URL(link.getAttribute('href') ?? '', page));
      const picture = await createImageBitmap(await response.blob());
      out[`${link.rel} ${link.getAttribute('sizes') ?? ''}`.trim()] =
        `${String(response.status)} ${response.headers.get('content-type') ?? ''} ${String(picture.width)}x${String(picture.height)}`;
    }
    return out;
  }, path);
}

/** Where the show is, as the engine says: the live presentation and slide position. */
async function where(win: Page) {
  const { state } = await snapshot(win);
  return { presentationId: state.live.presentationId, slideIndex: state.layers.slide?.slideIndex ?? null };
}

test('the remote’s waits are said as a status, and its empty places say where they are filled (Sessions 31–36); it asks for nothing Drashti refuses a phone, in either mode (QA23-PHONE-1)', async () => {
  // A new library as a person's starts (Session 50): without the tests' placeholder presentations either.
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_TEST_SEED_PLACEHOLDERS: '' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  // Every request of the page that Drashti refuses a phone (403): none, in Pro Mode or Simple Mode.
  const refused: string[] = [];
  p.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/') && r.status() === 403) refused.push(path);
  });
  try {
    // The playlists are held back until their wait has been seen.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await p.route(
      (url) => url.pathname === '/api/v1/playlists',
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-playlist').click();
    await expect(p.getByRole('status').filter({ hasText: 'Loading the playlists…' })).toBeVisible();
    // No library and no More on a phone (QA23-PHONE-1).
    await expect(p.getByTestId('remote-tab-library')).toHaveCount(0);
    await expect(p.getByTestId('remote-tab-more')).toHaveCount(0);
    release();
    // A new library has no playlists: the Playlist says where they are made, with nothing to make one here.
    await expect(
      p.getByText('There are no playlists yet: they are made in Drashti on the computer.'),
    ).toBeVisible();
    await expect(p.getByRole('button', { name: 'Manage playlists…' })).toHaveCount(0);
    await expectNoSeriousA11yIssues(p, 'the remote with no playlists');
    // The Show tab: nothing a phone puts up is live, and there is no Sabha flow yet.
    await p.getByTestId('remote-tab-show').click();
    await expect(p.getByTestId('remote-slides-none')).toHaveText(PHONE_REFUSAL.noDeck);
    await expect(p.getByTestId('remote-flow-none')).toBeVisible();
    await expect(p.getByTestId('remote-next-button')).toHaveCount(0);
    // Simple Mode on the computer: Show and Chat, and nothing more is asked for.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(p.getByTestId('remote-simple')).toContainText(PHONE_REFUSAL.simple);
    await expect(p.getByTestId('remote-tab-playlist')).toHaveCount(0);
    await expect(p.getByTestId('remote-flow-none')).toBeVisible();
    await p.getByTestId('remote-tab-chat').click();
    await expect(p.getByTestId('remote-tab-chat')).toHaveAttribute('aria-selected', 'true');
    await expectNoSeriousA11yIssues(p, 'the remote in Simple Mode');
    expect(refused, 'requests Drashti refused this phone').toEqual([]);
  } finally {
    await phone.close();
  }
  await app.close();
});

/** The slide the engine has up, drawn on the output (by its id), or none drawn there. */
async function outputDraws(win: Page, output: Page): Promise<boolean> {
  const id = (await snapshot(win)).state.layers.slide?.slide.id ?? null;
  return id !== null && (await output.locator(`[data-layer="slide"] [data-slide="${id}"]`).count()) > 0;
}

for (const engine of ['chromium', 'webkit'] as Engine[]) {
  test(`the remote runs a PDF on a real output (${engine}): its pages tapped, Next and Back inside it, Clear slide; the rest refused from a phone (QA23-PHONE-1)`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    const deck = await addPhoneDeck(win, show.playlistId);
    await setUpScreen(win);
    const output = await outputPage(app);
    const { base, port } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      await expect(p.getByTestId('remote')).toBeVisible();
      // Drashti's icon on every page a phone opens: for the Home Screen (Add to Home Screen) and the tab.
      for (const path of ['/remote', '/stage', '/announce', '/chat', '/'])
        expect(await pageIcons(p, path), path).toEqual({
          'icon 32x32': '200 image/png 32x32',
          'icon 192x192': '200 image/png 192x192',
          'apple-touch-icon': '200 image/png 180x180',
        });
      await expectNoSeriousA11yIssues(p, `the remote on a phone (${engine})`);
      const size = p.viewportSize();
      await p.setViewportSize({ width: 375, height: 812 });
      await expectNoSeriousA11yIssues(p, `the remote at 375 x 812 (${engine})`);
      if (size) await p.setViewportSize(size);

      // Nothing a phone puts up is live: no Back or Next yet (Next no longer starts the playlist).
      const nextButton = p.getByTestId('remote-next-button');
      const backButton = p.getByTestId('remote-back');
      await expect(nextButton).toHaveCount(0);
      await expect(backButton).toHaveCount(0);

      // The playlist's PDF alone: its first page's row, tapped, goes up.
      await p.getByTestId('remote-tab-playlist').click();
      await expect(p.getByTestId('remote-playlist')).toHaveValue(show.playlistId);
      const rows = p.getByTestId('remote-items');
      await expect(rows.getByTestId('remote-row').filter({ hasText: `${DECK}_1` })).toBeVisible();
      await expect(rows).not.toContainText(KIRTAN);
      await expect(rows).not.toContainText(WELCOME);
      await rows
        .getByTestId('remote-row')
        .filter({ hasText: `${DECK}_1` })
        .click();
      await expect.poll(() => where(win)).toEqual({ presentationId: deck.deckId, slideIndex: 0 });
      await expect.poll(() => outputDraws(win, output)).toBe(true);

      // A page tapped goes up; Back and Next, inside the PDF: Next stops at its last page (the owner's Q6).
      await p.getByTestId('remote-tab-show').click();
      await p.getByTestId('remote-slide').nth(2).click();
      await expect.poll(() => where(win)).toEqual({ presentationId: deck.deckId, slideIndex: 2 });
      await expect(p.getByTestId('remote-slide').nth(2)).toHaveAttribute('data-live', 'true');
      await expect.poll(() => outputDraws(win, output)).toBe(true);
      await backButton.click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(1);
      await nextButton.click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(2);
      await nextButton.click();
      await holdStill(
        async () => {
          const at = await where(win);
          return at.presentationId === deck.deckId && at.slideIndex === 2;
        },
        700,
        'Next stops at the PDF’s last page, never the next item',
      );

      // Clear slide, the one clear a phone has (the owner's Q7); a page tapped puts it back up.
      const actions = p.getByTestId('remote-actions');
      await expect(actions.getByRole('button')).toHaveCount(1);
      await actions.getByRole('button', { name: /^Clear slide/u }).click();
      await expect.poll(async () => (await snapshot(win)).state.layers.slide).toBeNull();
      await expect(output.locator('[data-layer="slide"] [data-slide]')).toHaveCount(0);
      await p.getByTestId('remote-slide').nth(0).click();
      await expect.poll(() => where(win)).toEqual({ presentationId: deck.deckId, slideIndex: 0 });
      await expect.poll(() => outputDraws(win, output)).toBe(true);

      // What the phone did before alpha.23, now the computer's: refused from a Remote in Drashti's words, nothing on
      // the screens changing (Clear all, Put it back, black-out, the Wallpaper, a timer, a message).
      const remote = await pairToken(win, port, 'remote', 'Placeholder script remote');
      const timerId = (await snapshot(win)).state.timers[0]?.id ?? 'placeholder';
      const before = await where(win);
      for (const [path, body, words] of [
        ['/api/v1/clear/all', {}, PHONE_REFUSAL.computer],
        ['/api/v1/put-back', {}, PHONE_REFUSAL.computer],
        ['/api/v1/blackout', { on: true }, PHONE_REFUSAL.computer],
        ['/api/v1/wallpaper', { on: true }, PHONE_REFUSAL.media],
        [`/api/v1/timers/${encodeURIComponent(timerId)}/start`, {}, PHONE_REFUSAL.computer],
        ['/api/v1/messages/placeholder/show', { values: { plate: '12' } }, PHONE_REFUSAL.computer],
      ] as const) {
        const answer = await apiCall(port, path, { method: 'POST', token: remote, body });
        expect({ path, status: answer.status, json: answer.json }).toEqual({
          path,
          status: 403,
          json: { ok: false, message: words },
        });
      }
      expect(await where(win)).toEqual(before);
      await expect(output.getByTestId('blackout')).toHaveCount(0);
      await expect(output.getByTestId('wallpaper')).toHaveCount(0);

      // The server stops and starts again: the remote says so, comes back by itself and works.
      await win.evaluate(() => (globalThis as PageGlobals).drashti.network.setOn(false));
      await expect(p.getByTestId('connection')).toHaveAttribute('data-state', 'offline');
      await win.evaluate(() => (globalThis as PageGlobals).drashti.network.setOn(true));
      await expect(p.getByTestId('connection')).toHaveText('Connected', { timeout: 20_000 });
      await p.getByTestId('remote-tab-show').click();
      await nextButton.click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(1);
      expect(await win.evaluate(() => document.title)).not.toContain(code);
    } finally {
      await phone.close();
    }
    await app.close();
  });
}

test('the remote on a tablet shows the playlist’s PDF beside the show, and its page tapped goes up with its slides shown', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const deck = await addPhoneDeck(win, show.playlistId);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder tablet');
  const tablet = await device('webkit', TABLET);
  try {
    await pairByQr(tablet.page, base, code, '/remote');
    const t = tablet.page;
    await expect(t.getByTestId('connection')).toHaveText('Connected');
    // Wide: no tabs; the playlist and the show side by side.
    await expect(t.getByTestId('remote-tab-show')).toHaveCount(0);
    await expect(t.getByTestId('remote-items')).toBeVisible();
    await expect(t.getByTestId('remote-playlist')).toHaveText(new RegExp(PLAYLIST, 'u'));
    // Its PDF's rows only (QA23-PHONE-1, the owner's "Only PPT and PDF"): never the welcome's or the kirtan's.
    await expect(t.getByTestId('remote-row').filter({ hasText: `${DECK}_1` })).toBeVisible();
    await expect(t.getByTestId('remote-items')).not.toContainText(WELCOME);
    await expect(t.getByTestId('remote-items')).not.toContainText(KIRTAN);
    // Its first page's row, tapped, goes up, and its pages show beside.
    await t
      .getByTestId('remote-row')
      .filter({ hasText: `${DECK}_1` })
      .click();
    await expect.poll(async () => (await where(win)).presentationId).toBe(deck.deckId);
    await expect(t.getByTestId('remote-slides')).toBeVisible();
    await expect(t.getByTestId('remote-slide')).toHaveCount(deck.pages);
    await expect(t.getByTestId('remote-slide').nth(0)).toHaveAttribute('data-live', 'true');
    // Back and Next while it is up.
    await expect(t.getByTestId('remote-next-button')).toBeVisible();
    await expectNoSeriousA11yIssues(t, 'the remote on a tablet');
  } finally {
    await tablet.close();
  }
  await app.close();
});

test('two remotes pressing Next at once move one slide; a phone’s Next says what it saw, and one without still acts (Sessions 31–36, TST-11), a PDF up', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  // A PDF: what a phone's Next turns since alpha.23 (QA23-PHONE-1).
  const deck = await addPhoneDeck(win, show.playlistId);
  const { base, port } = await networkOn(win);
  const goLive = (slideIndex: number) =>
    win.evaluate(
      ({ id, slideIndex, playlist }) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId: id,
          slideIndex,
          playlist,
        }),
      { id: deck.deckId, slideIndex, playlist: { playlistId: show.playlistId, itemId: deck.itemId } },
    );
  await goLive(0);
  // Two remotes, each having seen the show as it is now, press Next in the same moment: one slide on.
  const tokens = [
    await pairToken(win, port, 'remote', 'Placeholder remote one'),
    await pairToken(win, port, 'remote', 'Placeholder remote two'),
  ];
  const rev = (await snapshot(win)).rev;
  const answers = await Promise.all(
    tokens.map((token) => apiCall(port, '/api/v1/trigger/next', { method: 'POST', token, body: { rev } })),
  );
  expect(answers.map((a) => a.json['changed']).sort()).toEqual([false, true]);
  expect(await where(win)).toEqual({ presentationId: deck.deckId, slideIndex: 1 });
  // A Next without a revision (a script, an older phone) acts as ever.
  const plain = await apiCall(port, '/api/v1/trigger/next', { method: 'POST', token: tokens[0], body: {} });
  expect(plain.json).toMatchObject({ ok: true, changed: true });
  expect((await where(win)).slideIndex).toBe(2);
  // Back to its first page from the computer, for the phone's own Next.
  await goLive(0);

  // A phone's Next button sends the revision it saw.
  const phone = await device('chromium');
  try {
    await pairByQr(phone.page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
    await expect(phone.page.getByTestId('remote-slide').nth(0)).toHaveAttribute('data-live', 'true');
    const { rev: seen, session } = await snapshot(win);
    const sent = phone.page.waitForRequest((r) => r.url().endsWith('/api/v1/trigger/next'));
    await phone.page.getByTestId('remote-next-button').click();
    // With the run of the engine that revision is from (Session 53).
    expect((await sent).postDataJSON()).toEqual({ rev: seen, session });
    await expect.poll(async () => (await where(win)).slideIndex).toBe(1);
  } finally {
    await phone.close();
  }
  await app.close();
});

// Session 53: a run of the engine counts its revisions from 0, and the feed's snapshot did not say its run, so a page
// left open while Drashti restarted (a crash, an update) kept the last run's picture and stage, and its Next, sent
// with the last run's revision, did nothing.
test('a phone’s remote and a tablet’s stage display left open while Drashti restarts follow its new run at once, with no reload: the picture, what is next, Next itself (a PDF’s) and the stage (Session 53)', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  // A PDF, for the phone's Next after the restart (a phone turns a PowerPoint or a PDF alone: QA23-PHONE-1).
  const deck = await addPhoneDeck(win, show.playlistId);
  const { base, port } = await networkOn(win);
  const phone = await device('chromium');
  const tablet = await device('webkit', TABLET);
  const p = phone.page;
  const t = tablet.page;
  const mark = 'opened before the restart';
  const marked = (page: Page) => page.evaluate(() => (globalThis as { e2eMark?: string }).e2eMark ?? null);
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await pairByQr(t, base, await pairingCode(win, 'stage', 'Placeholder stage tablet'), '/stage');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await expect(t.getByTestId('stage-view')).toBeVisible();
    // The kirtan's second verse up, this run well on (black-out on and off): far past where the next run, counting
    // from 0 again, is while the pages are looked at.
    await dispatch(win, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 3 });
    for (let i = 0; i < 30; i++) {
      await dispatch(win, { type: 'setBlackout', on: true });
      await dispatch(win, { type: 'setBlackout', on: false });
    }
    const before = await snapshot(win);
    await expect(t.getByTestId('stage-current')).toContainText('Placeholder second verse');
    await expect(p.getByTestId('remote-live').locator('[data-layer="slide"]')).toContainText(
      'Placeholder second verse',
    );
    // A mark on each page, which loading it again would take away.
    for (const page of [p, t])
      await page.evaluate((m) => {
        (globalThis as { e2eMark?: string }).e2eMark = m;
      }, mark);
    await savedLive(userData, (saved) => saved.slide?.slideIndex === 3 && saved.blackout === false);

    // Drashti stops dead (a crash) and starts again on its data folder: the phone server on the same port, both
    // devices still paired, recovery putting the second verse back. Both pages connect again by themselves.
    await killApp(app);
    await expect(p.getByTestId('connection')).toHaveAttribute('data-state', 'offline', { timeout: 20_000 });
    await expect(t.getByTestId('stage-offline')).toBeVisible({ timeout: 20_000 });
    const again = await relaunchApp(userData, NETWORK_ENV);
    const win2 = await operatorPage(again.app);
    await operatorReady(win2);
    const status = () => win2.evaluate(() => (globalThis as PageGlobals).drashti.network.status());
    await expect.poll(async () => (await status()).state).toBe('listening');
    expect((await status()).port).toBe(port);
    await expect(p.getByTestId('connection')).toHaveText('Connected', { timeout: 30_000 });
    await expect(t.getByTestId('stage-offline')).toHaveCount(0, { timeout: 30_000 });
    // A new run, its revisions from 0 again: below the pages' copies of the last one.
    const after = await snapshot(win2);
    expect(after.session).not.toBe(before.session);
    expect(after.rev).toBeLessThan(before.rev);

    // The new run's own slide, the chorus: on both pages at once, and what comes next with it.
    await dispatch(win2, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 0 });
    await expect(t.getByTestId('stage-current')).toContainText('Placeholder chorus line');
    await expect(t.getByTestId('stage-next')).toContainText('Placeholder first verse');
    await expect(p.getByTestId('remote-live').locator('[data-layer="slide"]')).toContainText(
      'Placeholder chorus line',
    );
    await expect(p.getByTestId('remote-next')).toContainText('Placeholder first verse');
    // The phone's Next works, the new run's: the PDF up from its row, then on to its second page.
    await dispatch(win2, {
      type: 'goLive',
      presentationId: deck.deckId,
      slideIndex: 0,
      playlist: { playlistId: show.playlistId, itemId: deck.itemId },
    });
    await expect(p.getByTestId('remote-slide').nth(0)).toHaveAttribute('data-live', 'true');
    await p.getByTestId('remote-next-button').click();
    await expect.poll(async () => await where(win2)).toEqual({ presentationId: deck.deckId, slideIndex: 1 });
    await expect(p.getByTestId('remote-slide').nth(1)).toHaveAttribute('data-live', 'true');
    // Neither page was loaded again.
    expect(await marked(p)).toBe(mark);
    expect(await marked(t)).toBe(mark);
    await again.app.close();
  } finally {
    await phone.close();
    await tablet.close();
  }
});
