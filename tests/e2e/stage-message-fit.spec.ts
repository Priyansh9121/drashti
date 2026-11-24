import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { newStageBox, type StageBox } from '../../src/shared/stage-layouts';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';

/*
 * A stage message always fits its place (the owner, 24 Nov 2026): one that fits keeps the operator's chosen size,
 * exactly as before; one that would go past its place or the screen (many lines, or one very long word) wraps at its
 * words, is centred in its place, and is drawn as large as still fits, never above the chosen size. On the Standard
 * stage screen, in a layout's message box, as the banner across the top, over the audience picture with Stage off,
 * and in the operator's preview of the stage. Gujarati and Hindi wrap by their words too. Placeholder words only.
 */

const SCREENS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

/** As many short placeholder words as the message holds (300 characters at most): sixty of them. */
const LONG = `Placeholder: ${Array.from(
  { length: 59 },
  (_, i) => ['wait', 'for', 'the', 'next', 'song', 'then', 'come', 'up', 'to', 'the', 'side'][i % 11],
).join(' ')}`;
/** One word as long as a message can be: wider than any place, so it breaks inside, as it always did. */
const ONE_WORD = 'Placeholder'.repeat(27);
/** Gujarati and Hindi placeholder sentences, with conjuncts (ક્ત, બ્દ, સ્થ; स्थ, प्र, ब्द), to near the limit. */
const GUJARATI = Array.from({ length: 7 }, () => 'આ ફક્ત નમૂનાના શબ્દો છે, સ્થાન બતાવવા').join(' ');
const HINDI = Array.from({ length: 6 }, () => 'यह केवल नमूना शब्द हैं, स्थान और प्रकार के लिए').join(' ');
const SHORT = 'Placeholder: two minutes left';

async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  return found;
}

const makeStage = (win: Page, name: string) =>
  win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === name);
    if (!group) throw new Error(`no group ${name}`);
    const set = await d.screens.setGroupRole(group.id, 'stage');
    if (!set.ok) throw new Error(set.message);
  }, name);

const saveLayout = (win: Page, id: string | null, name: string, boxes: StageBox[]) =>
  win.evaluate(
    async ({ id, name, boxes }) => {
      const saved = await (globalThis as PageGlobals).drashti.stageLayouts.save(id, {
        name,
        background: '#000000',
        boxes,
      });
      if (!saved.ok) throw new Error(saved.message);
      return saved.id;
    },
    { id, name, boxes },
  );

const showMessage = (win: Page, text: string, size: 'standard' | 'large' | 'huge') =>
  win.evaluate(
    ({ text, size }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'setStageMessage', text, size }),
    { text, size },
  );

/**
 * Where a message is drawn against its place (`place`, a selector its element is inside, or else in the page): inside
 * it (to the pixel) and, on a stage screen (`screen`), inside the window; its words inside the message, each word on
 * one line (none broken across two: wrapped by words), how far below the chosen size, and its alignment.
 */
function drawn(message: Locator, place: string, screen = true) {
  return message.evaluate(
    (el, { place, screen }) => {
      const area = (el.closest(place) ?? document.querySelector(place))?.getBoundingClientRect();
      if (!area) throw new Error(`no ${place}`);
      const r = el.getBoundingClientRect();
      const words: string[] = [];
      const broken: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (const m of text.matchAll(/\S+/gu)) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const tops = [...range.getClientRects()].map((rect) => Math.round(rect.top));
          words.push(m[0]);
          if (tops.some((t) => Math.abs(t - (tops[0] ?? t)) > 1)) broken.push(m[0]);
        }
      }
      const fitted = el.closest('[data-message-fit]');
      return {
        inside:
          r.top >= area.top - 1 &&
          r.bottom <= area.bottom + 1 &&
          r.left >= area.left - 1 &&
          r.right <= area.right + 1 &&
          (!screen || (r.top >= -1 && r.bottom <= window.innerHeight + 1)),
        wordsInside: el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
        broken,
        words: words.length,
        fontSize: parseFloat(getComputedStyle(el).fontSize),
        fit: fitted ? Number(fitted.getAttribute('data-message-fit')) : 1,
        align: getComputedStyle(el).textAlign,
      };
    },
    { place, screen },
  );
}

/**
 * Whether the message would run past its place drawn a little larger than it is (a hundredth more of its chosen
 * size): it is as large as still fits. Put back as it was after.
 */
function overIfLarger(message: Locator) {
  return message.evaluate((el) => {
    const place = el.closest<HTMLElement>('[data-message-fit]');
    if (!place) throw new Error('not made smaller');
    const fit = Number(place.style.getPropertyValue('--stage-message-fit'));
    place.style.setProperty('--stage-message-fit', String(Math.min(1, fit + 0.01)));
    const words = place.firstElementChild instanceof HTMLElement ? place.firstElementChild : null;
    const over =
      place.scrollHeight > place.clientHeight + 0.5 ||
      (words !== null && words.offsetHeight > place.clientHeight + 0.5);
    place.style.setProperty('--stage-message-fit', String(fit));
    return over;
  });
}

test('a long stage message wraps, is centred and made only as small as it must be: on the Standard stage screen, the operator’s preview, a layout’s message box, the banner and with Stage off; a short one keeps its size', async () => {
  test.setTimeout(180_000);
  expect(LONG.length).toBeLessThanOrEqual(300);
  expect(LONG.split(' ')).toHaveLength(60);
  const { app } = await launchApp(SCREENS);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage one', 1);
  await makeStage(win, 'Stage one');
  const stage = await outputFor(app, stageId);
  const panel = win.getByTestId('stage-message-control');

  // A short message on the Standard stage screen: its chosen size, as before, nothing made smaller.
  await showMessage(win, SHORT, 'huge');
  const onStage = stage.getByTestId('stage-message');
  await expect(onStage).toHaveText(SHORT);
  await expect(onStage).toHaveCSS('font-size', '128px');
  expect(await drawn(onStage, '[data-testid="stage-view"]')).toMatchObject({
    inside: true,
    wordsInside: true,
    fit: 1,
    align: 'start',
  });

  // A long one: inside the stage screen, every word whole, centred, smaller only as much as it must be.
  await showMessage(win, LONG, 'huge');
  await expect(onStage).toHaveText(LONG);
  const standard = await drawn(onStage, '[data-testid="stage-view"]');
  expect(standard).toMatchObject({ inside: true, wordsInside: true, broken: [], words: 60, align: 'center' });
  expect(standard.fit).toBeLessThan(1);
  expect(standard.fontSize).toBeLessThan(128);
  expect(standard.fontSize).toBeCloseTo(128 * standard.fit, 0);
  expect(await overIfLarger(onStage)).toBe(true);
  // The operator's preview of the stage: the same, at its size.
  const preview = panel.getByTestId('stage-preview').getByTestId('stage-message');
  await expect(preview).toHaveText(LONG);
  expect(await drawn(preview, '[data-testid="stage-preview"]', false)).toMatchObject({
    inside: true,
    wordsInside: true,
    broken: [],
    align: 'center',
  });
  // One very long word: broken inside it, as it always was, but inside the stage screen.
  await showMessage(win, ONE_WORD, 'huge');
  await expect(onStage).toHaveText(ONE_WORD);
  expect(await drawn(onStage, '[data-testid="stage-view"]')).toMatchObject({
    inside: true,
    wordsInside: true,
  });

  // A layout's small message box (600 × 300, its words 56 px): a short message as before, a long one fitted in it.
  const withBox = await saveLayout(win, null, 'Placeholder small message box', [
    newStageBox('stageMessage', 'message'),
  ]);
  await panel.getByTestId('stage-layout-choice').selectOption(withBox);
  const inBox = stage.getByTestId('stage-box-message');
  const BOX = '[data-stage-box="stageMessage"]';
  await showMessage(win, SHORT, 'standard');
  await expect(inBox).toHaveText(SHORT);
  await expect(inBox).toHaveCSS('font-size', '56px');
  expect(await drawn(inBox, BOX)).toMatchObject({ inside: true, fit: 1, align: 'left' });
  await showMessage(win, LONG, 'standard');
  await expect(inBox).toHaveText(LONG);
  const boxed = await drawn(inBox, BOX);
  expect(boxed).toMatchObject({ inside: true, wordsInside: true, broken: [], words: 60, align: 'center' });
  expect(boxed.fit).toBeLessThan(1);
  expect(boxed.fontSize).toBeCloseTo(56 * boxed.fit, 0);
  expect(await overIfLarger(inBox)).toBe(true);
  // Centred up and down in the box's room below its label.
  const room = await inBox.evaluate((el) => {
    const place = el.closest('[data-message-fit]')?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return place ? { above: r.top - place.top, below: place.bottom - r.bottom } : null;
  });
  expect(room).not.toBeNull();
  expect(Math.abs((room?.above ?? 0) - (room?.below ?? 99))).toBeLessThanOrEqual(2);
  // The layout edited, its box made larger: fitted again, larger, never above the chosen size.
  await saveLayout(win, withBox, 'Placeholder small message box', [
    { ...newStageBox('stageMessage', 'message'), frame: { x: 160, y: 90, width: 1600, height: 900 } },
  ]);
  await expect
    .poll(async () => (await drawn(inBox, BOX)).fontSize, { message: 'fitted again in the larger box' })
    .toBeGreaterThan(boxed.fontSize);
  expect(await drawn(inBox, BOX)).toMatchObject({ inside: true, wordsInside: true, broken: [] });
  expect((await drawn(inBox, BOX)).fontSize).toBeLessThanOrEqual(56);

  // A layout with no message box: the banner across the top, kept inside the screen's margins.
  const clockOnly = await saveLayout(win, null, 'Placeholder clock only', [newStageBox('clock', 'clock')]);
  await panel.getByTestId('stage-layout-choice').selectOption(clockOnly);
  const banner = stage.getByTestId('stage-message-banner');
  await showMessage(win, SHORT, 'huge');
  await expect(banner).toHaveText(SHORT);
  expect(await drawn(banner, '[data-testid="output-root"]')).toMatchObject({ inside: true, fit: 1 });
  await showMessage(win, LONG, 'huge');
  await expect(banner).toHaveText(LONG);
  const across = await drawn(banner, '[data-testid="output-root"]');
  expect(across).toMatchObject({ inside: true, wordsInside: true, broken: [], words: 60, align: 'center' });
  expect(across.fit).toBeLessThan(1);
  expect(await overIfLarger(banner)).toBe(true);

  // Stage off: the banner over the audience picture, inside it.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', false));
  await expect(stage.getByTestId('stage-audience-picture')).toBeVisible();
  await expect(banner).toHaveText(LONG);
  expect(await drawn(banner, '[data-testid="stage-audience-picture"]')).toMatchObject({
    inside: true,
    wordsInside: true,
    broken: [],
    align: 'center',
  });
  await app.close();
});

test('a long Gujarati or Hindi stage message wraps at its words, conjuncts whole, on the Standard stage screen and in a layout’s message box', async () => {
  test.setTimeout(150_000);
  for (const words of [GUJARATI, HINDI]) expect(words.length).toBeLessThanOrEqual(300);
  const { app } = await launchApp(SCREENS);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage one', 1);
  await makeStage(win, 'Stage one');
  const stage = await outputFor(app, stageId);
  const panel = win.getByTestId('stage-message-control');
  const onStage = stage.getByTestId('stage-message');
  for (const [words, lang] of [
    [GUJARATI, 'gu'],
    [HINDI, 'hi'],
  ] as const) {
    await showMessage(win, words, 'huge');
    await expect(onStage).toHaveText(words);
    await expect(onStage).toHaveAttribute('lang', lang);
    const shown = await drawn(onStage, '[data-testid="stage-view"]');
    expect(shown, lang).toMatchObject({ inside: true, wordsInside: true, broken: [], align: 'center' });
    expect(shown.fit, lang).toBeLessThan(1);
  }
  const withBox = await saveLayout(win, null, 'Placeholder small message box', [
    newStageBox('stageMessage', 'message'),
  ]);
  await panel.getByTestId('stage-layout-choice').selectOption(withBox);
  const inBox = stage.getByTestId('stage-box-message');
  for (const words of [GUJARATI, HINDI]) {
    await showMessage(win, words, 'large');
    await expect(inBox).toHaveText(words);
    const shown = await drawn(inBox, '[data-stage-box="stageMessage"]');
    expect(shown).toMatchObject({ inside: true, wordsInside: true, broken: [], align: 'center' });
  }
  await app.close();
});
