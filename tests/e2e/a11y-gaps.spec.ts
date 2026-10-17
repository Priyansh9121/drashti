import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, networkOn, NETWORK_ENV } from './devices';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { makeSlides } from './placeholder-slides';

/*
 * The accessibility checks' gaps, closed (Sessions 31–36, A11Y-3): Shift+Tab in a dialog, a check with a
 * tooltip open, forced colours (Windows' contrast themes), and an output under reduced motion. Placeholder
 * words only.
 */

test('Shift+Tab goes round inside a dialog, never out of it', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.keyboard.press('Shift+Slash');
  const sheet = win.getByTestId('keys-sheet');
  await expect(sheet).toBeVisible();
  const inside = () =>
    win.evaluate(() => {
      const dialog = document.querySelector('[data-testid="keys-sheet"]');
      return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement);
    });
  const stops = new Set<string>();
  for (let i = 0; i < 30; i++) {
    await win.keyboard.press('Shift+Tab');
    expect(await inside(), `Shift+Tab ${String(i + 1)} left the dialog`).toBe(true);
    stops.add(await win.evaluate(() => document.activeElement?.outerHTML.slice(0, 60) ?? ''));
  }
  // It went round (more than one stop), always inside.
  expect(stops.size).toBeGreaterThan(1);
  await app.close();
});

test('with a tooltip open the window passes the accessibility checks, and the tooltip says what it is for', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await win.getByTestId('open-stream').hover();
  const tip = win.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('The stream to YouTube, and recording');
  await expectNoSeriousA11yIssues(win, 'the operator window with a tooltip open');
  await app.close();
});

/** What forced colours keep that tells the chosen tab from the others: its underline, outline or border. */
const tabMarks = (win: Page) =>
  win.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
      .filter((t) => t.offsetParent !== null)
      .map((t) => {
        const s = getComputedStyle(t);
        return {
          chosen: t.getAttribute('aria-selected') === 'true',
          mark: `${s.textDecorationLine} ${s.outlineStyle} ${s.borderBottomStyle}`,
        };
      }),
  );

test('in forced colours (a Windows contrast theme) the chosen tab and the focus can still be seen, and the checks pass', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await win.emulateMedia({ forcedColors: 'active' });
  const marks = await tabMarks(win);
  const chosen = marks.filter((m) => m.chosen).map((m) => m.mark);
  const others = marks.filter((m) => !m.chosen).map((m) => m.mark);
  expect(chosen.length).toBeGreaterThan(0);
  expect(others.length).toBeGreaterThan(0);
  // Every chosen tab carries a mark no other tab has (backgrounds, which showed it, are the system's own here).
  for (const mark of chosen) expect(others, `the chosen tab's ${mark}`).not.toContain(mark);
  // The keyboard's place: an outline, which forced colours keep.
  await win.keyboard.press('Tab');
  expect(
    await win.evaluate(() => getComputedStyle(document.activeElement ?? document.body).outlineStyle),
  ).not.toBe('none');
  await expectNoSeriousA11yIssues(win, 'the operator window in forced colours');
  await app.close();
});

test('with the computer set to reduce motion, the audience screens still dissolve and the ticker still runs', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const id = await makeSlides(
    win,
    'Placeholder dissolves under reduced motion',
    [
      { words: 'Placeholder one', background: '#000000' },
      { words: 'Placeholder two', background: '#ffffff' },
    ],
    { kind: 'dissolve', durationMs: 2000 },
  );
  await setUpScreen(win);
  const out = await outputPage(app);
  await outputReady(out);
  await out.emulateMedia({ reducedMotion: 'reduce' });
  const goLive = (slideIndex: number) =>
    win.evaluate(
      ({ id, slideIndex }) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId: id,
          slideIndex,
        }),
      { id, slideIndex },
    );
  await goLive(0);
  await expect(out.locator('[data-layer="slide"]')).toContainText('Placeholder one');
  await goLive(1);
  // Part-way through the dissolve the new slide is neither gone nor whole.
  await expect
    .poll(
      () =>
        out.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-layer="slide"] *')].some((part) => {
            const o = Number(part.style.opacity);
            return part.style.opacity !== '' && o > 0.05 && o < 0.95;
          }),
        ),
      { timeout: 10_000, intervals: [50] },
    )
    .toBe(true);

  // The ticker, from a phone's announcement: it moves under reduced motion too.
  const { base } = await networkOn(win);
  const key = await win.evaluate(async () => {
    const r = await (globalThis as PageGlobals).drashti.network.makePoster();
    if (!r.ok || !r.status.poster) throw new Error(r.ok ? 'no poster link' : r.message);
    return r.status.poster.url.split('#k=')[1] ?? '';
  });
  const phone = await device('chromium');
  try {
    await phone.page.goto(`${base}/announce#k=${key}`);
    await phone.page.getByTestId('announce-text').fill('Placeholder announcement');
    await phone.page.getByTestId('announce-from').fill('Placeholder name');
    await phone.page.getByTestId('announce-send').click();
    await expect(phone.page.getByRole('status')).toContainText('waiting for the operator');
  } finally {
    await phone.close();
  }
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [waiting] = (await d.announcements.list()).waiting;
    await d.announcements.approve({ id: waiting?.id ?? '', as: 'ticker' });
  });
  const at = () =>
    out.evaluate(() => {
      const a = document.querySelector('[data-testid="ticker-words"]')?.getAnimations()[0];
      return { playing: a?.playState === 'running', time: Number(a?.currentTime ?? 0) };
    });
  await expect.poll(async () => (await at()).playing).toBe(true);
  const first = (await at()).time;
  await expect.poll(async () => (await at()).time).not.toBe(first);
  await app.close();
});
