import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import { dropboxStandIn, fileLink } from './dropbox-stand-in';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
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
 * alone, its words and key in its tooltip; lit, its words and key as before, at once, nothing moving with it. No
 * button along the bar moves, by so much as a pixel (clearroom): each clear keeps its place, Clear all and Put it back
 * share one, and the Wallpaper and Black-out keep the room their words take while on.
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

/** The bar's widths the clears are held to: Windows' smallest operator window, CI's, and 1280 × 720. */
const SIZES = [
  [1008, 645],
  [1024, 645],
  [1280, 720],
] as const;

/** Each layer's clear by its name, with its key. */
const CLEARS = [
  ['Clear slide', 'F2'],
  ['Clear background', 'F3'],
  ['Clear audio', 'F5'],
  ['Clear messages', 'F6'],
  ['Clear ticker', 'F7'],
] as const;

/** An announcement from a phone, on this computer's own network, approved into the ticker (as function-keys.spec's). */
async function tickerUp(win: Page, text: string): Promise<void> {
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'announcements', 'Placeholder poster');
  const sent = await apiCall(port, '/api/v1/announcements', {
    method: 'POST',
    token,
    body: { text, from: 'Placeholder poster', minutes: 10 },
  });
  expect(sent.status).toBe(202);
  const id = (sent.json['announcement'] as { id: string }).id;
  const approved = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.announcements.approve({ id, as: 'ticker' }),
    id,
  );
  expect(approved.ok).toBe(true);
}

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The bar's buttons, each as its words and keys read in one line. */
const barButtons = (bar: Locator) => bar.locator('button:visible:not([aria-label^="What is this?"])');
const barWords = (bar: Locator) =>
  barButtons(bar).evaluateAll((b) => b.map((x) => (x as HTMLElement).innerText.replace(/\s+/gu, ' ').trim()));

interface BarWatch {
  barWatch?: { found: string[]; stop: () => void };
}

/**
 * From now until barStarted: everything that starts moving on a clear or beside one (anywhere in the bar of clears),
 * however short: a Web Animation asked of anything in it, or a CSS transition or animation starting there. A clear
 * changes at once, in the same frame as the screens, and nothing moves with it (a show control's state, Session 25).
 */
async function watchBar(win: Page): Promise<void> {
  await win.evaluate(() => {
    const BARS = '[data-testid="layer-bar"], [data-testid="simple-buttons"]';
    const found: string[] = [];
    const name = (el: Element) =>
      el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName.toLowerCase();
    const proto = Element.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called on each element below, with call()
    const animate = proto.animate;
    proto.animate = function (this: Element, frames, options) {
      if (this.closest(BARS)) found.push(`${name(this)}: a Web Animation`);
      return animate.call(this, frames, options);
    };
    const starts = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(BARS)) found.push(`${name(e.target)}: ${e.type}`);
    };
    document.addEventListener('transitionrun', starts, true);
    document.addEventListener('animationstart', starts, true);
    (globalThis as BarWatch).barWatch = {
      found,
      stop: () => {
        proto.animate = animate;
        document.removeEventListener('transitionrun', starts, true);
        document.removeEventListener('animationstart', starts, true);
      },
    };
  });
}

/** What started on or beside a clear since watchBar, two frames after the change was seen; the watch ends. */
const barStarted = (win: Page) =>
  win.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const watch = (globalThis as BarWatch).barWatch;
            watch?.stop();
            resolve(watch?.found ?? []);
          });
        });
      }),
  );

/** Where one of the bar's buttons is along it: its place's edges (a layer's clear's room) and its own middle. */
interface Place {
  name: string;
  left: number;
  right: number;
  middle: number;
}

/**
 * Where each of the bar's buttons is along it, every one (the ? too), left to right: the edges of its place (a layer's
 * clear's room, which its lit look fills and its icon sits in the middle of; any other button's own box) and the
 * middle of the button itself, as laid out (not rounded).
 */
const barPlaces = (bar: Locator) =>
  bar.locator('button:visible').evaluateAll((b) =>
    b.map((x): Place => {
      const place = (x.closest('[data-clear-room]') ?? x).getBoundingClientRect();
      const r = x.getBoundingClientRect();
      const name =
        x.getAttribute('data-testid') ?? x.getAttribute('aria-label') ?? (x as HTMLElement).innerText;
      return { name: name.trim(), left: place.left, right: place.right, middle: r.left + r.width / 2 };
    }),
  );

/** Layout's own rounding (a 64th of a pixel, as a compact clear is centred in its room): under it is 0 px. */
const HAIR = 0.05;

/** The bar's places at each of SIZES (the window left at the last of them). */
async function placesAtEachSize(win: Page, bar: Locator): Promise<Map<number, Place[]>> {
  const places = new Map<number, Place[]>();
  for (const [width, height] of SIZES) {
    await win.setViewportSize({ width, height });
    places.set(width, await barPlaces(bar));
  }
  return places;
}

/**
 * No button along the bar moved since `before` (taken with nothing up), at any of SIZES: 0 px, the edges of every
 * button's place and its middle (alpha.24, clearroom: Clear all's bolder words once it can be pressed and Put it back
 * in its place had moved every button after it 2-8 px; Black-out or the Wallpaper on, its words longer, moved what is
 * left of it). Each state's verdict is soft, so one run names every state and button that moves; the window is left
 * at the last size.
 */
async function stayPut(win: Page, bar: Locator, before: Map<number, Place[]>, where: string): Promise<void> {
  const off = (a: number, b: number | undefined) => Math.round((a - (b ?? Number.NaN)) * 100) / 100;
  for (const [width, height] of SIZES) {
    await win.setViewportSize({ width, height });
    const now = await barPlaces(bar);
    const was = before.get(width) ?? [];
    const at = `${where}, at ${String(width)} × ${String(height)}`;
    expect.soft(now.length, `${at}: as many buttons along the bar`).toBe(was.length);
    const moved = now.flatMap((p, i) => {
      const b = was[i];
      const by = (['left', 'right', 'middle'] as const).map((k) => off(p[k], b?.[k]));
      if (by.every((x) => Math.abs(x) <= HAIR)) return [];
      const span = `${p.left.toFixed(2)} to ${p.right.toFixed(2)}`;
      return [`${p.name} (was ${b?.name ?? 'none'}): left, right, middle by ${by.join(', ')}, now ${span}`];
    });
    expect.soft(moved, `${at}: no button along the bar moved`).toEqual([]);
  }
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

test('the bar of clears: one row at 1024 × 645 and 1280 × 720, smaller; its buttons with their keys; F4 and F8 do nothing; a button with nothing up dimmed, a clear compact, its words in its tooltip; every layer up, all eight words and keys whole in one row from 1008 px; no button along the bar moves, from nothing up, the first thing up and the last off, F1 and Put it back, the Wallpaper or Black-out on', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(NETWORK_ENV);
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
  // Each button names its keys for a screen reader too (aria-keyshortcuts), as they act now: Black-out B and its "."
  // while the single-letter keys are on (as they are to begin with).
  const KEYS = [['Clear all', 'F1'], ...CLEARS, ['Wallpaper', 'F12'], ['Black-out', 'B .']] as const;
  for (const [words, key] of KEYS)
    await expect(button(words), words).toHaveAttribute('aria-keyshortcuts', key);
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

  // A slide up: its clear lights up and Clear all can be pressed; the rest stay dimmed. It lights up at once and
  // nothing starts moving on it or beside it (the window opened settled first: what arrives later moves).
  await setUpScreen(win);
  const audience = await outputPage(app);
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  // Where each button is with nothing up, at each size: no button along the bar moves from here on, whatever goes up
  // or comes off, Clear all and Put it back taking turns, the Wallpaper or Black-out on (alpha.24, clearroom).
  const atRest = await placesAtEachSize(win, bar);
  await watchBar(win);
  await win.getByTestId('slide-thumb').first().click();
  await expect(button('Clear slide')).toHaveAttribute('data-lit', 'true');
  expect(await barStarted(win), 'a slide up: nothing moves on or beside its clear').toEqual([]);
  await expect(button('Clear all')).toBeEnabled();
  await expect(button('Clear background')).toBeDisabled();
  // Lit, its words and key back on it.
  await expect.poll(() => barWords(bar)).toEqual(['Clear all F1', 'Slide F2', ...AT_REST.slice(2)]);
  // The first thing up: Clear all can be pressed now (its words bolder), and no button moved.
  await stayPut(win, bar, atRest, 'the first thing up (a slide)');
  // The last thing off (the slide, by its clear): Clear all dimmed again, and no button moved; then the slide up again.
  await button('Clear slide').click();
  await expect(button('Clear all')).toBeDisabled();
  await expect.poll(() => barWords(bar)).toEqual(AT_REST);
  await stayPut(win, bar, atRest, 'the last thing off (the slide)');
  await win.getByTestId('slide-thumb').first().click();
  await expect(button('Clear slide')).toHaveAttribute('data-lit', 'true');

  // F4 and F8 do nothing; F12 puts the wallpaper up over the slide (black: no wallpaper chosen yet), and off.
  const before = await state(win);
  await win.keyboard.press('F4');
  await win.keyboard.press('F8');
  expect((await state(win)).layers).toEqual(before.layers);
  await win.keyboard.press('F12');
  await expect(audience.locator('[data-layer="wallpaper"]')).toBeVisible();
  await expect(button('Wallpaper is on')).toHaveAttribute('data-lit', 'true');
  await expect(button('Wallpaper is on')).not.toHaveAttribute('data-dimmed');
  // On, in its words ("Wallpaper is on"): no button moved, the ? beside it neither.
  await stayPut(win, bar, atRest, 'the Wallpaper on');
  // The slide stays up underneath, as under the Logo.
  expect((await state(win)).layers.slide?.presentationId).toBe(before.layers.slide?.presentationId);
  await button('Wallpaper is on').click();
  await expect(audience.locator('[data-layer="wallpaper"]')).toHaveCount(0);
  await expect(button('Wallpaper')).toHaveAttribute('data-dimmed', 'true');

  // Every layer up too (the steps function-keys.spec takes): a background, a message, a sound going round and the
  // ticker. Every clear lit with its words and key, all eight whole in one row from 1008 px, and no button moves.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-bottom-bar-'));
  const [soundId = ''] = await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder tone.wav'), { seconds: 20, hz: 330 }),
  ]);
  expect(soundId).not.toBe('');
  for (const command of [
    { type: 'setBackground', background: { kind: 'color', color: '#1d4e89' } },
    { type: 'showMessage', message: { id: 'placeholder-message', text: 'Placeholder message' } },
    {
      type: 'playAudio',
      audio: { id: 'placeholder-tone', title: 'Placeholder tone', mediaId: soundId, volume: 1, loop: true },
    },
  ])
    await win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);
  await tickerUp(win, 'Placeholder announcement');
  for (const [width, height] of SIZES) {
    await win.setViewportSize({ width, height });
    await expect.poll(() => barWords(bar), { message: `${width} × ${height}, every layer up` }).toEqual(BAR);
    await oneRow(win, `${width} × ${height}, every layer up`);
  }
  await stayPut(win, bar, atRest, 'every layer up');
  // Lit, each still names its keys for a screen reader.
  for (const [words, key] of KEYS)
    await expect(button(words), words).toHaveAttribute('aria-keyshortcuts', key);
  // Black-out on over them all, in its words ("Black-out is on"): no button moved, the Wallpaper beside it neither;
  // then off again.
  await button('Black-out').click();
  await expect(button('Black-out is on')).toHaveAttribute('data-lit', 'true');
  await stayPut(win, bar, atRest, 'every layer up, Black-out on');
  await button('Black-out is on').click();
  await expect(button('Black-out')).toHaveAttribute('data-dimmed', 'true');
  // The slide taken off again: its clear back to its icon at once, nothing moving on it or beside it, and still no
  // button moves.
  await watchBar(win);
  await button('Clear slide').click();
  await expect(button('Clear slide')).toHaveAttribute('data-dimmed', 'true');
  expect(await barStarted(win), 'the slide off: nothing moves on or beside its clear').toEqual([]);
  await expect.poll(() => barWords(bar)).toEqual(['Clear all F1', '', ...BAR.slice(2)]);
  await stayPut(win, bar, atRest, 'the slide taken off, every other layer up');
  // F1: everything off, Put it back in Clear all's place, and no button moved; Put it back: all of it back, Clear all
  // in its place again, and still no button moved.
  await win.keyboard.press('F1');
  await expect(win.getByTestId('put-back')).toBeVisible();
  await expect.poll(() => barWords(bar)).toEqual(['Put it back', ...AT_REST.slice(1)]);
  await stayPut(win, bar, atRest, 'Clear all (F1), Put it back offered');
  await win.getByTestId('put-back').click();
  await expect(win.getByTestId('put-back')).toHaveCount(0);
  await expect(button('Clear all')).toBeEnabled();
  await stayPut(win, bar, atRest, 'Put it back pressed, Clear all back');
  await app.close();
});

test('Simple Mode’s buttons too: its Clear all dimmed with nothing up; the Wallpaper in the Logo’s place, F12 or the button putting the wallpaper up and taking it off; none of its buttons moves', async () => {
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
  // Each of its buttons names its keys for a screen reader, as Pro Mode's do (aria-keyshortcuts).
  for (const [id, key] of [
    ['simple-clear-all', 'F1'],
    ['simple-clear-slide', 'F2'],
    ['simple-clear-background', 'F3'],
    ['simple-clear-audio', 'F5'],
    ['simple-wallpaper', 'F12'],
    ['simple-blackout', 'B .'],
  ] as const)
    await expect(win.getByTestId(id), id).toHaveAttribute('aria-keyshortcuts', key);
  // Its Clear all dimmed with nothing up, as the bar of clears' is, and pressable once something is.
  const clearAll = win.getByTestId('simple-clear-all');
  await expect(clearAll).toBeDisabled();
  await expect(clearAll).toHaveAttribute('data-dimmed', 'true');
  // Where each of its buttons is with nothing up, at each size: none moves from here on, as along Pro Mode's bar
  // (alpha.24, clearroom).
  const bar = win.getByTestId('simple-buttons');
  const atRest = await placesAtEachSize(win, bar);
  const [first] = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations());
  const goLive = { type: 'goLive', presentationId: first?.id ?? '', slideIndex: 0 } as const;
  const slideUp = () => win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), goLive);
  await slideUp();
  await expect(clearAll).toBeEnabled();
  await expect(clearAll).not.toHaveAttribute('data-dimmed');
  await expect(win.getByTestId('simple-clear-slide')).toHaveAttribute('data-lit', 'true');
  await stayPut(win, bar, atRest, 'Simple Mode, the first thing up (a slide)');
  // The last thing off (the slide, by its clear), then the slide up again.
  await win.getByTestId('simple-clear-slide').click();
  await expect(clearAll).toHaveAttribute('data-dimmed', 'true');
  await expect(win.getByTestId('simple-clear-slide')).toHaveAttribute('data-dimmed', 'true');
  await stayPut(win, bar, atRest, 'Simple Mode, the last thing off (the slide)');
  await slideUp();
  await expect(clearAll).not.toHaveAttribute('data-dimmed');
  const wallpaper = win.getByTestId('simple-wallpaper');
  await expect(wallpaper).toBeVisible();
  await expect(win.getByTestId('simple-logo')).toHaveCount(0);
  await win.keyboard.press('F12');
  await expect(audience.locator('[data-layer="wallpaper"]')).toBeVisible();
  await expect(wallpaper).toHaveText(/Wallpaper is on/u);
  await stayPut(win, bar, atRest, 'Simple Mode, the Wallpaper on');
  await wallpaper.click();
  await expect(audience.locator('[data-layer="wallpaper"]')).toHaveCount(0);
  await expect(wallpaper).not.toHaveText(/is on/u);
  // Black-out on, then off; F1 with Put it back offered in Clear all's place; Put it back pressed: no button moved.
  const blackout = win.getByTestId('simple-blackout');
  await blackout.click();
  await expect(blackout).toHaveText(/Black-out is on/u);
  await stayPut(win, bar, atRest, 'Simple Mode, Black-out on');
  await blackout.click();
  await expect(blackout).not.toHaveText(/is on/u);
  await win.keyboard.press('F1');
  await expect(win.getByTestId('simple-put-back')).toBeVisible();
  await expect(clearAll).toHaveCount(0);
  await stayPut(win, bar, atRest, 'Simple Mode, Clear all (F1), Put it back offered');
  await win.getByTestId('simple-put-back').click();
  await expect(win.getByTestId('simple-put-back')).toHaveCount(0);
  await expect(clearAll).toBeEnabled();
  await stayPut(win, bar, atRest, 'Simple Mode, Put it back pressed, Clear all back');
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
