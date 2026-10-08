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
} from './devices';
import { launchApp, operatorPage, operatorReady, outputPage, type PageGlobals, setUpScreen } from './helpers';
import { KIRTAN, NOTE_ONE, NOTE_TWO, placeholderTalk, setUpPlaceholderShow, TALK } from './placeholder-show';

/*
 * The presenter's remote (Session 18): from a phone or an iPad, the whole
 * library, searched or by name, a presentation opened from it and its
 * slides put up, the screens following; the live slide's notes and the next
 * one's under the live picture; on an iPad held sideways, the live picture,
 * the notes and Next beside the slides. In Simple Mode the remote reads the
 * library and puts slides up as the window may, and no more. The talk is
 * outside the playlist on purpose. Placeholder words; codes and tokens are
 * made at run time and never printed.
 */

const TABLET_SIDEWAYS = 'iPad (gen 7) landscape';

/** Where the show is, as the engine says: the live presentation and slide position. */
async function where(win: Page) {
  const { state } = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
  return { presentationId: state.live.presentationId, slideIndex: state.layers.slide?.slideIndex ?? null };
}

for (const engine of ['chromium', 'webkit'] as Engine[]) {
  test(`a presenter's phone finds a talk in the library, puts its slides up and reads their notes (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpPlaceholderShow(win);
    const talkId = await placeholderTalk(win);
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

      // The whole library, not only the playlist's, by name.
      await p.getByTestId('remote-tab-library').click();
      const library = p.getByTestId('remote-library');
      await expect(library.getByTestId('remote-library-item').filter({ hasText: TALK })).toContainText(
        '3 slides',
      );
      await expect(library.getByTestId('remote-library-item').filter({ hasText: KIRTAN })).toBeVisible();
      await expectNoSeriousA11yIssues(p, `the remote's library on a phone (${engine})`);

      // Searched by words on a slide: found, and opened at that slide (nothing goes up yet).
      await p.getByTestId('remote-library-search').fill('talk point two');
      const hit = library.getByTestId('remote-library-item').filter({ hasText: TALK });
      await expect(hit).toContainText('Placeholder talk point two');
      await expectNoSeriousA11yIssues(p, `the remote's library searched on a phone (${engine})`);
      await hit.click();
      await expect(p.getByTestId('remote-tab-show')).toHaveAttribute('aria-selected', 'true');
      await expect(p.getByTestId('remote-slides-hint')).toBeVisible();
      const found = p.locator('[data-testid="remote-slide"][data-focus="true"]');
      await expect(found).toHaveAttribute('data-position', '1');
      expect((await where(win)).presentationId).not.toBe(talkId);

      // Tapped: the screens follow.
      await found.click();
      await expect.poll(() => where(win)).toEqual({ presentationId: talkId, slideIndex: 1 });
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder talk point two');
      await expect(p.getByTestId('remote-slides-hint')).toHaveCount(0);

      // The live slide's notes, and the next slide's, under the live picture.
      await expect(p.getByTestId('remote-notes-live')).toHaveText(NOTE_TWO);
      await expect(p.getByTestId('remote-notes-next')).toHaveText('Next: no notes');
      await p.getByTestId('remote-back').click();
      await expect.poll(() => where(win)).toEqual({ presentationId: talkId, slideIndex: 0 });
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

      // Another presentation looked at while the talk is up: back to what is on the screens in one tap.
      await p.getByTestId('remote-tab-library').click();
      await p.getByTestId('remote-library-search').fill('');
      await library.getByTestId('remote-library-item').filter({ hasText: KIRTAN }).click();
      await expect(p.getByTestId('remote-show-live')).toBeVisible();
      await p.getByTestId('remote-show-live').click();
      await expect(p.getByTestId('remote-slide').nth(0)).toHaveAttribute('data-live', 'true');
      await expect(p.getByTestId('remote-show-live')).toHaveCount(0);

      // At the smallest phone size too.
      await p.setViewportSize({ width: 375, height: 667 });
      await expect(p.getByTestId('remote-back')).toBeInViewport();
      await expectNoSeriousA11yIssues(p, `the remote at 375 x 667 (${engine})`);

      // The phone only ever gets small previews of media, never a file.
      expect(loads.filter((path) => path.includes('/media/') && !path.endsWith('/preview'))).toEqual([]);
    } finally {
      await phone.close();
    }
    await app.close();
  });
}

test('a presenter’s iPad held sideways: the live picture, the notes and Next beside the slides', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  const talkId = await placeholderTalk(win);
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

    // The talk from the library, a tab away beside the live picture; its first slide put up.
    await t.getByTestId('remote-panel-library').click();
    await t.getByTestId('remote-library-item').filter({ hasText: TALK }).click();
    await expect(t.getByTestId('remote-panel-show')).toHaveAttribute('aria-selected', 'true');
    await t.getByTestId('remote-slide').nth(0).click();
    await expect.poll(() => where(win)).toEqual({ presentationId: talkId, slideIndex: 0 });
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder talk opening');
    await expect(presenter.getByTestId('remote-notes-live')).toHaveText(NOTE_ONE);
    await expect(presenter.getByTestId('remote-notes-next')).toHaveText(`Next: ${NOTE_TWO}`);

    // Side by side, all in view: the live picture left of the slides, Next below both.
    const live = await presenter.getByTestId('remote-live').boundingBox();
    const slides = await t.getByTestId('remote-slides').boundingBox();
    expect(live && slides ? live.x + live.width <= slides.x : false).toBe(true);
    await expect(t.getByTestId('remote-next-button')).toBeInViewport();
    await expect(presenter.getByTestId('remote-notes-live')).toBeInViewport();
    await t.getByTestId('remote-next-button').click();
    await expect.poll(() => where(win)).toEqual({ presentationId: talkId, slideIndex: 1 });
    await expect(presenter.getByTestId('remote-notes-live')).toHaveText(NOTE_TWO);
    await expectNoSeriousA11yIssues(t, 'the remote on an iPad held sideways');
    await t.getByTestId('remote-panel-library').click();
    await expectNoSeriousA11yIssues(t, 'the library on an iPad held sideways');

    // Held upright: the playlist or the library beside the show.
    await t.setViewportSize({ width: 810, height: 1080 });
    await expect(t.getByTestId('remote')).toHaveAttribute('data-layout', 'wide');
    await expect(t.getByTestId('remote-items')).toBeVisible();
    await t.getByTestId('remote-side-library').click();
    await expect(t.getByTestId('remote-library')).toBeVisible();
    await expectNoSeriousA11yIssues(t, 'the library beside the show on an iPad held upright');
  } finally {
    await tablet.close();
  }
  await app.close();
});

test('in Simple Mode a Remote still reads the library and puts a slide up, as the window may, and no more', async () => {
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

  // Reading the library, a page at a time and searched, and a presentation's slides.
  const page = await apiCall(port, '/api/v1/presentations?limit=2', { token });
  expect(page.status).toBe(200);
  expect((page.json['presentations'] as unknown[]).length).toBe(2);
  expect(page.json['total']).toBeGreaterThan(2);
  const found = await apiCall(port, '/api/v1/search?q=talk%20point%20two', { token });
  expect(found.status).toBe(200);
  expect(found.json['hits']).toEqual([
    expect.objectContaining({ presentationId: talkId, match: expect.objectContaining({ kind: 'text' }) }),
  ]);
  expect((await apiCall(port, `/api/v1/presentations/${talkId}`, { token })).status).toBe(200);

  // Putting one of its slides up: running the show, which Simple Mode keeps.
  const up = await apiCall(port, '/api/v1/trigger/slide', {
    method: 'POST',
    token,
    body: { presentationId: talkId, slideIndex: 2 },
  });
  expect(up.status).toBe(200);
  await expect.poll(() => where(win)).toEqual({ presentationId: talkId, slideIndex: 2 });
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder talk closing');

  // Not switching the Look, which Simple Mode refuses in the window too; and the library is read, never changed.
  const looks = await apiCall(port, '/api/v1/looks', { token });
  const lookId = (looks.json['looks'] as { id: string }[])[0]?.id ?? '';
  expect((await apiCall(port, `/api/v1/looks/${lookId}/live`, { method: 'POST', token })).status).toBe(403);
  expect((await apiCall(port, '/api/v1/presentations', { method: 'POST', token })).status).toBe(405);
  expect((await apiCall(port, '/api/v1/search?q=talk', { method: 'POST', token })).status).toBe(405);
  await app.close();
});
