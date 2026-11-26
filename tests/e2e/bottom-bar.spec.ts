import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropboxStandIn, fileLink } from './dropbox-stand-in';
import type { PageGlobals } from './helpers';
import {
  launchApp,
  openLibrary,
  openSection,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
} from './helpers';
import { pasteLink } from './paste-link';
import { makeTestTone } from './test-media';

/*
 * The bottom bar and the Audio panel (Session 55, Part 13). The bar of clears is smaller, in one row at 1024 × 645
 * (CI's operator window) and at 1280 × 720, with room above it for Part 8's quick bar: Clear all F1, Slide F2,
 * Background F3, Audio F5, Messages F6, Ticker F7, Wallpaper F12 and Black-out B; F4 and F8 do nothing. A button
 * whose layer has nothing up is dimmed, so what is live shows at a glance. The Wallpaper puts the chosen wallpaper
 * up instead of the picture (black until Part 6 brings wallpapers) and takes it off, as the Logo did; Simple
 * Mode's too. Audio lists its audio playlists directly, with no Music heading and no ? of its own; with none it
 * asks for one: Create playlist, Import sounds…, From a Link…, or sounds dropped there. Placeholder slides only.
 *
 * What is up, at a glance (alpha.24, the owner's calmer window): a layer's clear with nothing up is compact, its icon
 * alone, its words and key in its tooltip; lit, its words and key as before. Each keeps its place: no button along
 * the bar moves as a layer goes up.
 */

/** Every button lit or on (Clear all, the clears, the Wallpaper and Black-out), each as its words and key. */
const BAR = [
  'Clear all F1',
  'Slide F2',
  'Background F3',
  'Audio F5',
  'Messages F6',
  'Ticker F7',
  'Wallpaper F12',
  'Black-out B',
];

/** The bar with nothing up: the clears compact, their icons alone (alpha.24). */
const AT_REST = ['Clear all F1', '', '', '', '', '', 'Wallpaper F12', 'Black-out B'];

/** Each layer's clear by its name, with its key. */
const CLEARS = [
  ['Clear slide', 'F2'],
  ['Clear background', 'F3'],
  ['Clear audio', 'F5'],
  ['Clear messages', 'F6'],
  ['Clear ticker', 'F7'],
] as const;

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The bar's buttons, each as its words and keys read in one line. */
const barButtons = (bar: Locator) => bar.locator('button:visible:not([aria-label^="What is this?"])');
const barWords = (bar: Locator) =>
  barButtons(bar).evaluateAll((b) => b.map((x) => (x as HTMLElement).innerText.replace(/\s+/gu, ' ').trim()));

/** Where each of the bar's buttons is along it: its middle, in whole pixels. */
const barMiddles = (bar: Locator) =>
  barButtons(bar).evaluateAll((b) =>
    b.map((x) => {
      const r = x.getBoundingClientRect();
      return Math.round(r.left + r.width / 2);
    }),
  );

/** No button moved along the bar since `before` (a pixel's rounding allowed). */
async function stayPut(bar: Locator, before: number[], where: string): Promise<void> {
  const now = await barMiddles(bar);
  expect(now.length, where).toBe(before.length);
  expect(
    now.filter((x, i) => Math.abs(x - (before[i] ?? Number.NaN)) > 1),
    `${where}: no button moved (${JSON.stringify(before)} then ${JSON.stringify(now)})`,
  ).toEqual([]);
}

/** Every one of the bar's buttons in one row, none cut, the bar not scrolling; its height. */
async function oneRow(win: Page, where: string): Promise<number> {
  const bar = win.getByTestId('layer-bar');
  const boxes = await barButtons(bar).evaluateAll((b) =>
    b.map((x) => {
      const r = x.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, cut: x.scrollWidth > x.clientWidth + 1 };
    }),
  );
  expect(boxes.length, where).toBe(BAR.length);
  const tops = boxes.map((b) => Math.round(b.top));
  expect(Math.max(...tops) - Math.min(...tops), `${where}: one row`).toBeLessThanOrEqual(2);
  expect(
    boxes.filter((b) => b.cut),
    `${where}: no button cut`,
  ).toEqual([]);
  const scrolls = await bar.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(scrolls, `${where}: the bar does not scroll`).toBe(false);
  return (await bar.boundingBox())?.height ?? 0;
}

test('the bar of clears: one row at 1024 × 645 and 1280 × 720, smaller; its buttons with their keys; F4 and F8 do nothing; a button with nothing up dimmed, a clear compact, its words in its tooltip; no button moves as layers go up', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const bar = win.getByTestId('layer-bar');
  for (const [width, height] of [
    [1024, 645],
    [1280, 720],
  ] as const) {
    await win.setViewportSize({ width, height });
    await expect.poll(() => barWords(bar)).toEqual(AT_REST);
    const tall = await oneRow(win, `${width} × ${height}`);
    // Smaller than before (Session 54's bar was 57 px tall with its buttons' keys under their words).
    expect(tall, `${width} × ${height}: the bar's height`).toBeLessThanOrEqual(44);
  }
  await expectNoSeriousA11yIssues(win, 'the bottom bar');

  // Nothing up: every button dimmed, Clear all and the clears off; the Wallpaper and Black-out still pressable.
  const button = (words: string) => bar.getByRole('button', { name: new RegExp(`^${words}`, 'u') });
  for (const words of [
    'Clear all',
    'Clear slide',
    'Clear background',
    'Clear audio',
    'Clear messages',
    'Clear ticker',
  ])
    await expect(button(words), words).toBeDisabled();
  for (const words of ['Wallpaper', 'Black-out']) {
    await expect(button(words), words).toBeEnabled();
    await expect(button(words), words).toHaveAttribute('data-dimmed', 'true');
  }
  // Each layer's clear compact (alpha.24): its icon in sight, no words or key on it; its words and key in its tooltip,
  // the mouse resting on it.
  const tip = win.locator('[role="tooltip"]');
  for (const [words, key] of CLEARS) {
    const clear = button(words);
    await expect(clear, words).toHaveAttribute('data-dimmed', 'true');
    await expect(clear.locator('svg'), words).toBeVisible();
    await expect(clear.locator('kbd'), words).toHaveCount(0);
    await clear.hover();
    await expect(tip, words).toContainText(words);
    await expect(tip.locator('kbd'), words).toHaveText(key);
    await win.mouse.move(0, 0);
    await expect(tip, words).toHaveCount(0);
  }
  const atRest = await barMiddles(bar);

  // A slide up: its clear lights up and Clear all can be pressed; the rest stay dimmed.
  await setUpScreen(win);
  const audience = await outputPage(app);
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await win.getByTestId('slide-thumb').first().click();
  await expect(button('Clear slide')).toHaveAttribute('data-lit', 'true');
  await expect(button('Clear all')).toBeEnabled();
  await expect(button('Clear background')).toBeDisabled();
  // Lit, its words and key back on it, in the place it had; nothing beside it moved.
  await expect.poll(() => barWords(bar)).toEqual(['Clear all F1', 'Slide F2', ...AT_REST.slice(2)]);
  await stayPut(bar, atRest, 'a slide up');

  // F4 and F8 do nothing; F12 puts the wallpaper up over the slide (black: no wallpaper chosen yet), and off.
  const before = await state(win);
  await win.keyboard.press('F4');
  await win.keyboard.press('F8');
  expect((await state(win)).layers).toEqual(before.layers);
  await win.keyboard.press('F12');
  await expect(audience.locator('[data-layer="wallpaper"]')).toBeVisible();
  await expect(button('Wallpaper is on')).toHaveAttribute('data-lit', 'true');
  await expect(button('Wallpaper is on')).not.toHaveAttribute('data-dimmed');
  // The slide stays up underneath, as under the Logo.
  expect((await state(win)).layers.slide?.presentationId).toBe(before.layers.slide?.presentationId);
  await button('Wallpaper is on').click();
  await expect(audience.locator('[data-layer="wallpaper"]')).toHaveCount(0);
  await expect(button('Wallpaper')).toHaveAttribute('data-dimmed', 'true');

  // A background and a message up too: their clears light up with their words and keys, in one row at both sizes,
  // every button where it was with nothing up.
  for (const command of [
    { type: 'setBackground', background: { kind: 'color', color: '#1d4e89' } },
    { type: 'showMessage', message: { id: 'placeholder-message', text: 'Placeholder message' } },
  ])
    await win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);
  const lit = [
    'Clear all F1',
    'Slide F2',
    'Background F3',
    '',
    'Messages F6',
    '',
    'Wallpaper F12',
    'Black-out B',
  ];
  for (const [width, height] of [
    [1024, 645],
    [1280, 720],
  ] as const) {
    await win.setViewportSize({ width, height });
    await expect.poll(() => barWords(bar)).toEqual(lit);
    await oneRow(win, `${width} × ${height}, three layers up`);
  }
  await stayPut(bar, atRest, 'a slide, a background and a message up');
  await app.close();
});

test('Simple Mode’s buttons too: its Clear all dimmed with nothing up; the Wallpaper in the Logo’s place, F12 or the button putting the wallpaper up and taking it off', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1024, height: 645 });
  await setUpScreen(win);
  const audience = await outputPage(app);
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'))).toMatchObject({
    ok: true,
  });
  // Its Clear all dimmed with nothing up, as the bar of clears' is, and pressable once something is.
  const clearAll = win.getByTestId('simple-clear-all');
  await expect(clearAll).toBeDisabled();
  await expect(clearAll).toHaveAttribute('data-dimmed', 'true');
  const [first] = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations());
  await win.evaluate(
    (presentationId) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex: 0 }),
    first?.id ?? '',
  );
  await expect(clearAll).toBeEnabled();
  await expect(clearAll).not.toHaveAttribute('data-dimmed');
  const wallpaper = win.getByTestId('simple-wallpaper');
  await expect(wallpaper).toBeVisible();
  await expect(win.getByTestId('simple-logo')).toHaveCount(0);
  await win.keyboard.press('F12');
  await expect(audience.locator('[data-layer="wallpaper"]')).toBeVisible();
  await expect(wallpaper).toHaveText(/Wallpaper is on/u);
  await wallpaper.click();
  await expect(audience.locator('[data-layer="wallpaper"]')).toHaveCount(0);
  await expect(wallpaper).not.toHaveText(/is on/u);
  await app.close();
});

test('Audio lists its audio playlists directly, with no Music heading or ? of its own; with none it asks for one', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  for (const [width, height] of [
    [1024, 645],
    [1280, 720],
  ] as const) {
    await win.setViewportSize({ width, height });
    await openSection(win, 'audio');
    const group = win.getByTestId('audio-group');
    await expect(group.getByRole('heading', { name: 'Music' })).toHaveCount(0);
    await expect(group.getByRole('button', { name: /^What is this\? Music/u })).toHaveCount(0);
    // None yet: it asks for one, in so many words.
    const empty = group.getByTestId('music-empty');
    await expect(empty).toBeVisible();
    for (const name of ['Create playlist', 'Import sounds…', 'From a Link…'])
      await expect(empty.getByRole('button', { name }), name).toBeVisible();
    await expect(empty).toContainText('drop');
  }
  await expectNoSeriousA11yIssues(win, 'Audio with no audio playlists');
  // From a Link… opens the small window, for a sound.
  await win.getByTestId('music-empty').getByRole('button', { name: 'From a Link…' }).click();
  await expect(win.getByTestId('link-text')).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('link-text')).toHaveCount(0);
  // Create playlist: one, named in place, then listed straight under Audio.
  await win.getByTestId('music-empty').getByRole('button', { name: 'Create playlist' }).click();
  const name = win.getByRole('textbox', { name: 'Name of the audio playlist' });
  await expect(name).toBeFocused();
  await name.fill('Placeholder before sabha');
  await name.press('Enter');
  await expect(
    win
      .getByTestId('audio-group')
      .getByTestId('music-playlist')
      .filter({ hasText: 'Placeholder before sabha' }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(win.getByTestId('music-empty')).toHaveCount(0);
  await app.close();
});

test('From a Link… in Audio: a sound from a Dropbox link goes into a new audio playlist (a local stand-in, never the internet)', async () => {
  test.setTimeout(150_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-audio-link-'));
  const tone = makeTestTone(join(work, 'Placeholder link tone.wav'), { seconds: 3, hz: 440 });
  const standIn = await dropboxStandIn(
    { toneAAAAAAAAAAA: { name: 'Placeholder link tone.wav', body: readFileSync(tone), type: 'audio/wav' } },
    {},
  );
  try {
    const { app } = await launchApp({
      DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
      DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Downloads'),
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.setViewportSize({ width: 1280, height: 720 });
    await openSection(win, 'audio');
    await win.getByTestId('music-empty').getByRole('button', { name: 'From a Link…' }).click();
    await pasteLink(win, fileLink('toneAAAAAAAAAAA', 'Placeholder link tone.wav'));
    await expect(win.getByTestId('import-report')).toHaveCount(0);
    // Downloaded and imported: in a new audio playlist, listed straight under Audio.
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => (globalThis as PageGlobals).drashti.music.view())).playlists.map((p) =>
            p.tracks.map((t) => t.name),
          ),
        { timeout: 60_000 },
      )
      .toEqual([[expect.stringMatching(/^Placeholder link tone/u)]]);
    await expect(win.getByTestId('audio-group').getByTestId('music-playlist')).toHaveCount(1);
    expect(standIn.requests.every((r) => r.host.includes('dropbox'))).toBe(true);
    await app.close();
  } finally {
    await standIn.close();
  }
});
