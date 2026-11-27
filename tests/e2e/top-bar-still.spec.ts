import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../src/shared/lower-thirds';
import { networkOn, NETWORK_ENV } from './devices';
import { holdStill, launchApp, operatorPage, operatorReady, type PageGlobals, slidesOf } from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { CI_WINDOW } from './window-size';

/*
 * The top bar (alpha.24, topbar; the a25 list's items 4, 6, 30, 32 and 39). Its LIVE says anything on the audience
 * screens, the stream or the hall's sound, and names it: a lower third (one for the stream alone too), a message, the
 * audio, the audience's timer, as well as a slide, a background or the picture-in-picture box (the owner's delegate's
 * A to item 4). The badge's room holds whether it says LIVE or Off, so nothing in the bar moves as the names come and
 * go, the longest cut short at CI's 1024 × 645. With everything cleared it says Off and "Cleared: …", never "Live:"
 * beside Off (item 32). Turning Help on or off moves none of the bar's buttons: the ? beside Stream, Phones and
 * Announcements keep their room while Help is off (item 6). The Announcements button's colours change at once as one
 * comes to wait, never eased (item 30). Audience and Stage say their names first in their tooltips (item 39).
 * Placeholder content only.
 */

function dispatch(win: Page, command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) {
  return win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

/**
 * Where everything in the top bar is (to a tenth of a pixel): its name, every button, LIVE's badge room and where
 * what is live starts; the words of what is live are left out, as they are what changes.
 */
const barBoxes = (win: Page) =>
  win.evaluate(() => {
    const header = document.querySelector('[data-header]');
    if (!header) return ['no top bar'];
    const at = (r: DOMRect) =>
      `${r.left.toFixed(1)}, ${r.top.toFixed(1)}, ${r.width.toFixed(1)} × ${r.height.toFixed(1)}`;
    const name = (el: Element) =>
      el.getAttribute('data-testid') ??
      el.getAttribute('aria-label') ??
      (el.hasAttribute('data-live-badge-room') ? 'LIVE’s badge room' : el.textContent.trim().slice(0, 30));
    // The ? buttons come and go by design. Compare every persistent control, including LIVE's held room.
    const parts = [
      ...header.querySelectorAll('h1, button:not([data-testid^="what-is-this-"]), [data-live-badge-room]'),
    ].filter((el) => el.getClientRects().length > 0);
    const text = header.querySelector('[data-testid="live-text"]');
    return [
      ...parts.map((el) => `${name(el)}: ${at(el.getBoundingClientRect())}`),
      `what is live starts at ${text ? text.getBoundingClientRect().left.toFixed(1) : 'nowhere'}`,
    ];
  });

/** The top bar's live line: its first badge (LIVE or Off) and its words. */
function topBar(win: Page) {
  const status = win.getByTestId('header-states').getByTestId('live-status');
  return { status, badge: status.locator('[data-badge]').first(), text: status.getByTestId('live-text') };
}

const LONG =
  'Placeholder: the longest message the hall may be shown, about the prasad after arti, the car park, the shoes and the children’s class';

test('anything on the audience screens, the stream or the hall’s sound is LIVE in the top bar and named; Off says Cleared, never Live; the badge’s room holds, so nothing in the bar moves, at 1024 × 645 in Pro and Simple Mode (topbar, items 4 and 32)', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize(CI_WINDOW);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  const timer = await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.timers.create({
      name: 'Placeholder countdown',
      kind: 'countdown',
      durationMs: 60_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!made.ok) throw new Error(made.message);
    return made.id;
  });
  const lowerThird = (where: 'hall' | 'stream' | 'both') =>
    ({
      type: 'showLowerThird',
      lowerThird: {
        id: `placeholder-lt-${where}`,
        lines: ['Placeholder speaker', 'Placeholder role'],
        look: DEFAULT_LOWER_THIRD_LOOK,
        where,
        animation: 'fade-steady',
      },
    }) as const;
  // Each thing up alone: what the line says, then what takes it off.
  const ups = [
    {
      what: 'a lower third',
      up: lowerThird('both'),
      words: 'Live: Lower third · Placeholder speaker',
      off: { type: 'hideLowerThird' },
    },
    {
      what: 'a lower third for the stream alone',
      up: lowerThird('stream'),
      words: 'Live: Lower third · Placeholder speaker',
      off: { type: 'hideLowerThird' },
    },
    {
      what: 'a message',
      up: { type: 'showMessage', message: { id: 'placeholder-m', text: 'Placeholder message' } },
      words: 'Live: Message · Placeholder message',
      off: { type: 'hideMessage', messageId: 'placeholder-m' },
    },
    {
      what: 'the audio',
      up: {
        type: 'playAudio',
        audio: { id: 'placeholder-a', title: 'Placeholder audio', mediaId: null, volume: 1, loop: true },
      },
      words: 'Live: Audio',
      off: { type: 'clearLayer', layer: 'audio' },
    },
    {
      what: 'the audience’s timer',
      up: { type: 'showAudienceTimer', timerId: timer },
      words: 'Live: Timer · Placeholder countdown',
      off: { type: 'hideAudienceTimer' },
    },
    {
      what: 'the longest message',
      up: { type: 'showMessage', message: { id: 'placeholder-long', text: LONG } },
      words: `Live: Message · ${LONG}`,
      off: { type: 'hideMessage', messageId: 'placeholder-long' },
    },
  ] as const;

  const setMode = async (mode: 'pro' | 'simple') => {
    await win.evaluate((m) => (globalThis as PageGlobals).drashti.app.setMode(m), mode);
    await expect(win.getByTestId('simple-mode')).toHaveCount(mode === 'simple' ? 1 : 0);
  };
  for (const mode of ['pro', 'simple'] as const) {
    await setMode(mode);
    const bar = topBar(win);
    await expect(bar.badge, mode).toHaveText('Off');
    await expect(bar.text, mode).toHaveText('Nothing live');
    // Measured once the window has settled after the switch.
    let atRest = await barBoxes(win);
    await holdStill(
      async () => JSON.stringify(await barBoxes(win)) === JSON.stringify(atRest),
      500,
      `${mode}: the top bar settled`,
    );
    atRest = await barBoxes(win);
    expect(atRest.length, `${mode}: what is measured`).toBeGreaterThanOrEqual(mode === 'pro' ? 10 : 3);

    for (const { what, up, words, off } of ups) {
      expect((await dispatch(win, up as never)).ok, `${mode}: ${what} up`).toBe(true);
      await expect(bar.badge, `${mode}: ${what}`).toHaveText('Live');
      await expect(bar.text, `${mode}: ${what}`).toHaveText(words);
      expect(await barBoxes(win), `${mode}: ${what} up, nothing in the top bar moved`).toEqual(atRest);
      if (what === 'the longest message') {
        // Cut short with an ellipsis, inside the states' panel, never over the buttons beside it.
        const cut = await bar.text.evaluate((el) => {
          const states = el.closest('[data-testid="header-states"]')?.getBoundingClientRect();
          return {
            short: el.scrollWidth > el.clientWidth,
            inside: states ? el.getBoundingClientRect().right <= states.right + 0.5 : false,
          };
        });
        expect(cut, `${mode}: the longest name`).toEqual({ short: true, inside: true });
      }
      expect((await dispatch(win, off as never)).ok, `${mode}: ${what} off`).toBe(true);
      await expect(bar.badge, `${mode}: ${what} off`).toHaveText('Off');
      await expect(bar.text, `${mode}: ${what} off`).toHaveText('Nothing live');
      expect(await barBoxes(win), `${mode}: ${what} off, nothing in the top bar moved`).toEqual(atRest);
    }
  }

  // Pro Mode: a slide up, then cleared (F2) with nothing else up: Off, and the cleared place said Cleared (item 32);
  // a message up then: LIVE, the cleared place and the message.
  await setMode('pro');
  const bar = topBar(win);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await slidesOf(win, KIRTAN).nth(1).click();
  await expect(bar.badge).toHaveText('Live');
  await expect(bar.text).toHaveText(`Live: ${KIRTAN} · slide 2 of 5`);
  const withSlide = await barBoxes(win);
  await win.keyboard.press('F2');
  await expect(bar.badge).toHaveText('Off');
  await expect(bar.text).toHaveText(`Cleared: ${KIRTAN} · slide 2 of 5`);
  expect(await barBoxes(win), 'the slide cleared, nothing in the top bar moved').toEqual(withSlide);
  await dispatch(win, { type: 'showMessage', message: { id: 'placeholder-m', text: 'Placeholder message' } });
  await expect(bar.badge).toHaveText('Live');
  await expect(bar.text).toHaveText(
    `Live: ${KIRTAN} · slide 2 of 5 (cleared) · Message · Placeholder message`,
  );
  expect(await barBoxes(win), 'a message up under the cleared slide, nothing moved').toEqual(withSlide);
  await app.close();
});

test('turning Help on or off moves nothing in the top bar: Stream, Phones, Announcements and every other button keep their places, with Phones off and on, at 1024 × 645 and 1410 × 900 (topbar, item 6)', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const header = win.getByTestId('app-header');
  const help = win.getByTestId('help-toggle');
  for (const phones of ['off', 'on'] as const) {
    if (phones === 'on') {
      await networkOn(win);
      await expect(header.getByTestId('open-announcements')).toBeVisible();
    }
    for (const size of [CI_WINDOW, { width: 1410, height: 900 }]) {
      const where = `Phones ${phones}, ${String(size.width)} × ${String(size.height)}`;
      await win.setViewportSize(size);
      await expect(help, where).toHaveAttribute('aria-pressed', 'false');
      await expect(header.getByTestId('what-is-this-stream'), where).toHaveCount(0);
      let atRest = await barBoxes(win);
      await holdStill(
        async () => JSON.stringify(await barBoxes(win)) === JSON.stringify(atRest),
        500,
        `${where}: the top bar settled after the resize`,
      );
      atRest = await barBoxes(win);
      // Help on: the ? come where their room was (below 1280 px with Phones on there are none, as before), and nothing
      // in the bar moves.
      await help.dispatchEvent('click');
      await expect(help, where).toHaveAttribute('aria-pressed', 'true');
      const shown = phones === 'on' && size.width < 1280 ? 0 : 1;
      await expect(header.getByTestId('what-is-this-stream'), where).toHaveCount(1);
      await expect
        .poll(() => header.getByTestId('what-is-this-stream').isVisible(), {
          message: `${where}: Stream's ?`,
        })
        .toBe(shown === 1);
      expect(await barBoxes(win), `${where}: Help on, nothing in the top bar moved`).toEqual(atRest);
      // And off again.
      await help.dispatchEvent('click');
      await expect(help, where).toHaveAttribute('aria-pressed', 'false');
      await expect(header.getByTestId('what-is-this-stream'), where).toHaveCount(0);
      expect(await barBoxes(win), `${where}: Help off again, nothing in the top bar moved`).toEqual(atRest);
    }
  }
  await app.close();
});

test('the Announcements button’s colours change at once, never eased, Calm or Lively; Audience and Stage say their names first in their tooltips (topbar, items 30 and 39)', async () => {
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await networkOn(win);
  const announcements = win.getByTestId('open-announcements');
  await expect(announcements).toBeVisible();
  // What its look eases, as the window draws it, and as Lively draws it on a computer with a graphics chip (CI's
  // Windows draws without one, so the window there never says Lively's rules apply: they are asked for here).
  const eased = () =>
    announcements.evaluate((el) => {
      const root = document.documentElement;
      const motion = root.dataset['interfaceMotion'];
      const chip = root.dataset['chip'];
      const now = getComputedStyle(el).transitionProperty;
      root.dataset['interfaceMotion'] = 'lively';
      root.dataset['chip'] = 'yes';
      const lively = getComputedStyle(el).transitionProperty;
      if (motion === undefined) delete root.dataset['interfaceMotion'];
      else root.dataset['interfaceMotion'] = motion;
      if (chip === undefined) delete root.dataset['chip'];
      else root.dataset['chip'] = chip;
      const colours = (list: string) =>
        list
          .split(',')
          .map((p) => p.trim())
          .filter((p) => /color|shadow|filter|^all$/u.test(p));
      return { now: colours(now), lively: colours(lively) };
    });
  expect(await eased(), 'no colour of the Announcements button eases').toEqual({ now: [], lively: [] });

  // Audience and Stage: their names first, then what pressing does.
  for (const [which, name] of [
    ['audience', 'Audience'],
    ['stage', 'Stage'],
  ] as const) {
    await win.getByTestId(`switch-${which}`).hover();
    const tip = win.getByRole('tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(new RegExp(`^${name}: turn off `, 'u'));
    // Away to the bar's name, which has no tooltip.
    await win.locator('[data-header] h1').hover();
    await expect(tip).toHaveCount(0);
  }
  await app.close();
});
