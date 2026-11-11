import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { swings } from '../../src/shared/flash';
import { OPENING_DEFAULT_PHOTO_URL, OPENING_MS, OPENING_SOUND_VOLUME } from '../../src/shared/opening';
import { RECOVERY_MAX_AGE_MS } from '../../src/shared/recovery';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  importAndGetIds,
  killApp,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { PLACEHOLDER_OPENING_PHOTO } from './opening-photo';
import { lightOf } from './pixels';
import { drawPicture, engineState, goLive, halves, makeSlides, plain } from './placeholder-slides';
import { makeTestTone } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The opening (Session 55; alpha.16, the owner's words of 11 Nov 2026): two seconds as Drashti starts, one photo and
 * no words, over the operator window only, while Drashti finishes starting underneath; the photo comes in smoothly
 * and the whole goes smoothly into the window; the opening pack's own sound, if it has one, plays gently with the
 * mandir's photo and stops as the two seconds end, in the operator window only; never a sound with Drashti's default
 * photo. Any key, click or tap ends it at once and reaches nothing beneath (Space never puts up the next slide); never
 * after an unexpected stop, at a new version's first start, when the window is loaded again, or with a library's first
 * welcome; in Simple Mode too; still with reduced motion or Interface motion Off; never more than three swings of light
 * a second; and File › Opening…, with its preview and Load the opening pack…. With nothing chosen, Drashti's default
 * photo alone (the owner's decision of 5 Nov 2026), the lamp should its file be missing. A test sees it only when it
 * asks (DRASHTI_TEST_OPENING=1). Generated pictures, generated tones and placeholder words only: the mandir's own pack
 * never comes near a test, and nor does Drashti's default photo (every Drashti a test starts shows a placeholder made
 * as the run starts instead: tests/e2e/opening-photo.ts).
 */

const ASK = { DRASHTI_TEST_OPENING: '1' } as const;
/** The whole opening: two seconds. */
const TWO_SECONDS = OPENING_MS;
/** The most its sound plays at. */
const GENTLY = OPENING_SOUND_VOLUME;
/** makeTestTone's placeholder tone at full gain, as the meter reads it (dBFS): about -24. */
const TONE_DB = 20 * Math.log10(3000 / 32768 / Math.SQRT2);
/** That tone played gently (about -36 dBFS). */
const GENTLE_DB = TONE_DB + 20 * Math.log10(GENTLY);

/** The data folder's log lines that start "Opening:" (never its photo's or its sound's name: checked here too). */
function openingLog(userData: string): string[] {
  const file = join(userData, 'logs', 'drashti.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.includes('Opening: '))
    .map((l) => l.slice(l.indexOf('Opening: ')));
}

/** Pictures drawn in the page and imported: their media ids. */
async function pictures(
  win: Page,
  colours: string[][],
  size = { width: 640, height: 360 },
): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-opening-pictures-'));
  const files: string[] = [];
  for (const [i, [left = '0,0,0', right = left]] of colours.entries())
    files.push(
      await drawPicture(win, join(dir, `placeholder-${String(i + 1)}.png`), halves(left, right), size),
    );
  return importAndGetIds(win, files);
}

/** The opening's photo, from Media (null: Drashti's default photo). */
async function choose(win: Page, photo: string | null): Promise<void> {
  const result = await win.evaluate(
    (choice) => (globalThis as PageGlobals).drashti.opening.setChoice(choice),
    { photo },
  );
  expect(result.ok).toBe(true);
}

/**
 * A library started once and quit on purpose (so the next start is a person's start of the same version), set up by
 * `prepare` meanwhile; its data folder.
 */
async function startedOnce(
  prepare: (win: Page, app: ElectronApplication) => Promise<void> = () => Promise.resolve(),
  env: Record<string, string> = {},
  access: Parameters<typeof launchApp>[2] = {},
): Promise<string> {
  const { app, userData } = await launchApp(env, undefined, access);
  const win = await operatorPage(app);
  await operatorReady(win);
  await prepare(win, app);
  await app.close();
  return userData;
}

const opening = (win: Page) => win.getByTestId('opening-start');

/** Its parts that would be words, a name, the light or the sparkles (none now). */
const WORDS_AND_SPARKLES =
  '[data-opening-line], [data-opening-word], [data-opening-sweep], [data-opening-sparkle]';

/**
 * How many of these the opening (or its preview) holds now, asked once of it while it is there: never true of one
 * already gone (a check that waited could pass once it had ended).
 */
const countIn = (player: Locator, selector: string) =>
  player.evaluate((root, within) => root.querySelectorAll(within).length, selector);

/**
 * Hold the opening where it is (every part paused as soon as they have started), so a test can act while it plays:
 * the two seconds are over sooner than a slow computer readies the window under it.
 */
async function holdOpening(win: Page): Promise<void> {
  const player = win.getByTestId('opening');
  await expect
    .poll(
      () =>
        player.evaluate((root) => {
          const all = root.getAnimations({ subtree: true });
          for (const a of all) a.pause();
          return all.length;
        }),
      { intervals: [50], timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}

/** When each part of the opening ends (ms from its start). */
const endTimes = (win: Page) =>
  win
    .getByTestId('opening')
    .evaluate((root) =>
      root.getAnimations({ subtree: true }).map((a) => Number(a.effect?.getComputedTiming().endTime ?? 0)),
    );

test('plays as Drashti starts, over the operator window only, once the hall’s screens have drawn, Drashti starting underneath; one photo, no words; it ends by itself after two seconds', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce(async (win) => {
    const [photo = ''] = await pictures(win, [['235,235,215', '40,60,110']]);
    await choose(win, photo);
    await setUpScreen(win);
  });
  // The screens draw at once (no warm-up, a test switch), so it moves as soon as they have.
  const { app } = await relaunchApp(userData, { ...ASK, DRASHTI_TEST_SKIP_WARM_UP: '1' });
  const win = await operatorPage(app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  const player = win.getByTestId('opening');
  await expect(player).toHaveAttribute('data-opening-motion', 'full');
  await expect(player).toHaveAttribute('data-photos', '1');
  await expect(player.locator('img[data-opening-photo="0"]')).toHaveAttribute(
    'src',
    /^drashti-media:\/\/(opening|media)\//u,
  );
  // No words, no light passing, no sparkles.
  expect(await countIn(player, WORDS_AND_SPARKLES)).toBe(0);
  // Two seconds, every part: the whole has gone into the window by then.
  await expect.poll(async () => Math.max(0, ...(await endTimes(win)))).toBe(TWO_SECONDS);
  // Underneath, the window has started: its controls are there and listening.
  await operatorReady(win);
  // Never on a hall screen.
  const output = await outputPage(app);
  await expect(output.locator('#root')).toBeAttached();
  await expect(output.getByTestId('opening')).toHaveCount(0);
  await expect(output.getByTestId('opening-start')).toHaveCount(0);
  // Gone by itself once its two seconds are.
  await expect(opening(win)).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => openingLog(userData).join(' | ')).toContain('Opening: ended by itself after');
  const log = openingLog(userData);
  // The first start (a test not asking) said why it did not play; this one, that it did.
  expect(log).toContain('Opening: not played (in a test that does not ask for it)');
  expect(log).toContain('Opening: plays (its photo)');
  // Two seconds from when it was asked for, and the time it waited for its photo: never the five it was.
  const after = Number(/after (\d+) ms/u.exec(log.at(-1) ?? '')?.[1]);
  expect(after).toBeGreaterThanOrEqual(TWO_SECONDS);
  expect(after).toBeLessThan(5000);
  expect(log.join(' ')).not.toContain('placeholder');
  await app.close();
});

test('with nothing chosen, the default photo: the photo alone, coming in and slowly zooming for two seconds, no words, name, lamp, light or sparkles; File › Opening… previews it', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce();
  const { app } = await relaunchApp(userData, ASK);
  const win = await operatorPage(app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  const player = win.getByTestId('opening');
  await expect(player).toHaveAttribute('data-opening-motion', 'full');
  await expect(player).toHaveAttribute('data-photos', '1');
  const photo = player.locator('img[data-opening-photo="0"]');
  await expect(photo).toHaveAttribute('src', OPENING_DEFAULT_PHOTO_URL);
  await holdOpening(win);
  // The tests' own placeholder, never Drashti's photo.
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
    .toEqual([PLACEHOLDER_OPENING_PHOTO.width, PLACEHOLDER_OPENING_PHOTO.height]);
  expect(await countIn(player, `[data-opening-lamp], ${WORDS_AND_SPARKLES}`)).toBe(0);
  // It comes in and slowly zooms (its own fade and zoom), and the whole fades at its end: nothing else moves.
  expect(await player.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(3);
  const moves = await photo.evaluate((img) =>
    img
      .getAnimations()
      .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
      .flatMap((k) => Object.keys(k))
      .filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)),
  );
  expect([...new Set(moves)].sort()).toEqual(['opacity', 'transform']);
  // Its zoom starts at 1.08 and settles at 1, so it ends on the whole photo (the owner, 5 Nov 2026), in two seconds.
  const scales = await photo.evaluate((img) =>
    img
      .getAnimations()
      .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
      .map((k) => k['transform'])
      .filter((value): value is string => typeof value === 'string'),
  );
  expect(scales).toEqual(['scale(1.08)', 'scale(1)']);
  expect(Math.max(...(await endTimes(win)))).toBe(TWO_SECONDS);
  // No sound with the default photo.
  await expect(win.locator('audio[data-opening-sound]')).toHaveCount(0);
  await win.keyboard.press('Escape');
  await expect(opening(win)).toHaveCount(0);
  await expect.poll(() => openingLog(userData)).toContain('Opening: plays (the default photo)');
  // File › Opening… with nothing chosen: its preview is the default photo, and it plays it alone.
  await operatorReady(win);
  await chooseMenuItem(app, 'opening');
  const dialog = win.getByTestId('opening-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(`img[src="${OPENING_DEFAULT_PHOTO_URL}"]`)).toBeVisible();
  await dialog.getByTestId('opening-play').click();
  const preview = dialog.getByTestId('opening-preview');
  await expect(preview).toHaveAttribute('data-photos', '1');
  await expect(preview.locator('img[data-opening-photo]')).toHaveAttribute('src', OPENING_DEFAULT_PHOTO_URL);
  expect(await countIn(preview, `[data-opening-lamp], ${WORDS_AND_SPARKLES}`)).toBe(0);
  await app.close();
});

test('with Interface motion Off, the default photo is still: it comes in and goes with a plain fade, nothing moving', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce(async (win) => {
    const off = await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.setMotion('off'));
    expect(off.ok).toBe(true);
  });
  const { app } = await relaunchApp(userData, ASK);
  const win = await operatorPage(app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  const player = win.getByTestId('opening');
  await expect(player).toHaveAttribute('data-opening-motion', 'still');
  await expect(player).toHaveAttribute('data-photos', '1');
  const photo = player.locator('img[data-opening-photo="0"]');
  await expect(photo).toHaveAttribute('src', OPENING_DEFAULT_PHOTO_URL);
  await holdOpening(win);
  expect(await countIn(player, `[data-opening-lamp], ${WORDS_AND_SPARKLES}`)).toBe(0);
  // The photo's plain fade in, and the whole's plain fade out: opacity only, the photo never moving.
  const changed = await player.evaluate((root) =>
    root
      .getAnimations({ subtree: true })
      .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
      .flatMap((k) => Object.keys(k))
      .filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)),
  );
  expect([...new Set(changed)]).toEqual(['opacity']);
  expect(await photo.evaluate((img) => img.getAnimations().length)).toBe(1);
  expect(await player.evaluate((root) => root.getAnimations().length)).toBe(1);
  expect(Math.max(...(await endTimes(win)))).toBe(TWO_SECONDS);
  await win.keyboard.press('Space');
  await expect(opening(win)).toHaveCount(0);
  await app.close();
});

test('the default photo’s file missing: the lamp lights alone, with no words, and the log says why', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce();
  const { app } = await relaunchApp(userData, {
    ...ASK,
    DRASHTI_TEST_OPENING_PHOTO: join(userData, 'no-such-photo.png'),
  });
  const win = await operatorPage(app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  const player = win.getByTestId('opening');
  await holdOpening(win);
  await expect(player).toHaveAttribute('data-photos', '0');
  await expect(player.locator('[data-opening-lamp]')).toHaveCount(1);
  expect(await countIn(player, WORDS_AND_SPARKLES)).toBe(0);
  expect(await player.evaluate((root) => root.textContent)).toBe('');
  await expect
    .poll(() => openingLog(userData))
    .toContain('Opening: plays (the lamp; the default photo’s file is missing)');
  await win.keyboard.press('Escape');
  await expect(opening(win)).toHaveCount(0);
  await app.close();
});

test('while the hall’s screens are still getting ready it never moves: it waits for them, at most two seconds, then plays still', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce(async (win) => {
    const [photo = ''] = await pictures(win, [['235,235,215', '40,60,110']]);
    await choose(win, photo);
    await setUpScreen(win);
  });
  // The screens' warm-up kept drawn (a test switch): they never draw their first frame here.
  const { app } = await relaunchApp(userData, { ...ASK, DRASHTI_TEST_HOLD_WARM_UP: '1' });
  const win = await operatorPage(app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  const player = win.getByTestId('opening');
  await expect(player).toHaveAttribute('data-opening-motion', 'still', { timeout: 10_000 });
  await expect(player).toHaveAttribute('data-opening-held', 'false');
  await expect(player.locator('[data-opening-photo]')).toHaveCount(1);
  expect(await countIn(player, WORDS_AND_SPARKLES)).toBe(0);
  // Never on a hall screen.
  const output = await outputPage(app);
  await expect(output.locator('#root')).toBeAttached();
  await expect(output.getByTestId('opening')).toHaveCount(0);
  await expect(output.getByTestId('opening-start')).toHaveCount(0);
  await expect(opening(win)).toHaveCount(0, { timeout: 15_000 });
  await app.close();
});

test('any key ends it at once, and the show never hears that key: Space changes nothing on the screens, the next Space does', async () => {
  test.setTimeout(120_000);
  let id = '';
  const userData = await startedOnce(async (win) => {
    id = await makeSlides(
      win,
      'Placeholder opening keys',
      [{ words: 'Placeholder one' }, { words: 'Placeholder two' }],
      {
        kind: 'cut',
        durationMs: 0,
      },
    );
  });
  const { app } = await relaunchApp(userData, ASK);
  const win = await operatorPage(app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  await holdOpening(win);
  await operatorReady(win);
  // Something live underneath, so a Space the show heard would show: Next puts up its next slide, or (with no
  // playlist open) the first slide of the presentation chosen in the middle. Either way what is live changes.
  const live = async () => {
    const state = await engineState(win);
    return `${state.live.presentationId ?? '-'} · ${String(state.layers.slide?.slideIndex ?? '-')}`;
  };
  await goLive(win, id, 0);
  await expect.poll(live).toBe(`${id} · 0`);
  await expect(opening(win)).toBeVisible();
  await win.keyboard.press('Space');
  await expect(opening(win)).toHaveCount(0);
  await holdStill(
    async () => (await live()) === `${id} · 0`,
    500,
    'the Space that ended the opening never reached the show',
  );
  await win.keyboard.press('Space');
  await expect.poll(live).not.toBe(`${id} · 0`);
  await expect
    .poll(() => openingLog(userData).at(-1) ?? '')
    .toMatch(/^Opening: ended by a key after \d+ ms$/u);
  await app.close();
});

test('a click ends it at once and lands on nothing beneath; a tap ends it too', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce();
  const first = await relaunchApp(userData, ASK);
  const win = await operatorPage(first.app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  await holdOpening(win);
  await operatorReady(win);
  // Black-out's own button, under the opening: the click that ends it must not turn it on.
  const blackout = win.getByTestId('blackout-button');
  const box = await blackout.boundingBox();
  if (!box) throw new Error('no Black-out button');
  await expect(opening(win)).toBeVisible();
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(opening(win)).toHaveCount(0);
  await holdStill(
    async () => !(await engineState(win)).blackout,
    500,
    'the click that ended the opening never reached Black-out',
  );
  // The next click is the show's.
  await blackout.click();
  await expect.poll(async () => (await engineState(win)).blackout).toBe(true);
  await first.app.close();
  await expect
    .poll(() => openingLog(userData).at(-1) ?? '')
    .toMatch(/^Opening: ended by a click after \d+ ms$/u);

  // A tap (a touch screen's finger): the same.
  const second = await relaunchApp(userData, ASK);
  const again = await operatorPage(second.app);
  await expect(opening(again)).toBeVisible({ timeout: 15_000 });
  await holdOpening(again);
  const cdp = await again.context().newCDPSession(again);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const at = { x: 200, y: 200 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(opening(again)).toHaveCount(0);
  await second.app.close();
  await expect
    .poll(() => openingLog(userData).at(-1) ?? '')
    .toMatch(/^Opening: ended by a click after \d+ ms$/u);
});

test('never after an unexpected stop: the show comes back first, as before', async () => {
  test.setTimeout(120_000);
  let id = '';
  const userData = await startedOnce(async (win) => {
    id = await makeSlides(win, 'Placeholder opening recovery', [{ words: 'Placeholder back' }], {
      kind: 'cut',
      durationMs: 0,
    });
    await setUpScreen(win);
  });
  const first = await relaunchApp(userData, ASK);
  const win = await operatorPage(first.app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  await win.keyboard.press('Escape');
  await expect(opening(win)).toHaveCount(0);
  await operatorReady(win);
  await goLive(win, id, 0);
  await expect.poll(() => readFileSync(join(userData, 'live-state.json'), 'utf8')).toContain('slideIndex');
  await killApp(first.app);
  const second = await relaunchApp(userData, ASK);
  const back = await operatorPage(second.app);
  await operatorReady(back);
  const output = await outputPage(second.app);
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder back', { timeout: 30_000 });
  await expect(opening(back)).toHaveCount(0);
  expect(openingLog(userData).at(-1)).toBe('Opening: not played (after an unexpected stop)');
  await second.app.close();
});

/** The run named in the restart-recovery file, or null (as simple-mode.spec.ts reads it). */
function savedRun(userData: string): string | null {
  try {
    return (
      (JSON.parse(readFileSync(join(userData, 'live-state.json'), 'utf8')) as { session?: string }).session ??
      null
    );
  } catch {
    return null;
  }
}

test('after an unexpected stop more than three hours before, it plays again: that start is as after a quit on purpose', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce();
  const before = savedRun(userData);
  const first = await relaunchApp(userData);
  await operatorReady(await operatorPage(first.app));
  // Its own run saved, then stopped dead, as a computer switched off with Drashti open.
  await expect.poll(() => savedRun(userData)).not.toBe(before);
  await killApp(first.app);
  // ...the day before: the saved show's time moved back past the three hours (shared/recovery.ts).
  const file = join(userData, 'live-state.json');
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(
    file,
    JSON.stringify({ ...saved, savedAt: new Date(Date.now() - RECOVERY_MAX_AGE_MS - 60_000).toISOString() }),
  );
  const second = await relaunchApp(userData, ASK);
  const win = await operatorPage(second.app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  await win.keyboard.press('Escape');
  await expect(opening(win)).toHaveCount(0);
  await second.app.close();
});

test('never at a new version’s first start (an update’s), nor when the window is loaded again; then as before', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce();
  const updated = await relaunchApp(userData, { ...ASK, DRASHTI_TEST_VERSION: '1.0.0-alpha.99' });
  const win = await operatorPage(updated.app);
  await operatorReady(win);
  await expect(opening(win)).toHaveCount(0);
  expect(openingLog(userData).at(-1)).toBe('Opening: not played (at the first start of 1.0.0-alpha.99)');
  await updated.app.close();
  // The same version again: it plays; the window loaded again (as the watchdog reloads it): it does not.
  const again = await relaunchApp(userData, { ...ASK, DRASHTI_TEST_VERSION: '1.0.0-alpha.99' });
  const page = await operatorPage(again.app);
  await expect(opening(page)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Shift');
  await expect(opening(page)).toHaveCount(0);
  await again.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('index.html'))
      ?.webContents.reload();
  });
  await page.waitForLoadState('domcontentloaded');
  await operatorReady(page);
  await holdStill(
    async () => (await opening(page).count()) === 0,
    1500,
    'a window loaded again (as the watchdog reloads it) never plays the opening',
  );
  await again.app.close();
});

test('on a library’s first start the welcome comes instead, never both; once it is answered, the opening plays', async () => {
  test.setTimeout(120_000);
  // Started once without the welcome (the tests' usual start), so the version is known.
  const userData = await startedOnce();
  const WELCOME = { DRASHTI_TEST_NO_WIZARD: '0', ...ASK };
  const first = await relaunchApp(userData, WELCOME);
  const win = await operatorPage(first.app);
  await expect(win.getByTestId('welcome')).toBeVisible({ timeout: 15_000 });
  await expect(opening(win)).toHaveCount(0);
  expect(openingLog(userData).at(-1)).toBe('Opening: not played (the first start’s welcome comes instead)');
  await win.getByTestId('welcome-skip').click();
  await first.app.close();
  const second = await relaunchApp(userData, WELCOME);
  const next = await operatorPage(second.app);
  await expect(opening(next)).toBeVisible({ timeout: 15_000 });
  await expect(next.getByTestId('welcome')).toHaveCount(0);
  await second.app.close();
});

test('in Simple Mode too, ended by a key the same way', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce(() => Promise.resolve(), {}, { mode: 'simple' });
  const { app } = await relaunchApp(userData, ASK, { mode: 'simple' });
  const win = await operatorPage(app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  await holdOpening(win);
  await expect(win.getByTestId('simple-mode')).toBeAttached();
  await win.keyboard.press('Enter');
  await expect(opening(win)).toHaveCount(0);
  await expect
    .poll(() => openingLog(userData).at(-1) ?? '')
    .toMatch(/^Opening: ended by a key after \d+ ms$/u);
  await app.close();
});

test('with Interface motion Off, or the computer asking for reduced motion (as it starts or while it plays): the photo still, a plain fade, nothing moving', async () => {
  test.setTimeout(150_000);
  const userData = await startedOnce(async (win) => {
    const [photo = ''] = await pictures(win, [['200,180,140', '40,60,110']]);
    await choose(win, photo);
    const off = await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.setMotion('off'));
    expect(off.ok).toBe(true);
  });
  const still = async (app: ElectronApplication) => {
    const win = await operatorPage(app);
    await expect(opening(win)).toBeVisible({ timeout: 15_000 });
    const player = win.getByTestId('opening');
    await expect(player).toHaveAttribute('data-opening-motion', 'still');
    await holdOpening(win);
    await expect(player.locator('[data-opening-photo]')).toHaveCount(1);
    expect(await countIn(player, WORDS_AND_SPARKLES)).toBe(0);
    // What changes: only opacity (the photo's coming in, and the whole at its end); no transform anywhere.
    const changed = await player.evaluate((root) =>
      root
        .getAnimations({ subtree: true })
        .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
        .flatMap((k) => Object.keys(k))
        .filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)),
    );
    expect([...new Set(changed)]).toEqual(['opacity']);
    await win.keyboard.press('Space');
    await expect(opening(win)).toHaveCount(0);
  };
  const off = await relaunchApp(userData, ASK);
  await still(off.app);
  await off.app.close();
  // Interface motion back to Calm; the computer asking for reduced motion instead, as soon as it does (here while the
  // opening plays: a test cannot ask before the window's page runs).
  const calm = await relaunchApp(userData);
  const page = await operatorPage(calm.app);
  await operatorReady(page);
  await page.evaluate(() => (globalThis as PageGlobals).drashti.appearance.setMotion('calm'));
  await calm.app.close();
  const reduced = await relaunchApp(userData, ASK);
  const moving = await operatorPage(reduced.app);
  await expect(moving.getByTestId('opening')).toHaveAttribute('data-opening-motion', 'full', {
    timeout: 15_000,
  });
  await holdOpening(moving);
  await moving.emulateMedia({ reducedMotion: 'reduce' });
  await still(reduced.app);
  await reduced.app.close();
});

test('nothing in it swings in light more than three times a second, over the whole and each quarter, red too', async () => {
  test.setTimeout(180_000);
  // The worst case: one bright photo, in from the dark and out into the window.
  const userData = await startedOnce(async (win) => {
    const [photo = ''] = await pictures(win, [['235,235,215']]);
    await choose(win, photo);
  });
  const { app } = await relaunchApp(userData, ASK);
  const win = await operatorPage(app);
  const player = win.getByTestId('opening');
  await expect(player).toBeVisible({ timeout: 15_000 });
  // Held at once, every part (they are made together), then measured at the screens' 1280 × 720.
  await holdOpening(win);
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  // Held, then each 60th of a second from its start to its end, as the screens' frames are measured.
  const FPS = 60;
  const whole: number[] = [];
  const quads: number[][] = [[], [], [], []];
  const red: number[] = [];
  for (let i = 0; (i * 1000) / FPS <= TWO_SECONDS; i++) {
    const t = (i * 1000) / FPS;
    await player.evaluate(
      (root, at) =>
        new Promise<void>((resolve) => {
          for (const a of root.getAnimations({ subtree: true })) {
            a.pause();
            a.currentTime = at;
          }
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
      t,
    );
    const light = await lightOf(win);
    whole.push(light.mean);
    for (const k of [0, 1, 2, 3]) quads[k]?.push(light.quad[k] ?? 0);
    red.push(light.red);
  }
  const worst = {
    whole: swings(whole, FPS).worst,
    quads: quads.map((q) => swings(q, FPS).worst),
    red: swings(red, FPS, 0.1, 2).worst,
  };
  test.info().annotations.push({ type: 'swings', description: JSON.stringify(worst) });
  expect(worst.whole).toBeLessThanOrEqual(3);
  for (const q of worst.quads) expect(q).toBeLessThanOrEqual(3);
  expect(worst.red).toBeLessThanOrEqual(3);
  // It did change: the photo came in.
  expect(Math.max(...whole) - Math.min(...whole)).toBeGreaterThan(0.3);
  await app.close();
});

test('File › Opening… at 1024 × 645 and 1280 × 720: a photo from Media, a preview, its copy made, and turned off', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await pictures(win, [['235,200,120'], ['40,90,160']], { width: 1600, height: 900 });
  for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
    await sizeOperatorWindow(app, win, size);
    await chooseMenuItem(app, 'opening');
    const dialog = win.getByTestId('opening-dialog');
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yIssues(win, `File › Opening… at ${String(size.width)} × ${String(size.height)}`);
    for (const id of [
      'opening-on',
      'opening-play',
      'opening-choose-photo',
      'opening-sound',
      'opening-load-pack',
    ]) {
      await dialog.getByTestId(id).scrollIntoViewIfNeeded();
      await expect(dialog.getByTestId(id)).toBeInViewport();
    }
    // No sound loaded: it says so.
    await expect(dialog.getByTestId('opening-sound')).toContainText('No sound');
    await expect(dialog.getByTestId('opening-remove-sound')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await chooseMenuItem(app, 'opening');
  const dialog = win.getByTestId('opening-dialog');
  await dialog.getByTestId('opening-choose-photo').click();
  await win
    .getByTestId('media-picker')
    .getByRole('button', { name: /placeholder-1/u })
    .click();
  // Its copy for the opening is made, at most the window's size, and kept in the media folder.
  await expect(dialog.getByTestId('opening-photo')).toContainText('placeholder-1', { timeout: 20_000 });
  expect(readdirSync(join(userData, 'Media', 'opening')).filter((f) => f.endsWith('.jpg'))).toHaveLength(1);
  const kept = await win.evaluate(() => (globalThis as PageGlobals).drashti.opening.view());
  expect(kept).toMatchObject({ photo: { ready: true, gone: false }, sound: null });
  // Another chosen replaces it: one photo.
  await dialog.getByTestId('opening-choose-photo').click();
  await win
    .getByTestId('media-picker')
    .getByRole('button', { name: /placeholder-2/u })
    .click();
  await expect(dialog.getByTestId('opening-photo')).toContainText('placeholder-2', { timeout: 20_000 });
  // The preview plays it in the dialog, and ends by itself.
  await dialog.getByTestId('opening-play').click();
  const preview = dialog.getByTestId('opening-preview');
  await expect(preview).toHaveAttribute('data-photos', '1');
  await expect(preview.locator('img[data-opening-photo]').first()).toHaveAttribute(
    'src',
    /drashti-media:\/\/opening\//u,
  );
  await expect(preview).toHaveCount(0, { timeout: 10_000 });
  // Taken out: the default photo again.
  await dialog.getByTestId('opening-remove-photo').click();
  await expect(dialog.locator(`img[src="${OPENING_DEFAULT_PHOTO_URL}"]`)).toBeVisible();
  await expect
    .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.opening.view().then((v) => v.photo)))
    .toBeNull();
  // Turned off: the next start does not play it.
  await dialog.getByTestId('opening-on').click();
  await expect
    .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.opening.view().then((v) => v.on)))
    .toBe(false);
  await app.close();
  const again = await relaunchApp(userData, ASK);
  const page = await operatorPage(again.app);
  await operatorReady(page);
  await expect(opening(page)).toHaveCount(0);
  expect(openingLog(userData).at(-1)).toBe('Opening: not played (turned off in File › Opening…)');
  await again.app.close();
});

/** Each pack's photos a colour of their own, so no two packs' photos are the same file (an import would see one). */
let packs = 0;

/** An opening pack of its own: `photos` numbered photos, words.txt with `lines` lines if asked, and files at its top. */
async function packOf(
  win: Page,
  o: { photos: number[]; lines?: number; top?: Record<string, string | Uint8Array> },
): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'drashti-opening-pack-'));
  mkdirSync(join(root, 'photos'));
  const shade = 40 + 15 * (packs++ % 12);
  for (const n of o.photos)
    await drawPicture(
      win,
      join(root, 'photos', `${String(n)}.png`),
      plain(`${String(20 * n)},${String(shade)},120`),
    );
  if (o.lines !== undefined)
    writeFileSync(
      join(root, 'words.txt'),
      Array.from({ length: o.lines }, (_, i) => `Placeholder pack line ${String(i + 1)}`).join('\n'),
    );
  for (const [name, bytes] of Object.entries(o.top ?? {})) writeFileSync(join(root, name), bytes);
  return root;
}

/** Load the opening pack… with this folder chosen (the folder dialog answered by the test). */
async function loadPack(app: ElectronApplication, win: Page, root: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, root);
  await win.getByTestId('opening-dialog').getByTestId('opening-load-pack').click();
}

const mediaCount = async (win: Page) =>
  (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).length;

test('Load the opening pack…: its photo 1 is enough; an alpha.15 pack loads its photo 1 only; a pack without photo 1 says so, and nothing changes', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const [before = ''] = await pictures(win, [['90,90,90']]);
  await choose(win, before);
  await chooseMenuItem(app, 'opening');
  const dialog = win.getByTestId('opening-dialog');
  await expect(dialog).toBeVisible();
  // No photo 1: said, and nothing changes.
  await loadPack(app, win, await packOf(win, { photos: [2, 3], lines: 5 }));
  await expect(dialog.getByTestId('opening-problem')).toHaveText(
    'The opening pack has no photo 1 (photos/1.jpg). Nothing was changed.',
  );
  expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.opening.view())).photo?.mediaId).toBe(
    before,
  );
  // Photo 1 alone is a whole pack.
  const count = await mediaCount(win);
  await loadPack(app, win, await packOf(win, { photos: [1] }));
  await expect(dialog.getByTestId('opening-problem')).toHaveCount(0);
  await expect(dialog.getByTestId('opening-photo')).toHaveText('1.png', { timeout: 30_000 });
  expect(await mediaCount(win)).toBe(count + 1);
  // An alpha.15 pack: eight photos and five lines. Its photo 1 only comes into Media; its words are left alone.
  await loadPack(app, win, await packOf(win, { photos: [1, 2, 3, 4, 5, 6, 7, 8], lines: 5 }));
  await expect.poll(() => mediaCount(win), { timeout: 30_000 }).toBe(count + 2);
  await expect(dialog.getByTestId('opening-problem')).toHaveCount(0);
  const after = await win.evaluate(() => (globalThis as PageGlobals).drashti.opening.view());
  expect(after).toMatchObject({ photo: { name: '1.png', gone: false }, sound: null });
  await expect(dialog.getByTestId('opening-sound')).toContainText('No sound');
  expect(openingLog(userData).join(' ')).not.toContain('Placeholder');
  await app.close();
});

interface SoundNote {
  /** When (ms from the noting's start). */
  t: number;
  there: boolean;
  /** How loud its way out is (dBFS, -100 for silence), as the opening measures it. */
  level: number;
  paused: boolean;
  /** Where it is in its file (s). */
  at: number;
}

/** Note the opening's sound in the page every 25 ms from now (for 15 s); what was noted so far, from the function. */
async function noteSound(win: Page): Promise<() => Promise<SoundNote[]>> {
  await win.evaluate(() => {
    const notes: { t: number; there: boolean; level: number; paused: boolean; at: number }[] = [];
    (globalThis as unknown as { openingSoundNotes: unknown }).openingSoundNotes = notes;
    const t0 = performance.now();
    const timer = setInterval(() => {
      const el = document.querySelector<HTMLAudioElement>('audio[data-opening-sound]');
      notes.push({
        t: Math.round(performance.now() - t0),
        there: el !== null,
        level: Number(el?.dataset['level'] ?? '-100'),
        paused: el?.paused ?? true,
        at: el?.currentTime ?? 0,
      });
      if (notes.length >= 600) clearInterval(timer);
    }, 25);
  });
  return () =>
    win.evaluate(
      () => (globalThis as unknown as { openingSoundNotes?: SoundNote[] }).openingSoundNotes ?? [],
    );
}

/** It was heard, gently: never louder than the tone at OPENING_SOUND_VOLUME, and really sounding. */
function heardGently(notes: SoundNote[]): { heard: SoundNote[]; loudest: number } {
  const heard = notes.filter((n) => n.there && n.level > -90);
  expect(heard.length, 'the sound was heard').toBeGreaterThan(3);
  const loudest = Math.max(...heard.map((n) => n.level));
  expect(loudest, 'gently: the tone at the opening’s low volume').toBeLessThanOrEqual(GENTLE_DB + 2);
  expect(loudest, 'gently, but heard').toBeGreaterThanOrEqual(GENTLE_DB - 6);
  return { heard, loudest };
}

test('the pack’s sound (a generated tone, any case) plays gently with its photo in the preview and as Drashti starts, in the operator window only, and stops as the two seconds end; never with the default photo; taken out, none', async () => {
  test.setTimeout(240_000);
  const toneDir = mkdtempSync(join(tmpdir(), 'drashti-opening-tone-'));
  // Six seconds of a placeholder tone: longer than the opening, so its fading out and stopping show.
  const tone = readFileSync(makeTestTone(join(toneDir, 'tone.wav'), { seconds: 6, hz: 440, rate: 48_000 }));
  let userData = '';
  {
    // A library started once and quit on purpose, the pack loaded and previewed meanwhile.
    const { app, userData: folder } = await launchApp();
    userData = folder;
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpScreen(win);
    await chooseMenuItem(app, 'opening');
    const dialog = win.getByTestId('opening-dialog');
    await expect(dialog).toBeVisible();
    // Not a sound (a picture's bytes under a sound's name): refused in plain words, nothing changed.
    const picture = readFileSync(
      await drawPicture(win, join(toneDir, 'not-a-sound.png'), plain('200,100,50')),
    );
    await loadPack(app, win, await packOf(win, { photos: [1], top: { 'sound.mp3': picture } }));
    await expect(dialog.getByTestId('opening-problem')).toHaveText(
      'Drashti cannot play the opening pack’s sound.mp3 as it is: PNG picture. Its sound must be an MP3, an M4A (AAC) or a WAV. Nothing was changed.',
    );
    await expect(dialog.getByTestId('opening-sound')).toContainText('No sound');
    // The tone, its name in capitals.
    await loadPack(app, win, await packOf(win, { photos: [1], top: { 'SOUND.WAV': tone } }));
    await expect(dialog.getByTestId('opening-sound')).toContainText('SOUND.WAV', { timeout: 30_000 });
    await expect(dialog.getByTestId('opening-problem')).toHaveCount(0);
    await expect(dialog.getByTestId('opening-photo')).toHaveText('1.png', { timeout: 30_000 });
    const copies = readdirSync(join(userData, 'Media', 'opening'));
    expect(copies.filter((f) => f.endsWith('.wav'))).toHaveLength(1);
    // The preview: in gently with the photo, out by the end of its two seconds, and stopped there.
    const notes = await noteSound(win);
    await dialog.getByTestId('opening-play').click();
    await expect(dialog.getByTestId('opening-preview')).toHaveAttribute('data-photos', '1');
    await expect(dialog.getByTestId('opening-preview')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await notes()).filter((n) => n.there).length).toBeGreaterThan(0);
    await expect(win.locator('audio[data-opening-sound]')).toHaveCount(0);
    const noted = await notes();
    const { heard, loudest } = heardGently(noted);
    // Faded in: its first sound well under its loudest; faded out: quieter again after it, before it stops.
    expect(heard[0]?.level ?? 0).toBeLessThanOrEqual(loudest - 3);
    const loudestAt = heard.find((n) => n.level === loudest)?.t ?? 0;
    expect(heard.some((n) => n.t > loudestAt && n.level <= loudest - 6)).toBe(true);
    // About two seconds, never the six of its file.
    expect((heard.at(-1)?.t ?? 0) - (heard[0]?.t ?? 0)).toBeLessThanOrEqual(TWO_SECONDS + 300);
    expect(Math.max(...noted.filter((n) => n.there).map((n) => n.at))).toBeLessThan(2.6);
    await app.close();
  }
  expect(openingLog(userData).join(' ')).not.toMatch(/SOUND\.WAV|1\.png/u);

  // As Drashti starts: with its photo, in the operator window only.
  const first = await relaunchApp(userData, { ...ASK, DRASHTI_TEST_SKIP_WARM_UP: '1' });
  const win = await operatorPage(first.app);
  const notes = await noteSound(win);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  // The photo held where it is, so the sound's own end shows: it stops by itself at its two seconds.
  await holdOpening(win);
  await expect(win.locator('audio[data-opening-sound]')).toHaveCount(1);
  // Played (well into its file), then stopped by itself.
  await expect
    .poll(
      () =>
        win
          .locator('audio[data-opening-sound]')
          .evaluate((el: HTMLAudioElement) => el.paused && el.currentTime > 1),
      { timeout: 10_000 },
    )
    .toBe(true);
  heardGently(await notes());
  const stopped = await win
    .locator('audio[data-opening-sound]')
    .evaluate((el: HTMLAudioElement) => ({ at: el.currentTime, level: el.dataset['level'] }));
  expect(stopped.at).toBeLessThan(2.6);
  expect(stopped.level).toBe('-100');
  // Never the hall's screens or the show's own sound.
  const output = await outputPage(first.app);
  await expect(output.locator('#root')).toBeAttached();
  await expect(output.locator('audio[data-opening-sound]')).toHaveCount(0);
  expect((await engineState(win)).layers.audio).toBeNull();
  await win.keyboard.press('Escape');
  await expect(opening(win)).toHaveCount(0);
  await expect(win.locator('audio[data-opening-sound]')).toHaveCount(0);
  expect(openingLog(userData)).toContain('Opening: plays (its photo and sound)');
  // Its photo taken out: Drashti's default photo, and no sound with it.
  await operatorReady(win);
  await choose(win, null);
  await first.app.close();
  const second = await relaunchApp(userData, ASK);
  const page = await operatorPage(second.app);
  const quiet = await noteSound(page);
  await expect(opening(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('opening').locator('img[data-opening-photo="0"]')).toHaveAttribute(
    'src',
    OPENING_DEFAULT_PHOTO_URL,
  );
  await expect(opening(page)).toHaveCount(0, { timeout: 10_000 });
  expect((await quiet()).filter((n) => n.there)).toEqual([]);
  await expect.poll(() => openingLog(userData)).toContain('Opening: plays (the default photo)');
  // Taken out: no sound, and its copy gone.
  await operatorReady(page);
  await chooseMenuItem(second.app, 'opening');
  const dialog = page.getByTestId('opening-dialog');
  await expect(dialog.getByTestId('opening-sound')).toContainText('SOUND.WAV');
  await dialog.getByTestId('opening-remove-sound').click();
  await expect(dialog.getByTestId('opening-sound')).toContainText('No sound');
  expect(readdirSync(join(userData, 'Media', 'opening')).filter((f) => f.endsWith('.wav'))).toEqual([]);
  await expect.poll(() => openingLog(userData).at(-1)).toBe('Opening: its sound was taken out');
  await second.app.close();
});
