import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';
import { headingProblems, layoutPicture, liveRowProblems } from './operator-layout';

/*
 * The operator window as CI's displays leave it, about 1024 × 645 (Session 51). Start here's three steps had been
 * centred in a place that could neither shrink nor scroll, so they ran on under the layer bar and the status bar,
 * and step 3's Show on could not be clicked (show-on.spec:81 failed on every job); and the layer bar scrolled
 * sideways, only Clear all showing its key. Now the middle's empty places are centred while they fit and scroll
 * from their top when they do not (a video input item's view too, Session 51's B1, under the open playlist); every
 * button of the layer bar shows its words and its key, the clears in the order of their keys, from the smallest
 * window Drashti allows (1008 px wide on Windows) to a full HD display's, in every state; and so do Simple Mode's
 * big buttons, each with its keys too. The open playlist's and the slides' "What is this?" shrink and scroll in
 * their places, their buttons in reach. The displays are Drashti's pretend ones.
 */

/** A first start as a person meets it, a display connected: the welcome, then Start here behind it. */
const FIRST_START = {
  DRASHTI_TEST_NO_WIZARD: '0',
  DRASHTI_TEST_SEED_PLACEHOLDERS: '',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_EXTRA_DISPLAYS: '1',
};

/** From the smallest operator window (Windows' 1008 px of content at its least) to a full HD display's. */
const WIDTHS = [1008, 1024, 1280, 1366, 1440, 1600, 1920];

for (const mode of ['pro', 'simple'] as const) {
  for (const size of [
    { width: 1024, height: 645 },
    { width: 1280, height: 720 },
    { width: 1440, height: 820 },
  ]) {
    test(`${mode}: LIVE controls, keys and panel headings fit at ${String(size.width)} × ${String(size.height)}`, async () => {
      const { app } = await launchApp();
      const win = await operatorPage(app);
      await operatorReady(win);
      await sizeOperatorWindow(app, win, size);
      if (mode === 'simple') {
        await chooseMenuItem(app, 'switch-mode');
        await expect(win.getByTestId('simple-mode')).toBeVisible();
      }
      await win.evaluate(() => document.fonts.ready.then(() => undefined));
      // Soft assertions retain every distinct fault and the More tools picture on the old layout.
      const soft = expect.configure({ soft: true });
      const splitter = win.getByRole('separator', { name: 'Resize the live column', exact: true });
      for (const columnWidth of [380, 300]) {
        // Check a fresh layout and the narrowest remembered column, at each window size and in both modes.
        await splitter.press(columnWidth === 380 ? 'Enter' : 'Home');
        await expect(splitter).toHaveAttribute('aria-valuenow', String(columnWidth));
        await win.getByRole('complementary', { name: 'Live', exact: true }).evaluate((el) => {
          el.scrollTop = 0;
        });
        await expect(win.getByTestId('show-back')).toBeInViewport({ ratio: 1 });
        await expect(win.getByTestId('show-next')).toBeInViewport({ ratio: 1 });
        await expect(win.getByTestId('next-up')).toHaveAccessibleName(/^Next up: .+/u);
        const picture = `${mode}-${String(size.width)}-${String(columnWidth)}`;
        await layoutPicture(win, `${picture}-live`);
        await soft.poll(() => liveRowProblems(win)).toEqual([]);
        if (mode === 'pro') {
          await win.getByTestId('group-more-tools-toggle').click();
          const lowerThirds = win.getByTestId('lower-thirds-panel');
          await lowerThirds.scrollIntoViewIfNeeded();
          await layoutPicture(win, `${picture}-tools`);
          const note = win.getByText(
            'A lower third shows a name, a title or a place across the bottom of the picture.',
            { exact: true },
          );
          const heading = await lowerThirds.getByRole('heading', { name: 'Lower Thirds' }).boundingBox();
          const explanation = await note.boundingBox();
          expect.soft(heading).not.toBeNull();
          expect.soft(explanation).not.toBeNull();
          if (heading && explanation)
            expect.soft(explanation.y).toBeGreaterThanOrEqual(heading.y + heading.height);
          await expect.soft(lowerThirds).toContainText(await note.innerText());
        }
        await soft.poll(() => headingProblems(win)).toEqual([]);
        if (mode === 'pro') await win.getByTestId('group-more-tools-toggle').click();
      }
      await app.close();
    });
  }
}

/**
 * A bar along the bottom as it is laid out now: what does not fit (it scrolls sideways, a button sticks out of it
 * or lies over another, a button's words or key cut off), and its buttons left to right (the higher first where
 * two start at the same place), each as its name and the keys it shows ("Clear slide F2").
 */
const barNow = (win: Page, testId: string) =>
  win.evaluate((id) => {
    const problems: string[] = [];
    const bar = document.querySelector(`[data-testid="${id}"]`);
    if (!(bar instanceof HTMLElement)) return { problems: [`there is no ${id}`], buttons: [] };
    if (bar.scrollWidth > bar.clientWidth)
      problems.push(`it scrolls sideways (${String(bar.scrollWidth)} > ${String(bar.clientWidth)} px)`);
    const edge = bar.getBoundingClientRect();
    const words = (el: Element): string => {
      const label = el.getAttribute('aria-label');
      if (label !== null) return label;
      let text = '';
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode())
        if (!n.parentElement?.closest('kbd, [data-keys]')) text += n.textContent ?? '';
      return text.trim();
    };
    const boxes = [...bar.querySelectorAll('button')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0)
      .sort((a, b) => Math.round(a.r.left) - Math.round(b.r.left) || a.r.top - b.r.top);
    for (const { el, r } of boxes) {
      if (r.left < edge.left - 0.5 || r.right > edge.right + 0.5 || r.right > window.innerWidth + 0.5)
        problems.push(`${words(el)} sticks out of the bar`);
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
        problems.push(`${words(el)}: its words do not fit`);
      for (const k of el.querySelectorAll('kbd')) {
        const kr = k.getBoundingClientRect();
        if (
          kr.width === 0 ||
          kr.left < r.left - 0.5 ||
          kr.right > r.right + 0.5 ||
          kr.top < r.top - 0.5 ||
          kr.bottom > r.bottom + 0.5
        )
          problems.push(`${words(el)}: its key ${k.textContent} is not shown whole`);
      }
    }
    boxes.forEach((a, i) => {
      for (const b of boxes.slice(i + 1)) {
        const across = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const down = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (across > 1 && down > 1) problems.push(`${words(a.el)} overlaps ${words(b.el)}`);
      }
    });
    const buttons = boxes.map(({ el }) =>
      [words(el), ...[...el.querySelectorAll('kbd')].map((k) => k.textContent.trim())].join(' '),
    );
    return { problems, buttons };
  }, testId);

/** The bar at each of WIDTHS (the height as CI's): nothing of it cut off, and these buttons in this order. */
async function expectBarAtEveryWidth(win: Page, testId: string, buttons: string[], state: string) {
  for (const width of WIDTHS) {
    await win.setViewportSize({ width, height: CI_WINDOW.height });
    await expect
      .poll(() => barNow(win, testId), { message: `${testId}, ${state}, at ${String(width)} px wide` })
      .toEqual({ problems: [], buttons });
  }
  await win.setViewportSize(CI_WINDOW);
}

/** Each of these buttons can be clicked as they are (nothing over them; scrolled to where needed), unpressed. */
async function expectClickable(buttons: Locator, what: string) {
  const count = await buttons.count();
  expect(count, what).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) await buttons.nth(i).click({ trial: true, timeout: 10_000 });
}

/**
 * A place in the middle as laid out now (Start here; a video input item's view, Session 51), by its test id: any of
 * it outside the middle or under the bars, a button sticking out of the middle, and whether it is centred while it
 * fits, or shown from its top, scrolling, when it does not.
 */
const placeNow = (win: Page, testId: string) =>
  win.evaluate((id) => {
    const out: string[] = [];
    const place = document.querySelector(`[data-testid="${id}"]`);
    const middle = document.querySelector('[data-testid="column-middle"]');
    const bar = document.querySelector('[data-testid="layer-bar"]');
    const content = place?.firstElementChild;
    if (!(place instanceof HTMLElement) || !middle || !bar || !content)
      return [`${id}, the middle or the layer bar is missing`];
    place.scrollTop = 0;
    const p = place.getBoundingClientRect();
    const m = middle.getBoundingClientRect();
    const floor = Math.min(m.bottom, bar.getBoundingClientRect().top);
    const at = (n: number) => String(Math.round(n));
    if (p.top < m.top - 0.5 || p.bottom > floor + 0.5)
      out.push(
        `it runs from ${at(p.top)} to ${at(p.bottom)} px, the middle from ${at(m.top)} to ${at(floor)}`,
      );
    for (const b of place.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (r.left < m.left - 0.5 || r.right > m.right + 0.5)
        out.push(`“${b.textContent.trim()}” sticks out of the middle`);
    }
    const c = content.getBoundingClientRect();
    const scrolls = place.scrollHeight > place.clientHeight + 1;
    if (!scrolls && Math.abs(c.top - p.top - (p.bottom - c.bottom)) > 1.5)
      out.push('it fits, but is not centred');
    if (scrolls && c.top < p.top - 0.5) out.push('it does not fit, and its top is cut off');
    return out;
  }, testId);

/** The open playlist's first row as laid out now (Session 55): inside the middle, above the layer bar. */
const rowPlaced = (win: Page) =>
  win.evaluate(() => {
    const out: string[] = [];
    const row = document.querySelector('[data-testid="open-playlist"] [data-testid="playlist-item"]');
    const middle = document.querySelector('[data-testid="column-middle"]');
    const bar = document.querySelector('[data-testid="layer-bar"]');
    if (!row || !middle || !bar) return ['the row, the middle or the layer bar is missing'];
    const r = row.getBoundingClientRect();
    const m = middle.getBoundingClientRect();
    const floor = Math.min(m.bottom, bar.getBoundingClientRect().top);
    if (r.top < m.top - 0.5 || r.bottom > floor + 0.5)
      out.push('it runs out of the middle, or under the bars');
    if (r.left < m.left - 0.5 || r.right > m.right + 0.5) out.push('it sticks out of the middle');
    return out;
  });

/** The layer bar's clears, in the order of their keys (Session 55: F4 and F8 went with Props and Masks). */
const CLEARS = [
  ['slide', 'F2'],
  ['background', 'F3'],
  ['audio', 'F5'],
  ['messages', 'F6'],
  ['ticker', 'F7'],
] as const;

/** The layer bar's buttons left to right (single-letter keys on): the clears in the order of their keys. */
const proBar = (first: string, lit: string[], wallpaper: string, blackout: string): string[] => [
  first,
  ...CLEARS.map(([layer, key]) => `Clear ${layer}${lit.includes(layer) ? ' (on screen)' : ''} ${key}`),
  'What is this? Show controls',
  wallpaper,
  blackout,
];

test('Start here at 1024 × 645 and 1024 × 768 in an empty library: centred or scrolling from its top, never under the bars, every step’s button clickable', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp(FIRST_START);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await win.getByTestId('welcome-skip').click();
  const startHere = win.getByTestId('start-here');
  await expect(startHere.getByTestId('start-step')).toHaveCount(3);
  // Step 3 says the screens set themselves (Session 55), with Set Up Screens… (the case CI could not click).
  await expect(startHere.getByTestId('start-step').nth(2)).toContainText('The screens set themselves');
  await expect(startHere.getByTestId('start-step').nth(2).getByRole('button')).toHaveText([
    'Set Up Screens…',
  ]);
  for (const size of [CI_WINDOW, { width: 1024, height: 768 }]) {
    const where = `${String(size.width)} × ${String(size.height)}`;
    await sizeOperatorWindow(app, win, size);
    await expect.poll(() => placeNow(win, 'start-here'), { message: `Start here at ${where}` }).toEqual([]);
    await expectClickable(startHere.getByRole('button'), `Start here’s buttons at ${where}`);
    await expect
      .poll(async () => (await barNow(win, 'layer-bar')).problems, { message: `the layer bar at ${where}` })
      .toEqual([]);
  }
  await app.close();
});

test('a video input item’s row at 1024 × 645 and 1024 × 768, on this computer and not: never under the bars, clickable, and saying why when it is not here', async () => {
  test.setTimeout(90_000);
  // Chromium's fake camera (a moving test pattern) stands in for the input: never a real camera's picture.
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // A playlist of one video input item (Session 51): its row in the playlist, which has the whole middle (Session 55).
  const inputId = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const added = await d.videoInputs.add({ name: 'Placeholder input', device: 'fake_device_0', fit: 'fit' });
    if (!added.ok) throw new Error(added.message);
    const made = await d.playlists.create('Placeholder Sunday', null, false);
    if (!made.ok) throw new Error(made.message);
    const items = await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'input', name: 'Placeholder input' },
    ]);
    if (!items.ok) throw new Error(items.message);
    return added.view.inputs[0]?.id ?? '';
  });
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sunday' }).click();
  const row = win.getByTestId('open-playlist').getByTestId('playlist-item');
  await expect(row).toHaveCount(1);
  const sizes = [CI_WINDOW, { width: 1024, height: 768 }];
  for (const size of sizes) {
    const where = `${String(size.width)} × ${String(size.height)}`;
    await sizeOperatorWindow(app, win, size);
    await expect.poll(() => rowPlaced(win), { message: `the input item’s row at ${where}` }).toEqual([]);
    await expectClickable(row, `the input item’s row at ${where}`);
  }
  // Not on this computer (removed from Media): its row says so, in the same place.
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.videoInputs.remove(id), inputId);
  await expect(row.getByTestId('item-input-missing')).toHaveText('Not on this computer');
  for (const size of sizes) {
    const where = `${String(size.width)} × ${String(size.height)}`;
    await sizeOperatorWindow(app, win, size);
    await expect
      .poll(() => rowPlaced(win), { message: `the missing input item’s row at ${where}` })
      .toEqual([]);
    await expectClickable(row, `the missing input item’s row at ${where}`);
  }
  await app.close();
});

test('the open playlist’s and the slides’ “What is this?” at 1024 × 645 and 1024 × 768: each shrinks and scrolls in its place, its buttons clickable', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // A playlist of one placeholder presentation, open in the middle, its slides as rows under its name (Session 55);
  // the slides' own card is the library's chosen presentation's, with no playlist open.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [first] = await d.library.listPresentations();
    if (!first) throw new Error('no placeholder presentation');
    const made = await d.playlists.create('Placeholder Sunday', null, false);
    if (!made.ok) throw new Error(made.message);
    const added = await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'presentation', presentationId: first.id },
    ]);
    if (!added.ok) throw new Error(added.message);
  });
  const card = win.getByTestId('what-is-this');
  for (const topic of ['playlist', 'slides']) {
    if (topic === 'playlist')
      await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sunday' }).click();
    else await win.getByTestId('open-playlist').getByTestId('playlist-close').click();
    await expect(win.getByTestId(topic === 'playlist' ? 'open-playlist' : 'slide-grid')).toBeVisible();
    for (const size of [CI_WINDOW, { width: 1024, height: 768 }]) {
      const where = `${String(size.width)} × ${String(size.height)}`;
      await sizeOperatorWindow(app, win, size);
      // In a 1024 × 645 window the open playlist's once ran under the slides' strip, and the slides' under the layer
      // bar.
      await win.getByTestId(`what-is-this-${topic}`).click();
      await expect(card).toBeVisible();
      await expectClickable(card.getByRole('button'), `the ${topic}’s What is this? at ${where}`);
      await card.getByRole('button', { name: 'Got it' }).click();
      await expect(card).toHaveCount(0);
    }
  }
  await app.close();
});

test('the welcome and the practice show at 1024 × 645, every button clickable; the layer bar from 1008 px wide in every state, each button’s words and key, the clears in the order of their keys', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(FIRST_START);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const welcome = win.getByTestId('welcome');
  await expectFits(welcome, 'the welcome at 1024 × 645');
  await expectClickable(welcome.getByRole('button'), 'the welcome’s buttons');

  await welcome.getByTestId('welcome-practice').click();
  await expect(win.getByTestId('practice-banner')).toBeVisible();
  await expectClickable(win.getByTestId('practice-leave'), 'Leave the practice show');
  await expectClickable(win.getByTestId('practice-thumb'), 'the practice slides');
  await expectClickable(win.getByTestId('show-next'), 'Next');
  // The keys to try, the last of them too, in their column (it scrolls in a window too short for them).
  const lastKey = win.getByTestId('practice-keys').getByRole('listitem').last();
  await lastKey.scrollIntoViewIfNeeded();
  await expect(lastKey).toBeInViewport();

  // The practice show works the layer bar as a show does: nothing up; then a slide and Black-out on, then the
  // Wallpaper (the Logo until Session 55) in Black-out's place, one cover at a time as in a show (Session 57); then
  // Clear all, Put it back offered with the Wallpaper on, then with Black-out back in its place.
  await expectBarAtEveryWidth(
    win,
    'layer-bar',
    proBar('Clear all F1', [], 'Wallpaper F12', 'Black-out B'),
    'as it opens',
  );
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('b');
  await expect(win.getByTestId('blackout-button')).toHaveText(/Black-out is on/u);
  await expectBarAtEveryWidth(
    win,
    'layer-bar',
    proBar('Clear all F1', ['slide'], 'Wallpaper F12', 'Black-out is on B'),
    'a slide up, Black-out on',
  );
  await win.keyboard.press('F12');
  await expect(win.getByTestId('wallpaper-button')).toHaveText(/Wallpaper is on/u);
  await expect(win.getByTestId('blackout-button')).not.toHaveText(/Black-out is on/u);
  await expectBarAtEveryWidth(
    win,
    'layer-bar',
    proBar('Clear all F1', ['slide'], 'Wallpaper is on F12', 'Black-out B'),
    'a slide up, the Wallpaper on in Black-out’s place',
  );
  await win.keyboard.press('F1');
  await expect(win.getByTestId('put-back')).toBeVisible();
  await expectBarAtEveryWidth(
    win,
    'layer-bar',
    proBar('Put it back', [], 'Wallpaper is on F12', 'Black-out B'),
    'Put it back offered, the Wallpaper on',
  );
  await win.keyboard.press('b');
  await expect(win.getByTestId('blackout-button')).toHaveText(/Black-out is on/u);
  await expect(win.getByTestId('wallpaper-button')).not.toHaveText(/Wallpaper is on/u);
  await expectBarAtEveryWidth(
    win,
    'layer-bar',
    proBar('Put it back', [], 'Wallpaper F12', 'Black-out is on B'),
    'Put it back offered, Black-out on in the Wallpaper’s place',
  );
  await app.close();
});

test('Simple Mode’s bar fits from 1008 px wide, its Slide, Background and Audio too, with Black-out on, then the Wallpaper in its place, and Put it back offered with each; its Next and Back in sight', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // A slide up for Clear all to take down, put up in Pro Mode (Simple Mode chooses none).
  const problem = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [first] = await d.library.listPresentations();
    if (!first) return 'no placeholder presentation';
    await d.engine.dispatch({ type: 'goLive', presentationId: first.id, slideIndex: 0 });
    return '';
  });
  expect(problem).toBe('');
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // Pro Mode's bar since Session 55 (Part 18), with Clear all, Slide, Background and Audio beside it (Session 56), the
  // Wallpaper and Black-out, each with its key; Put it back in Clear all's place after it. Next and Back are under
  // LIVE, as in Pro Mode.
  const simpleBar = (clear: string, slideUp: boolean, wallpaper: string, blackout: string) => [
    clear,
    `Clear slide${slideUp ? ' (on screen)' : ''} F2`,
    'Clear background F3',
    'Clear audio F5',
    wallpaper,
    blackout,
  ];
  await expectBarAtEveryWidth(
    win,
    'simple-buttons',
    simpleBar('Clear all F1', true, 'Wallpaper F12', 'Black-out B'),
    'as it opens',
  );
  // One cover at a time (Session 57: the Wallpaper and Black-out take each other off), so the bar is checked with
  // each of them on: Black-out, then the Wallpaper in its place; then Put it back offered with each.
  await win.keyboard.press('b');
  await expect(win.getByTestId('simple-blackout')).toHaveText(/Black-out is on/u);
  await expectBarAtEveryWidth(
    win,
    'simple-buttons',
    simpleBar('Clear all F1', true, 'Wallpaper F12', 'Black-out is on B'),
    'Black-out on',
  );
  await win.keyboard.press('F12');
  await expect(win.getByTestId('simple-wallpaper')).toHaveText(/Wallpaper is on/u);
  await expect(win.getByTestId('simple-blackout')).not.toHaveText(/Black-out is on/u);
  await expectBarAtEveryWidth(
    win,
    'simple-buttons',
    simpleBar('Clear all F1', true, 'Wallpaper is on F12', 'Black-out B'),
    'the Wallpaper on in Black-out’s place',
  );
  await win.keyboard.press('F1');
  await expect(win.getByTestId('simple-put-back')).toBeVisible();
  await expectBarAtEveryWidth(
    win,
    'simple-buttons',
    simpleBar('Put it back', false, 'Wallpaper is on F12', 'Black-out B'),
    'Put it back offered, the Wallpaper on',
  );
  await win.keyboard.press('b');
  await expect(win.getByTestId('simple-blackout')).toHaveText(/Black-out is on/u);
  await expect(win.getByTestId('simple-wallpaper')).not.toHaveText(/Wallpaper is on/u);
  await expectBarAtEveryWidth(
    win,
    'simple-buttons',
    simpleBar('Put it back', false, 'Wallpaper F12', 'Black-out is on B'),
    'Put it back offered, Black-out on in the Wallpaper’s place',
  );
  // Next and Back whole and in sight, at the narrowest as at CI's.
  for (const width of [1008, CI_WINDOW.width]) {
    await win.setViewportSize({ width, height: CI_WINDOW.height });
    for (const id of ['show-back', 'show-next'])
      await expect(win.getByTestId(id), `${id} at ${String(width)} px`).toBeInViewport({ ratio: 1 });
  }
  await app.close();
});
