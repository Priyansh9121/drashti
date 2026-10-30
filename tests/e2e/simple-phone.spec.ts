import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { NEW_LOWER_THIRD } from '../../src/shared/lower-thirds';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { launchApp, operatorPage, operatorReady, outputPage, type PageGlobals, setUpScreen } from './helpers';
import { KIRTAN, PICTURE, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * A paired phone on a computer in Simple Mode (Session 55, the owner's answer of 30 Oct 2026): it does only what Simple
 * Mode's window does, and the main process refuses the rest. A lower third, a message, the stage message and a timer
 * asked for from the phone are refused, the phone saying why in words, and nothing of them reaches the screens; Next,
 * a row of Simple Mode's playlist and its slides, and Clear all work as in the window. Back in Pro Mode the phone shows
 * the lower third again. With Simple access (Part 19) the same, in its own words, whatever mode the window asks for.
 * Placeholder content and Gmails; codes and tokens made at run time.
 */

const SIMPLE_PERSON = 'simple.phone.placeholder@example.com';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** Where the show is: the live presentation and slide position. */
async function where(win: Page) {
  const s = await state(win);
  return { presentationId: s.live.presentationId, slideIndex: s.layers.slide?.slideIndex ?? null };
}

/** A lower third made in Drashti (Pro Mode's Lower Thirds), for the phone to ask for. */
const makeLowerThird = (win: Page) =>
  win.evaluate(
    async (input) => {
      const saved = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, input);
      if (!saved.ok) throw new Error(saved.message);
    },
    {
      ...NEW_LOWER_THIRD,
      lines: ['Placeholder Speaker', 'Placeholder title', ''],
    },
  );

/** The phone's refusal, as it shows it at the top of its page. */
const refusal = (phone: Page) =>
  phone.getByRole('alert').filter({ hasText: 'Simple Mode on Drashti’s computer' });

/** The phone said it, in these words; put away, ready for the next one. */
async function saidOnPhone(phone: Page, ...words: string[]): Promise<string> {
  const said = refusal(phone);
  await expect(said).toBeVisible();
  for (const w of words) await expect(said).toContainText(w);
  const text = await said.innerText();
  await said.getByRole('button', { name: 'Dismiss' }).click();
  await expect(said).toHaveCount(0);
  return text;
}

test('a phone on a computer in Simple Mode does only what Simple Mode’s window does: a lower third, a message, the stage message and a timer refused in words with nothing on the screens; Next, a row of its playlist and Clear all work; Pro Mode again, the lower third shows', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  await makeLowerThird(win);
  await setUpScreen(win);
  const output = await outputPage(app);
  // The network and the phone's pairing are Pro Mode's (Simple Mode changes neither).
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  // The placeholder playlist open as Drashti switches: Simple Mode's one playlist (Part 18).
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist())).toBe(
    show.playlistId,
  );
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');

    // A lower third: refused, said on the phone, none on the screens.
    await p.getByTestId('remote-tab-more').click();
    const third = p.getByTestId('remote-lower-third').filter({ hasText: 'Placeholder Speaker' });
    await expect(third).toContainText('Placeholder title');
    await third.getByRole('button', { name: 'Show' }).click();
    const words = await saidOnPhone(
      p,
      `its playlist “${PLAYLIST}”, Next and Back, Clear all, Black-out and the Wallpaper`,
      'On the Drashti computer, a double-click on Pro Mode leaves it.',
    );
    expect(words).not.toContain('access is Simple Mode only');
    expect((await state(win)).layers.lowerThird).toBeNull();
    await expect(output.getByTestId('lower-third-layer')).toHaveCount(0);

    // A message filled in: refused, none on the screens.
    const message = p.getByTestId('remote-message').first();
    await message.getByRole('textbox').fill('AB 123');
    await message.getByRole('button', { name: 'Show' }).click();
    await saidOnPhone(p);
    expect((await state(win)).layers.messages).toEqual([]);
    await expect(output.locator('[data-layer="messages"]')).toHaveCount(0);

    // The stage message: refused, none on the stage screens.
    await p.getByTestId('remote-stage-text').fill('Placeholder: five minutes');
    await p.getByTestId('remote-stage').getByRole('button', { name: 'Show' }).click();
    await saidOnPhone(p);
    expect((await state(win)).stageMessage).toBeNull();

    // A timer started: refused (Simple Mode has no timers), it does not count.
    await p.getByTestId('remote-timer').first().getByRole('button', { name: 'Start' }).click();
    await saidOnPhone(p);
    expect((await state(win)).timers.every((t) => t.startedAt === null)).toBe(true);

    // Next with nothing up starts Simple Mode's playlist, as its window's Next does; Next goes on into the kirtan.
    await p.getByTestId('remote-tab-playlist').click();
    await expect(p.getByTestId('remote-playlist')).toHaveValue(show.playlistId);
    await expect(p.getByTestId('remote-item').filter({ hasText: KIRTAN })).toBeVisible();
    const next = p.getByTestId('remote-next-button');
    await next.click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.welcomeId, slideIndex: 0 });
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder welcome to the sabha');
    await next.click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 0 });

    // A row of its playlist: the kirtan's slides on the phone, one tapped goes up, and Next goes on from it.
    await p.getByTestId('remote-item').filter({ hasText: KIRTAN }).click();
    await p.getByTestId('remote-slide').nth(3).click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 3 });
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder second verse');
    await next.click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 4 });
    // The picture's row: up as the background, as one click on it in the window puts it up.
    await p.getByTestId('remote-tab-playlist').click();
    await p.getByTestId('remote-item').filter({ hasText: PICTURE }).click();
    await expect
      .poll(async () => {
        const bg = (await state(win)).layers.background;
        return bg?.kind === 'media' ? bg.mediaId : null;
      })
      .toBe(show.pictureMediaId);
    await expect(refusal(p)).toHaveCount(0);

    // Clear all: everything off, as its window's Clear all.
    await p.getByTestId('remote-tab-show').click();
    await p.getByTestId('remote-actions').getByRole('button', { name: 'Clear all' }).click();
    await expect.poll(async () => (await state(win)).layers.background).toBeNull();
    expect((await state(win)).layers.slide).toBeNull();
    await expect(output.locator('[data-layer="slide"]')).toHaveCount(0);

    // Pro Mode again (its double-click): the phone shows the lower third, as before.
    await win.getByTestId('simple-leave').dblclick();
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
    await p.getByTestId('remote-tab-more').click();
    await third.getByRole('button', { name: 'Show' }).click();
    await expect.poll(async () => (await state(win)).layers.lowerThird?.lines[0]).toBe('Placeholder Speaker');
    await expect(output.getByTestId('lower-third-layer')).toBeVisible();
    await expect(refusal(p)).toHaveCount(0);
  } finally {
    await phone.close();
  }
  await app.close();
});

test('with Simple access, a phone is refused the same in words naming no way to Pro Mode, whatever mode the window asks for, and Next still works', async () => {
  test.setTimeout(240_000);
  const { app, access: list } = await launchApp(NETWORK_ENV, undefined, { as: { gmail: SIMPLE_PERSON } });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    await makeLowerThird(win);
    await setUpScreen(win);
    const output = await outputPage(app);
    // Pro access to begin with: the network on and the phone paired; the placeholder playlist open.
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
    await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
    const phone = await device('chromium');
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      // The owner gives this Gmail Simple: at its next check (every 15 s), Simple Mode, with no way to Pro Mode.
      list.setMode(SIMPLE_PERSON, 'simple');
      await expect(win.getByTestId('simple-mode')).toBeVisible({ timeout: 25_000 });
      await expect(win.getByTestId('simple-access')).toContainText('Simple Mode only');

      await p.getByTestId('remote-tab-more').click();
      const third = p.getByTestId('remote-lower-third').filter({ hasText: 'Placeholder Speaker' });
      await third.getByRole('button', { name: 'Show' }).click();
      const words = await saidOnPhone(p, 'whose access is Simple Mode only', `its playlist “${PLAYLIST}”`);
      expect(words).not.toMatch(/double-click|Pro Mode/u);
      expect((await state(win)).layers.lowerThird).toBeNull();
      await expect(output.getByTestId('lower-third-layer')).toHaveCount(0);

      // The window asks for Pro Mode: refused, and the phone is still refused.
      const asked = await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
      expect(asked.ok).toBe(false);
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await p.getByTestId('remote-stage-text').fill('Placeholder: five minutes');
      await p.getByTestId('remote-stage').getByRole('button', { name: 'Show' }).click();
      await saidOnPhone(p, 'whose access is Simple Mode only');
      expect((await state(win)).stageMessage).toBeNull();

      // Next still starts Simple Mode's playlist.
      await p.getByTestId('remote-tab-playlist').click();
      await expect(p.getByTestId('remote-playlist')).toHaveValue(show.playlistId);
      await p.getByTestId('remote-next-button').click();
      await expect.poll(() => where(win)).toEqual({ presentationId: show.welcomeId, slideIndex: 0 });
    } finally {
      await phone.close();
    }
  } finally {
    await app.close();
  }
});
