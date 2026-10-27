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
import { KIRTAN, PLAYLIST, setUpPlaceholderShow, WELCOME } from './placeholder-show';

/*
 * The phone remote runs a sabha, each step seen on a real output: a slide
 * tapped, Next and Back, Clear, black-out, the logo, Put it back, a timer
 * and a message. Next twice quickly goes on, never restarting an item. The
 * remote comes back by itself after the server stops and starts again, and
 * a remote and a stage display left open while Drashti restarts follow its
 * new run (Session 53). Placeholder content; codes and tokens are made at
 * run time.
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

test('the remote’s waits are said as a status, and its empty places say where they are filled (Sessions 31–36)', async () => {
  // A new library as a person's starts (Session 50): without the tests' placeholder presentations either.
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_TEST_SEED_PLACEHOLDERS: '' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  try {
    // The playlists, the library and the messages are held back until each wait has been seen.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked = new Set(['/api/v1/playlists', '/api/v1/presentations', '/api/v1/messages']);
    await p.route(
      (url) => asked.has(url.pathname),
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-playlist').click();
    await expect(p.getByRole('status').filter({ hasText: 'Loading the playlists…' })).toBeVisible();
    await p.getByTestId('remote-tab-library').click();
    await expect(p.getByRole('status').filter({ hasText: 'Loading the library…' })).toBeVisible();
    await p.getByTestId('remote-tab-more').click();
    await expect(p.getByRole('status').filter({ hasText: 'Loading the messages…' })).toBeVisible();
    release();
    // A new library has no messages, no playlists and no presentations: each place says where they are made.
    await expect(
      p.getByText('There are no messages yet: they are made in Drashti on the computer'),
    ).toBeVisible();
    await p.getByTestId('remote-tab-playlist').click();
    await expect(
      p.getByText('There are no playlists yet: they are made in Drashti on the computer, in Pro Mode.'),
    ).toBeVisible();
    await expectNoSeriousA11yIssues(p, 'the remote with no playlists');
    await p.getByTestId('remote-tab-library').click();
    await expect(
      p.getByText(
        'The library is empty: presentations are imported in Drashti on the computer, in Pro Mode.',
      ),
    ).toBeVisible();
  } finally {
    await phone.close();
  }
  await app.close();
});

for (const engine of ['chromium', 'webkit'] as Engine[]) {
  test(`the remote runs a sabha on a real output (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    await win.evaluate((id) => (globalThis as PageGlobals).drashti.props.setLogo(id), show.logoPropId);
    await setUpScreen(win);
    const output = await outputPage(app);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      await expect(p.getByTestId('remote')).toBeVisible();
      // Drashti's icon on every page a phone opens: for the Home Screen (Add to Home Screen) and the tab.
      for (const path of ['/remote', '/stage', '/announce', '/'])
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

      // Next twice quickly with nothing live: the first starts the playlist, the second goes on (never restarts it).
      await p.getByTestId('remote-tab-playlist').click();
      await expect(p.getByTestId('remote-playlist')).toHaveValue(show.playlistId);
      await expect(p.getByTestId('remote-item').filter({ hasText: KIRTAN })).toBeVisible();
      const nextButton = p.getByTestId('remote-next-button');
      await nextButton.click();
      await nextButton.click();
      await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 0 });
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder chorus line');

      // A slide tapped goes up; Next and Back.
      await p.getByTestId('remote-tab-show').click();
      await p.getByTestId('remote-slide').nth(3).click();
      await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 3 });
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder second verse');
      await expect(p.getByTestId('remote-slide').nth(3)).toHaveAttribute('data-live', 'true');
      await nextButton.click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(4);
      await p.getByTestId('remote-back').click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(3);

      // Clear the slide; Clear all, then Put it back.
      const actions = p.getByTestId('remote-actions');
      await actions.getByRole('button', { name: 'Clear slide' }).click();
      await expect(
        output.locator('[data-layer="slide"]', { hasText: 'Placeholder second verse' }),
      ).toHaveCount(0);
      await p.getByTestId('remote-slide').nth(2).click();
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder chorus line');
      await actions.getByRole('button', { name: 'Clear all' }).click();
      await expect.poll(async () => (await snapshot(win)).state.canPutBack).toBe(true);
      await actions.getByRole('button', { name: 'Put it back' }).click();
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder chorus line');

      // Black-out and the logo, on and off, each with its key's name as on the desktop (Session 54, D5).
      // On, each says so in words, as Pro Mode and Simple Mode do (Session 26g), with no aria-pressed.
      await actions.getByRole('button', { name: 'Black-out B', exact: true }).click();
      await expect(output.getByTestId('blackout')).toBeVisible();
      const on = actions.getByRole('button', { name: 'Black-out is on' });
      await expect(on).toBeVisible();
      await expect(on).not.toHaveAttribute('aria-pressed');
      await on.click();
      await expect(output.getByTestId('blackout')).toHaveCount(0);
      await actions.getByRole('button', { name: 'Logo F12', exact: true }).click();
      await expect(output.getByTestId('logo')).toContainText('Placeholder Mandir Logo');
      await expect(actions.getByRole('button', { name: 'Logo is on' })).toBeVisible();
      await actions.getByRole('button', { name: 'Logo is on' }).click();
      await expect(output.getByTestId('logo')).toHaveCount(0);

      // A timer started, paused and reset; a message filled in, shown and taken off.
      await p.getByTestId('remote-tab-more').click();
      const timer = p.getByTestId('remote-timer').first();
      await timer.getByRole('button', { name: 'Start' }).click();
      await expect.poll(async () => (await snapshot(win)).state.timers[0]?.startedAt ?? null).not.toBeNull();
      await timer.getByRole('button', { name: 'Pause' }).click();
      await expect.poll(async () => (await snapshot(win)).state.timers[0]?.startedAt).toBeNull();
      await timer.getByRole('button', { name: 'Reset' }).click();
      await expect.poll(async () => (await snapshot(win)).state.timers[0]?.elapsedMs ?? -1).toBe(0);
      const message = p.getByTestId('remote-message').first();
      await message.getByRole('button', { name: 'Show' }).click();
      await expect(p.getByRole('alert')).toContainText('Fill in {plate} first');
      await message.getByRole('textbox').fill('12');
      await message.getByRole('button', { name: 'Show' }).click();
      await expect(output.locator('[data-layer="messages"]')).toContainText('Car 12 please move');
      await message.getByRole('button', { name: 'Take off' }).click();
      await expect(output.locator('[data-layer="messages"]')).toHaveCount(0);

      // The server stops and starts again: the remote says so, comes back by itself and works.
      await win.evaluate(() => (globalThis as PageGlobals).drashti.network.setOn(false));
      await expect(p.getByTestId('connection')).toHaveAttribute('data-state', 'offline');
      await win.evaluate(() => (globalThis as PageGlobals).drashti.network.setOn(true));
      await expect(p.getByTestId('connection')).toHaveText('Connected', { timeout: 20_000 });
      await p.getByTestId('remote-tab-show').click();
      await nextButton.click();
      await expect.poll(async () => (await where(win)).slideIndex).toBe(3);
      expect(await win.evaluate(() => document.title)).not.toContain(code);
    } finally {
      await phone.close();
    }
    await app.close();
  });
}

test('the remote on a tablet shows the playlist beside the show, and an item tapped shows its slides', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
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
    await t.getByTestId('remote-item').filter({ hasText: WELCOME }).click();
    await expect(t.getByTestId('remote-slides')).toBeVisible();
    await expect(t.getByRole('button', { name: 'Start this item' })).toBeVisible();
    await expect(t.getByTestId('remote-playlist')).toHaveText(new RegExp(PLAYLIST, 'u'));
    await expectNoSeriousA11yIssues(t, 'the remote on a tablet');
  } finally {
    await tablet.close();
  }
  await app.close();
});

test('two remotes pressing Next at once move one slide; a phone’s Next says what it saw, and one without still acts (Sessions 31–36, TST-11)', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const { base, port } = await networkOn(win);
  const goLive = (slideIndex: number) =>
    win.evaluate(
      ({ id, slideIndex }) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId: id,
          slideIndex,
        }),
      { id: show.kirtanId, slideIndex },
    );
  await goLive(1);
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
  expect(await where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 2 });
  // A Next without a revision (Companion, an older phone) acts as ever.
  const plain = await apiCall(port, '/api/v1/trigger/next', { method: 'POST', token: tokens[0], body: {} });
  expect(plain.json).toMatchObject({ ok: true, changed: true });
  expect((await where(win)).slideIndex).toBe(3);

  // A phone's Next button sends the revision it saw.
  const phone = await device('chromium');
  try {
    await pairByQr(phone.page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
    await expect(phone.page.getByTestId('remote-slide').nth(3)).toHaveAttribute('data-live', 'true');
    const { rev: seen, session } = await snapshot(win);
    const sent = phone.page.waitForRequest((r) => r.url().endsWith('/api/v1/trigger/next'));
    await phone.page.getByTestId('remote-next-button').click();
    // With the run of the engine that revision is from (Session 53).
    expect((await sent).postDataJSON()).toEqual({ rev: seen, session });
    await expect.poll(async () => (await where(win)).slideIndex).toBe(4);
  } finally {
    await phone.close();
  }
  await app.close();
});

// Session 53: a run of the engine counts its revisions from 0, and the feed's snapshot did not say its run, so a page
// left open while Drashti restarted (a crash, an update) kept the last run's picture and stage, and its Next, sent
// with the last run's revision, did nothing.
test('a phone’s remote and a tablet’s stage display left open while Drashti restarts follow its new run at once, with no reload: the picture, what is next, Next itself and the stage (Session 53)', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
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
    await expect(p.getByTestId('remote-slide').nth(3)).toHaveAttribute('data-live', 'true');
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
    await expect(p.getByTestId('remote-slide').nth(0)).toHaveAttribute('data-live', 'true');
    // The phone's Next works: on to the first verse, the stage display with it.
    await p.getByTestId('remote-next-button').click();
    await expect.poll(async () => (await where(win2)).slideIndex).toBe(1);
    await expect(t.getByTestId('stage-current')).toContainText('Placeholder first verse');
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
