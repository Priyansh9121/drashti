import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { swings } from '../../src/shared/flash';
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
import { lightOf } from './pixels';
import { drawPicture, engineState, goLive, halves, makeSlides, plain } from './placeholder-slides';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The opening (Session 55, the owner's brief of 3 Nov 2026): five seconds as Drashti starts, over the operator window
 * only, while Drashti finishes starting underneath; any key, click or tap ends it at once and reaches nothing beneath
 * (Space never puts up the next slide); never after an unexpected stop, at a new version's first start, when the
 * window is loaded again, or with a library's first welcome; in Simple Mode too; still with reduced motion or
 * Interface motion Off; never more than three swings of light a second; and File › Opening…, with its preview and
 * Load the opening pack…. A test sees it only when it asks (DRASHTI_TEST_OPENING=1). Generated pictures and
 * placeholder words only: the mandir's own pack never comes near a test.
 */

const ASK = { DRASHTI_TEST_OPENING: '1' } as const;
const LINES = ['Placeholder line one', 'Placeholder line two'];

/** The data folder's log lines that start "Opening:" (never its words: checked here too). */
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

async function choose(win: Page, photos: string[], lines: string[]): Promise<void> {
  const result = await win.evaluate(
    (choice) => (globalThis as PageGlobals).drashti.opening.setChoice(choice),
    { photos, lines },
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

test('plays as Drashti starts, over the operator window only, Drashti starting underneath; it ends by itself after five seconds', async () => {
  test.setTimeout(120_000);
  const userData = await startedOnce(async (win) => {
    await choose(win, await pictures(win, [['235,235,215'], ['40,60,110']]), LINES);
    await setUpScreen(win);
  });
  const { app } = await relaunchApp(userData, ASK);
  const win = await operatorPage(app);
  await expect(opening(win)).toBeVisible({ timeout: 15_000 });
  const shownAt = Date.now();
  const player = win.getByTestId('opening');
  await expect(player).toHaveAttribute('data-opening-motion', 'full');
  await expect(player).toHaveAttribute('data-photos', '2');
  await expect(player).toHaveAttribute('data-lines', '2');
  // The words as words, each its own (the studio's word by word).
  await expect(player.locator('[data-opening-line="0"] [data-opening-word]')).toHaveCount(3);
  // Underneath, the window has started: its controls are there and listening.
  await operatorReady(win);
  // Never on a hall screen.
  const output = await outputPage(app);
  await expect(output.locator('#root')).toBeAttached();
  await expect(output.getByTestId('opening')).toHaveCount(0);
  await expect(output.getByTestId('opening-start')).toHaveCount(0);
  // Not over before its time, and gone once its five seconds are.
  await expect.poll(() => Date.now() - shownAt, { timeout: 10_000 }).toBeGreaterThan(3000);
  await expect(opening(win)).toBeVisible();
  await expect(opening(win)).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => openingLog(userData).join(' | ')).toContain('Opening: ended by itself after');
  const log = openingLog(userData);
  // The first start (a test not asking) said why it did not play; this one, that it did.
  expect(log).toContain('Opening: not played (in a test that does not ask for it)');
  expect(log).toContain('Opening: plays (2 photos, 2 lines)');
  const after = Number(/after (\d+) ms/u.exec(log.at(-1) ?? '')?.[1]);
  expect(after).toBeGreaterThanOrEqual(5000);
  expect(log.join(' ')).not.toContain('Placeholder');
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
  await operatorReady(win);
  // Something live underneath, so a Space the show heard would show: Next puts up its next slide, or (with no
  // playlist open) the first slide of the presentation chosen in the middle. Either way what is live changes.
  const live = async () => {
    const state = await engineState(win);
    return `${state.live.presentationId ?? '-'} · ${String(state.layers.slide?.slideIndex ?? '-')}`;
  };
  await goLive(win, id, 0);
  await expect.poll(live).toBe(`${id} · 0`);
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
  await operatorReady(win);
  // Black-out's own button, under the opening: the click that ends it must not turn it on.
  const blackout = win.getByTestId('blackout-button');
  const box = await blackout.boundingBox();
  if (!box) throw new Error('no Black-out button');
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
  const cdp = await again.context().newCDPSession(again);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const at = { x: 200, y: 200 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(opening(again)).toHaveCount(0);
  await second.app.close();
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
  await expect(win.getByTestId('simple-mode')).toBeAttached();
  await win.keyboard.press('Enter');
  await expect(opening(win)).toHaveCount(0);
  await app.close();
});

test('with Interface motion Off, or the computer asking for reduced motion (as it starts or while it plays): one still photo, its lines fading in, nothing moving', async () => {
  test.setTimeout(150_000);
  const userData = await startedOnce(async (win) => {
    await choose(win, await pictures(win, [['200,180,140'], ['40,60,110']]), LINES);
    const off = await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.setMotion('off'));
    expect(off.ok).toBe(true);
  });
  const still = async (app: ElectronApplication) => {
    const win = await operatorPage(app);
    await expect(opening(win)).toBeVisible({ timeout: 15_000 });
    const player = win.getByTestId('opening');
    await expect(player).toHaveAttribute('data-opening-motion', 'still');
    await expect(player.locator('[data-opening-photo]')).toHaveCount(1);
    await expect(
      player.locator('[data-opening-sweep], [data-opening-sparkle], [data-opening-word]'),
    ).toHaveCount(0);
    // What changes: only opacity (the lines', and the whole at its end); no transform anywhere.
    await expect
      .poll(() => player.evaluate((root) => root.getAnimations({ subtree: true }).length))
      .toBeGreaterThan(0);
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
  await moving.emulateMedia({ reducedMotion: 'reduce' });
  await still(reduced.app);
  await reduced.app.close();
});

test('nothing in it swings in light more than three times a second, over the whole and each quarter, red too', async () => {
  test.setTimeout(300_000);
  // The worst case: eight photos, bright and dark by turns, and five lines.
  const userData = await startedOnce(async (win) => {
    const turns = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? ['235,235,215'] : ['20,20,30']));
    await choose(
      win,
      await pictures(win, turns),
      ['One', 'Two', 'Three', 'Four', 'Five'].map((w) => `Placeholder ${w} words here`),
    );
  });
  const { app } = await relaunchApp(userData, ASK);
  const win = await operatorPage(app);
  const player = win.getByTestId('opening');
  await expect(player).toBeVisible({ timeout: 15_000 });
  // Held at once, every part (they are made together), then measured at the screens' 1280 × 720.
  await expect
    .poll(() =>
      player.evaluate((root) => {
        const all = root.getAnimations({ subtree: true });
        for (const a of all) a.pause();
        return all.length;
      }),
    )
    .toBeGreaterThan(20);
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  // Held, then each 60th of a second from its start to its end, as the screens' frames are measured.
  const FPS = 60;
  const whole: number[] = [];
  const quads: number[][] = [[], [], [], []];
  const red: number[] = [];
  for (let i = 0; (i * 1000) / FPS <= 5000; i++) {
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
  // It did change: the photos came in by turns.
  expect(Math.max(...whole) - Math.min(...whole)).toBeGreaterThan(0.3);
  await app.close();
});

test('File › Opening… at 1024 × 645 and 1280 × 720: photos from Media with their lines, a preview, the copies made, and turned off', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await pictures(win, [['235,200,120'], ['40,90,160'], ['120,40,60']], { width: 1600, height: 900 });
  for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
    await sizeOperatorWindow(app, win, size);
    await chooseMenuItem(app, 'opening');
    const dialog = win.getByTestId('opening-dialog');
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yIssues(win, `File › Opening… at ${String(size.width)} × ${String(size.height)}`);
    for (const id of ['opening-on', 'opening-play', 'opening-add-photo', 'opening-load-pack']) {
      await dialog.getByTestId(id).scrollIntoViewIfNeeded();
      await expect(dialog.getByTestId(id)).toBeInViewport();
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await chooseMenuItem(app, 'opening');
  const dialog = win.getByTestId('opening-dialog');
  for (const n of [1, 2]) {
    await dialog.getByTestId('opening-add-photo').click();
    const picker = win.getByTestId('media-picker');
    await picker.getByRole('button', { name: new RegExp(`placeholder-${String(n)}`, 'u') }).click();
    await expect(dialog.getByTestId('opening-photo')).toHaveCount(n);
  }
  await dialog.getByTestId('opening-line-1').fill('Placeholder first line');
  await dialog.getByTestId('opening-line-2').fill('Placeholder second line');
  await dialog.getByTestId('opening-line-1').click();
  // Each photo's copy for the opening is made, at most the window's size, and kept in the media folder.
  await expect(dialog.getByTestId('opening-photo').filter({ hasText: 'Getting it ready' })).toHaveCount(0, {
    timeout: 20_000,
  });
  expect(readdirSync(join(userData, 'Media', 'opening')).filter((f) => f.endsWith('.jpg'))).toHaveLength(2);
  // Each line is kept as the next field is taken (its save comes back while the next is typed, wiping nothing).
  await expect
    .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.opening.view().then((v) => v.lines)))
    .toEqual(['Placeholder first line', 'Placeholder second line']);
  const kept = await win.evaluate(() => (globalThis as PageGlobals).drashti.opening.view());
  expect(kept.photos.map((p) => p.ready)).toEqual([true, true]);
  // The preview plays it in the dialog, and ends by itself.
  await dialog.getByTestId('opening-play').click();
  const preview = dialog.getByTestId('opening-preview');
  await expect(preview).toHaveAttribute('data-photos', '2');
  await expect(preview.locator('img[data-opening-photo]').first()).toHaveAttribute(
    'src',
    /drashti-media:\/\/opening\//u,
  );
  await expect(preview).toHaveCount(0, { timeout: 10_000 });
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

test('Load the opening pack…: its eight photos into Media and its five lines replace what was chosen; a pack missing some says what, and nothing changes', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await choose(win, await pictures(win, [['90,90,90']]), ['Placeholder chosen before']);
  const packOf = async (photos: number, lines: number) => {
    const root = mkdtempSync(join(tmpdir(), 'drashti-opening-pack-'));
    mkdirSync(join(root, 'photos'));
    for (let n = 1; n <= photos; n++)
      await drawPicture(win, join(root, 'photos', `${String(n)}.png`), plain(`${String(20 * n)},60,120`));
    writeFileSync(
      join(root, 'words.txt'),
      Array.from({ length: lines }, (_, i) => `Placeholder pack line ${String(i + 1)}`).join('\n'),
    );
    return root;
  };
  const load = async (root: string) => {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, root);
    await win.getByTestId('opening-dialog').getByTestId('opening-load-pack').click();
  };
  await chooseMenuItem(app, 'opening');
  const dialog = win.getByTestId('opening-dialog');
  await expect(dialog).toBeVisible();
  await load(await packOf(7, 3));
  await expect(dialog.getByTestId('opening-problem')).toHaveText(
    'The opening pack is missing photo 8 (photos/8.jpg), and has 3 lines of the 5 in words.txt. Nothing was changed.',
  );
  const before = await win.evaluate(() => (globalThis as PageGlobals).drashti.opening.view());
  expect(before.lines).toEqual(['Placeholder chosen before']);
  expect(before.photos).toHaveLength(1);
  await load(await packOf(8, 5));
  await expect(dialog.getByTestId('opening-photo')).toHaveCount(8, { timeout: 30_000 });
  await expect(dialog.getByTestId('opening-problem')).toHaveCount(0);
  const after = await win.evaluate(() => (globalThis as PageGlobals).drashti.opening.view());
  expect(after.lines).toEqual([1, 2, 3, 4, 5].map((n) => `Placeholder pack line ${String(n)}`));
  expect(after.photos.map((p) => p.name)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${String(n)}.png`));
  await expect(dialog.getByTestId('opening-line-5')).toHaveValue('Placeholder pack line 5');
  expect(openingLog(userData).join(' ')).not.toContain('Placeholder');
  await app.close();
});
