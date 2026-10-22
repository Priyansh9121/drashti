import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

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

/** A first start as a person meets it, a display free for the hall: the welcome, then Start here behind it. */
const FIRST_START = {
  DRASHTI_TEST_NO_WIZARD: '0',
  DRASHTI_TEST_SEED_PLACEHOLDERS: '',
  DRASHTI_TEST_SCREEN_OFFER: '1',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_EXTRA_DISPLAYS: '1',
};

/** From the smallest operator window (Windows' 1008 px of content at its least) to a full HD display's. */
const WIDTHS = [1008, 1024, 1280, 1366, 1440, 1600, 1920];

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

const CLEARS = [
  ['slide', 'F2'],
  ['background', 'F3'],
  ['props', 'F4'],
  ['audio', 'F5'],
  ['messages', 'F6'],
  ['ticker', 'F7'],
  ['masks', 'F8'],
] as const;

/** The layer bar's buttons left to right (single-letter keys on): the clears in the order of their keys. */
const proBar = (first: string, lit: string[], logo: string, blackout: string): string[] => [
  first,
  ...CLEARS.map(([layer, key]) => `Clear ${layer}${lit.includes(layer) ? ' (on screen)' : ''} ${key}`),
  'What is this? Show controls',
  logo,
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
  // The display offered in step 3 too, beside Set Up Screens… (the case CI could not click).
  await expect(startHere.getByTestId('show-on')).toHaveText(/^Show on /u);
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

test('a video input item’s view at 1024 × 645 and 1024 × 768, on this computer and not: centred or scrolling from its top, never under the bars, its picture clickable', async () => {
  test.setTimeout(90_000);
  // Chromium's fake camera (a moving test pattern) stands in for the input: never a real camera's picture.
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // A playlist of one video input item (Session 51), shown in the middle under the open playlist.
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
  await win.getByTestId('open-playlist').getByTestId('playlist-item').click();
  const view = win.getByTestId('item-view');
  await expect(view.getByTestId('item-input')).toBeVisible();
  const sizes = [CI_WINDOW, { width: 1024, height: 768 }];
  for (const size of sizes) {
    const where = `${String(size.width)} × ${String(size.height)}`;
    await sizeOperatorWindow(app, win, size);
    await expect
      .poll(() => placeNow(win, 'input-item-place'), { message: `the input item at ${where}` })
      .toEqual([]);
    await expectClickable(view.getByRole('button'), `the input item’s picture at ${where}`);
  }
  // Not on this computer (removed from Media): why, in the same place.
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.videoInputs.remove(id), inputId);
  await expect(view).toHaveAttribute('data-missing', 'true');
  for (const size of sizes) {
    const where = `${String(size.width)} × ${String(size.height)}`;
    await sizeOperatorWindow(app, win, size);
    await expect
      .poll(() => placeNow(win, 'input-item-place'), { message: `the missing input item at ${where}` })
      .toEqual([]);
  }
  await app.close();
});

test('the open playlist’s and the slides’ “What is this?” at 1024 × 645 and 1024 × 768, a playlist open: each shrinks and scrolls in its place, its buttons clickable', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // A playlist of one placeholder presentation, open in the middle, its slides under it.
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
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sunday' }).click();
  await win.getByTestId('open-playlist').getByTestId('playlist-item').click();
  await expect(win.getByTestId('slide-grid')).toBeVisible();
  const card = win.getByTestId('what-is-this');
  for (const size of [CI_WINDOW, { width: 1024, height: 768 }]) {
    const where = `${String(size.width)} × ${String(size.height)}`;
    await sizeOperatorWindow(app, win, size);
    // In a 1024 × 645 window the open playlist's ran under the slides' strip, and the slides' under the layer bar.
    for (const topic of ['playlist', 'slides']) {
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

  // The practice show works the layer bar as a show does: nothing up; then a slide, Black-out and the Logo on;
  // then Clear all, Put it back offered with the Logo and Black-out still on (the bar at its widest).
  await expectBarAtEveryWidth(
    win,
    'layer-bar',
    proBar('Clear all F1', [], 'Logo F12', 'Black-out B'),
    'as it opens',
  );
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('b');
  await win.keyboard.press('F12');
  await expect(win.getByTestId('logo-button')).toHaveText(/Logo is on/u);
  await expect(win.getByTestId('blackout-button')).toHaveText(/Black-out is on/u);
  await expectBarAtEveryWidth(
    win,
    'layer-bar',
    proBar('Clear all F1', ['slide'], 'Logo is on F12', 'Black-out is on B'),
    'a slide up, the Logo and Black-out on',
  );
  await win.keyboard.press('F1');
  await expect(win.getByTestId('put-back')).toBeVisible();
  await expectBarAtEveryWidth(
    win,
    'layer-bar',
    proBar('Put it back', [], 'Logo is on F12', 'Black-out is on B'),
    'Put it back offered, the Logo and Black-out on',
  );
  await app.close();
});

test('Simple Mode’s big buttons fit from 1008 px wide, with Black-out and the Logo on and Put it back offered', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // A logo, and a slide up for Clear all to take down, set in Pro Mode (Simple Mode chooses neither).
  const problem = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const prop = await d.props.save(null, {
      name: 'Placeholder Logo',
      width: 1920,
      height: 1080,
      elements: [
        {
          id: 'placeholder-logo-text',
          kind: 'text',
          frame: { x: 360, y: 440, width: 1200, height: 200 },
          text: 'Placeholder Logo',
          lang: 'en',
          style: {
            fontFamily: null,
            fontSize: 96,
            fontWeight: 700,
            color: '#ffffff',
            align: 'center',
            verticalAlign: 'middle',
            lineHeight: 1.2,
            shadow: false,
          },
        },
      ],
    });
    if (!prop.ok) return prop.message;
    const marked = await d.props.setLogo(prop.id);
    if (!marked.ok) return marked.message;
    const [first] = await d.library.listPresentations();
    if (!first) return 'no placeholder presentation';
    await d.engine.dispatch({ type: 'goLive', presentationId: first.id, slideIndex: 0 });
    return '';
  });
  expect(problem).toBe('');
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // Left to right: Back, Next, then the column with Black-out over Clear all, and the Logo beside Black-out; each
  // with its keys (Session 51), the Logo's F12 or L as the key line names them, Put it back's Undo as this computer
  // writes it.
  const undo = process.platform === 'darwin' ? '⌘Z' : 'Ctrl+Z';
  const big = (blackout: string, logo: string, clear: string) => [
    'Back ←',
    'Next →',
    `${blackout} B`,
    clear,
    `${logo} F12 L`,
  ];
  await expectBarAtEveryWidth(win, 'simple-buttons', big('Black-out', 'Logo', 'Clear all F1'), 'as it opens');
  await win.keyboard.press('b');
  await win.keyboard.press('F12');
  await expect(win.getByTestId('simple-blackout')).toHaveText(/Black-out is on/u);
  await expect(win.getByTestId('simple-logo')).toHaveText(/Logo is on/u);
  await expectBarAtEveryWidth(
    win,
    'simple-buttons',
    big('Black-out is on', 'Logo is on', 'Clear all F1'),
    'Black-out and the Logo on',
  );
  await win.keyboard.press('F1');
  await expect(win.getByTestId('simple-put-back')).toBeVisible();
  await expectBarAtEveryWidth(
    win,
    'simple-buttons',
    big('Black-out is on', 'Logo is on', `Put it back ${undo}`),
    'Put it back offered, Black-out and the Logo on',
  );
  await app.close();
});
