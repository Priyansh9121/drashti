import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseMenuItem,
  closeLibrary,
  importAndGetIds,
  launchApp,
  letTimePass,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
  relaunchApp,
} from './helpers';

/*
 * Motion in the interface (Session 26g, "Rising"): show controls, thumbnails and the live picture
 * never move; dialogs, sheets, menus, notices and a playlist row moving Up or Down arrive (and
 * leave) with their tokens; and with the computer set to reduce motion, nothing in the window moves
 * at all. Placeholder content and a generated picture only.
 */

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** A small generated picture, saved to a temporary folder. */
async function picture(win: Page): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-motion-')), 'Placeholder picture.png');
  const base64 = await win.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = 'rgb(40,90,160)';
    ctx.fillRect(0, 0, 320, 180);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

/**
 * Everything under these elements (and the elements themselves, with ::before and ::after) that
 * would move: a transition or an animation, as getComputedStyle says, and running animations.
 */
function moving(win: Page, selector: string) {
  return win.evaluate((sel) => {
    const found: string[] = [];
    const roots = [...document.querySelectorAll(sel)];
    const name = (el: Element) =>
      el.getAttribute('data-testid') ??
      el.getAttribute('aria-label') ??
      (el.textContent.trim().slice(0, 30) || el.tagName);
    for (const root of roots)
      for (const el of [root, ...root.querySelectorAll('*')])
        for (const pseudo of [null, '::before', '::after']) {
          const st = getComputedStyle(el, pseudo);
          const transition = st.transitionDuration.split(',').some((d) => Number.parseFloat(d) > 0);
          if (transition && st.transitionProperty !== 'none') found.push(`${name(root)}: a transition`);
          if (st.animationName !== 'none') found.push(`${name(root)}: animation ${st.animationName}`);
        }
    for (const a of document.getAnimations()) {
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (target && roots.some((r) => r.contains(target))) found.push(`${name(target)}: running`);
    }
    return [...new Set(found)];
  }, selector);
}

test('the window opens settled with what its first data shows; what comes later still arrives', async () => {
  // Opening is when a computer without a graphics chip can least spare frames (ui/motion.ts): the
  // empty playlist list that comes with the window's first data is simply there, with no smoke.
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const empty = win.locator('.lamp-empty').filter({ has: win.getByText('No playlists yet') });
  await expect(empty).toBeVisible();
  await expect(empty).not.toHaveAttribute('data-motion');
  await expect(empty.locator('.lamp-wisp')).toHaveCount(0);
  expect(await moving(win, '.lamp-empty')).toEqual([]);
  // Settled without a key or a click (the page says so once it has), the keys sheet, opened from the
  // menu, rises as it arrives.
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  await chooseMenuItem(app, 'keyboard-shortcuts');
  await expect(win.locator('[role="dialog"][data-motion="dialog"]')).toBeVisible();
  await app.close();
});

test('show controls, thumbnails and the live picture never move, in Pro Mode and Simple Mode', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // A picture in a playlist (its card), and a presentation live (its thumbnails and the live picture).
  const [pictureId = ''] = await importAndGetIds(win, [await picture(win)]);
  await win.evaluate(async (mediaId) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.playlists.create('Placeholder motion', null, false);
    if (!made.ok) throw new Error(made.message);
    await d.playlists.addItems(made.ids[0] ?? '', null, [{ kind: 'media', mediaId }]);
  }, pictureId);
  await win
    .getByTestId('playlist-node')
    .filter({ hasText: /^Placeholder motion/u })
    .click();
  // One click on its card puts it up (Session 54): the middle's picture of it is live.
  await win.getByTestId('playlist-item').first().click();
  const card = win.getByTestId('item-media');
  await expect(card).toHaveAttribute('aria-current', 'true');
  // The picture's card, live, its border and glow red: still.
  await card.hover();
  expect(await moving(win, '[data-testid="item-media"], [data-testid="live-preview"]')).toEqual([]);
  const presentation = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.library.listPresentations())[0]?.id ?? '',
  );
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await dispatch(win, { type: 'goLive', presentationId: presentation, slideIndex: 0 });
  await expect(win.getByTestId('slide-thumb').first()).toHaveAttribute('aria-current', 'true');

  const SHOW =
    '[data-testid="layer-bar"] button, [data-testid="show-next"], [data-testid="show-back"], [data-testid="slide-thumb"], [data-testid="item-media"], [data-testid="live-preview"], [data-testid="look-button"]';
  expect(await moving(win, SHOW)).toEqual([]);
  // Hovered, pressed and lit too.
  await win.getByTestId('blackout-button').hover();
  await dispatch(win, { type: 'setBlackout', on: true });
  expect(await moving(win, SHOW)).toEqual([]);
  await dispatch(win, { type: 'setBlackout', on: false });
  await win.getByRole('button', { name: 'Clear all' }).click();
  await expect(win.getByTestId('put-back')).toBeVisible();
  expect(await moving(win, SHOW)).toEqual([]);
  await win.getByTestId('put-back').click();

  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await moving(win, '[data-testid="simple-buttons"] button, [data-testid="simple-item"]')).toEqual([]);
  await app.close();
});

test('dialogs, sheets, menus and notices arrive with their tokens, and leave unseen by the show’s keys', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const animationOf = (sel: string) =>
    win
      .locator(sel)
      .first()
      .evaluate((el) => {
        const st = getComputedStyle(el);
        return `${st.animationName} ${st.animationDuration}`;
      });

  // A dialog rises 8 px over 220 ms, its dim fading over 200 ms.
  await win.keyboard.press('Shift+Slash');
  const keys = win.getByTestId('keys-sheet');
  await expect(keys).toBeVisible();
  expect(await animationOf('[role="dialog"][data-motion="dialog"]')).toBe('dialog-in 0.22s');
  expect(await animationOf('[data-motion="scrim"]')).toBe('fade-in 0.2s');
  // It leaves as a copy no one can reach, and the show's keys work at once.
  await win.keyboard.press('Escape');
  await expect(keys).toHaveCount(0);
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  const presentation = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.library.listPresentations())[0]?.id ?? '',
  );
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await win.keyboard.press('ArrowRight');
  await expect
    .poll(() =>
      win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.presentationId,
      ),
    )
    .toBe(presentation);
  await expect(win.locator('[data-leaving-host]')).toHaveCount(0);

  // A side sheet slides 16 px from its edge over 240 ms.
  await win.getByRole('button', { name: 'Themes' }).click();
  await expect(win.locator('[data-motion="sheet"]')).toBeVisible();
  expect(await animationOf('[data-motion="sheet"]')).toBe('sheet-in 0.24s');
  await win.keyboard.press('Escape');

  // A menu pops from where it opened over 160 ms; "What is this?" too.
  await win.getByTestId('presentation-list').getByRole('button').first().click({ button: 'right' });
  await expect(win.getByRole('menu')).toBeVisible();
  expect(await animationOf('[role="menu"]')).toBe('pop-in 0.16s');
  await win.keyboard.press('Escape');
  await win.getByTestId('what-is-this-live').click();
  expect(await animationOf('[data-testid="what-is-this"]')).toBe('pop-in 0.16s');

  // A notice rises 6 px over 200 ms (one the main process sends, as after saving diagnostics).
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows())
      if (w.webContents.getURL().includes('index.html'))
        w.webContents.send('app:notice', { text: 'Placeholder notice' });
  });
  await expect(win.getByTestId('operator-notice')).toBeVisible();
  expect(await animationOf('[data-testid="operator-notice"]')).toBe('rise-notice 0.2s');
  await app.close();
});

test('a playlist row moving Up or Down slides to its place over 180 ms', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [a, b] = await d.library.listPresentations();
    const made = await d.playlists.create('Placeholder order', null, false);
    if (!made.ok) throw new Error(made.message);
    await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'presentation', presentationId: a?.id ?? '' },
      { kind: 'presentation', presentationId: b?.id ?? '' },
    ]);
  });
  await win
    .getByTestId('playlist-node')
    .filter({ hasText: /^Placeholder order/u })
    .click();
  const rows = win.getByTestId('playlist-item');
  await rows.nth(1).click();
  const moved = await rows.nth(1).getAttribute('data-item-id');
  const watch = win.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const look = () => {
          for (const a of document.getAnimations())
            if (a instanceof CSSAnimation || a instanceof CSSTransition) continue;
            else seen.push(Number(a.effect?.getComputedTiming().duration ?? 0));
          if (seen.length > 0) resolve(seen);
          else requestAnimationFrame(look);
        };
        look();
        setTimeout(() => resolve(seen), 3000);
      }),
  );
  // Up takes a click once it has been there a moment (Session 54: never a double click's second).
  await letTimePass(win, 600, 'Up and Down take a click once they have been there a moment');
  await win.locator('[data-move="up"]').click();
  expect(await watch).toContain(180);
  await expect(rows.first()).toHaveAttribute('data-item-id', moved ?? '');
  await app.close();
});

/** Anything in the window that moves, except the pictures of the screens (what the hall sees). */
async function still(win: Page, what: string): Promise<void> {
  const found = await win.evaluate(() => {
    const out: string[] = [];
    const picture = (el: Element) => el.closest('[data-a11y-picture]') !== null;
    for (const el of document.querySelectorAll('body *')) {
      if (picture(el)) continue;
      for (const pseudo of [null, '::before', '::after']) {
        const st = getComputedStyle(el, pseudo);
        if (st.animationName !== 'none') out.push(`${el.tagName}.${el.className}: ${st.animationName}`);
        if (st.transitionDuration.split(',').some((d) => Number.parseFloat(d) > 0))
          out.push(`${el.tagName}.${el.className}: transition`);
      }
    }
    for (const a of document.getAnimations()) {
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (target && !picture(target)) out.push(`${target.tagName}: running`);
    }
    if (document.querySelector('[data-leaving-host]')) out.push('a leaving copy');
    return [...new Set(out)];
  });
  expect(found, what).toEqual([]);
}

/** Interface motion, as the Appearance window sets it (Session 40), and the window drawn with it. */
async function interfaceMotion(win: Page, motion: 'calm' | 'lively' | 'off'): Promise<void> {
  const set = await win.evaluate((m) => (globalThis as PageGlobals).drashti.appearance.setMotion(m), motion);
  expect(set).toEqual({ ok: true });
  await expect(win.locator('html')).toHaveAttribute('data-interface-motion', motion);
}

/** Every kind of thing that would arrive or leave, each checked to move not at all. */
async function nothingMoves(app: ElectronApplication, win: Page): Promise<void> {
  await still(win, 'the window');
  await win.keyboard.press('Shift+Slash');
  await expect(win.getByTestId('keys-sheet')).toBeVisible();
  await still(win, 'a dialog');
  await win.keyboard.press('Escape');
  await still(win, 'a dialog closing');
  await win.getByRole('button', { name: 'Themes' }).click();
  await still(win, 'a side sheet');
  await win.keyboard.press('Escape');
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click({ button: 'right' });
  await expect(win.getByRole('menu')).toBeVisible();
  await still(win, 'a menu');
  await win.keyboard.press('Escape');
  await win.getByTestId('what-is-this-live').click();
  await still(win, 'What is this?');
  // A notice, as the main process sends one.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows())
      if (w.webContents.getURL().includes('index.html'))
        w.webContents.send('app:notice', { text: 'Placeholder notice' });
  });
  await expect(win.getByTestId('operator-notice')).toBeVisible();
  await still(win, 'a notice');
  await win.getByTestId('operator-notice').getByRole('button', { name: 'Dismiss' }).click();
  await still(win, 'a notice leaving');
  // A playlist row moving, a playlist opening (Lively's arrivals), a tab chosen and a panel opened.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [a, b] = await d.library.listPresentations();
    const made = await d.playlists.create('Placeholder still', null, false);
    if (!made.ok) throw new Error(made.message);
    await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'presentation', presentationId: a?.id ?? '' },
      { kind: 'presentation', presentationId: b?.id ?? '' },
    ]);
  });
  await closeLibrary(win);
  await win
    .getByTestId('playlist-node')
    .filter({ hasText: /^Placeholder still/u })
    .click();
  await still(win, 'a playlist opening');
  await win.getByTestId('playlist-item').nth(1).click();
  await letTimePass(win, 600, 'Up and Down take a click once they have been there a moment');
  await win.locator('[data-move="up"]').click();
  await still(win, 'a row moving up');
  await openLibrary(win);
  await win.getByTestId('library-tab-media').click();
  await still(win, 'a tab chosen');
  await win.getByTestId('group-more-tools-toggle').click();
  await still(win, 'a panel opening');
}

test('with the computer set to reduce motion, nothing in the window moves at all', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await operatorReady(win);
  await nothingMoves(app, win);
  await app.close();
});

test('with interface motion Off, nothing in the window moves at all (Session 40)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await interfaceMotion(win, 'off');
  await nothingMoves(app, win);
  await app.close();
});

test('with the computer set to reduce motion, Lively moves nothing either (Session 40)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await operatorReady(win);
  await interfaceMotion(win, 'lively');
  await nothingMoves(app, win);
  await app.close();
});

/** Every animation running in the window now that is not a leaving copy's: its target and length. */
const running = (win: Page) =>
  win.evaluate(() =>
    document.getAnimations().flatMap((a) => {
      const effect = a.effect as KeyframeEffect | null;
      const target = effect?.target;
      if (!target || target.closest('[data-leaving-host]')) return [];
      const what = `${target.getAttribute('data-testid') ?? target.tagName}${effect.pseudoElement ?? ''}`;
      return [{ what, ms: Number(effect.getComputedTiming().duration ?? 0) }];
    }),
  );

/** Every animation that starts in the page within `ms` of now (what a change sets moving). */
const watchAnimations = (win: Page, ms: number) =>
  win.evaluate(
    (wait) =>
      new Promise<{ what: string; ms: number; delay: number }[]>((resolve) => {
        const seen = new Map<Animation, { what: string; ms: number; delay: number }>();
        const look = () => {
          for (const a of document.getAnimations()) {
            const effect = a.effect as KeyframeEffect | null;
            const target = effect?.target;
            if (!target || seen.has(a)) continue;
            const timing = effect.getComputedTiming();
            seen.set(a, {
              what: `${target.getAttribute('data-testid') ?? (target.hasAttribute('data-glide') ? 'underline' : target.tagName)}${effect.pseudoElement ?? ''}`,
              ms: Number(timing.duration ?? 0),
              delay: effect.getTiming().delay ?? 0,
            });
          }
          requestAnimationFrame(look);
        };
        look();
        setTimeout(() => {
          resolve([...seen.values()]);
        }, wait);
      }),
    ms,
  );

test('Lively: the tab’s underline and the chosen playlist glide, cards arrive one after another, a panel opens, a press answers, and an appearance fades into the next (Session 40)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await interfaceMotion(win, 'lively');
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [a, b] = await d.library.listPresentations();
    for (const name of ['Placeholder lively one', 'Placeholder lively two']) {
      const made = await d.playlists.create(name, null, false);
      if (!made.ok) throw new Error(made.message);
      await d.playlists.addItems(made.ids[0] ?? '', null, [
        { kind: 'presentation', presentationId: a?.id ?? '' },
        { kind: 'presentation', presentationId: b?.id ?? '' },
      ]);
    }
  });
  const row = (name: string) =>
    win.getByTestId('playlist-node').filter({ hasText: new RegExp(`^${name}`, 'u') });
  await expect(row('Placeholder lively two')).toBeVisible();
  // Nothing starts while the show is changing: let the window's own start settle first.
  await letTimePass(win, 900, 'the show has not changed for a moment, as Lively waits for');

  // The playlist opens: its cards arrive one after another, 30 ms apart.
  let started = watchAnimations(win, 800);
  await row('Placeholder lively one').click();
  await expect(win.getByTestId('playlist-item')).toHaveCount(2);
  const arrivals = (await started).filter((a) => a.what === 'LI');
  expect(arrivals.map((a) => [a.ms, a.delay])).toEqual([
    [220, 0],
    [220, 30],
  ]);

  // The chosen playlist's highlight glides to the next one chosen.
  started = watchAnimations(win, 800);
  await row('Placeholder lively two').click();
  expect((await started).some((a) => a.what === 'SPAN' && a.ms === 240)).toBe(true);

  // The tab's underline glides to the tab chosen.
  await openLibrary(win);
  started = watchAnimations(win, 800);
  await win.getByTestId('library-tab-media').click();
  expect((await started).some((a) => a.what === 'underline' && a.ms === 240)).toBe(true);

  // A folded panel's insides arrive as it opens.
  await win.getByTestId('group-more-tools-toggle').click();
  const body = win.locator('[data-lively="open"]').first();
  await expect(body).toBeVisible();
  expect(await body.evaluate((el) => getComputedStyle(el).animationName)).toBe('lively-open');

  // A button answers a press; a show control never does.
  const transitions = (sel: string) =>
    win
      .locator(sel)
      .first()
      .evaluate((el) => getComputedStyle(el).transitionProperty);
  expect(await transitions('[data-testid="open-network"]')).toContain('transform');
  expect(await transitions('[data-testid="show-next"]')).toBe('none');

  // One appearance fades into the next.
  started = watchAnimations(win, 800);
  await chooseMenuItem(app, 'appearance-white');
  await chooseMenuItem(app, 'appearance-black');
  expect((await started).some((a) => a.what.includes('::view-transition') && a.ms === 200)).toBe(true);
  await app.close();
});

test('Lively: the band sweeps in once as the appearance changes, a block at a time; never in Calm, nor with reduced motion (Session 42)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await interfaceMotion(win, 'lively');
  // Not as the window opened: nothing has asked the band to sweep.
  expect(await win.evaluate(() => document.documentElement.dataset['bandSweep'] ?? null)).toBeNull();
  await letTimePass(win, 900, 'the show has not changed for a moment, as Lively waits for');
  /** Each sweep of a band block that starts from now: its animation and its delay. */
  const listen = () =>
    win.evaluate(() => {
      const w = globalThis as unknown as { sweeps?: string[] };
      if (!w.sweeps)
        document.addEventListener('animationstart', (e) => {
          const block = e.target as Element;
          if (block.parentElement?.hasAttribute('data-band'))
            w.sweeps?.push(`${e.animationName} ${getComputedStyle(block).animationDelay}`);
        });
      w.sweeps = [];
    });
  const sweeps = () => win.evaluate(() => (globalThis as unknown as { sweeps?: string[] }).sweeps ?? []);
  const bandMoving = () =>
    win.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) =>
            ((a.effect as KeyframeEffect | null)?.target?.parentElement ?? null)?.hasAttribute('data-band'),
          ).length,
    );
  const each = (name: string) => ['0s', '0.04s', '0.08s', '0.12s', '0.16s'].map((d) => `${name} ${d}`);

  await listen();
  await chooseMenuItem(app, 'appearance-dhaja');
  await expect.poll(sweeps).toEqual(each('band-sweep-a'));
  // Once: then it is still, and nothing keeps moving.
  await expect.poll(bandMoving).toBe(0);
  // The next change plays it again.
  await listen();
  await chooseMenuItem(app, 'appearance-tiranga');
  await expect.poll(sweeps).toEqual(each('band-sweep-b'));
  await expect.poll(bandMoving).toBe(0);

  // Calm: no sweep.
  await interfaceMotion(win, 'calm');
  await listen();
  await chooseMenuItem(app, 'appearance-holi');
  await expect(win.locator('html')).toHaveAttribute('data-appearance', 'holi');
  await letTimePass(win, 600, 'long enough for a sweep to have started');
  expect(await sweeps()).toEqual([]);
  // Lively, with the computer set to reduce motion: none either.
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await interfaceMotion(win, 'lively');
  await listen();
  await chooseMenuItem(app, 'appearance-diwali');
  await expect(win.locator('html')).toHaveAttribute('data-appearance', 'diwali');
  await letTimePass(win, 600, 'long enough for a sweep to have started');
  expect(await sweeps()).toEqual([]);
  await app.close();
});

test('Lively never moves a show control or the live picture, starts nothing as the slide changes, and the window opens settled (Session 40)', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await interfaceMotion(win, 'lively');
  const presentation = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.library.listPresentations())[0]?.id ?? '',
  );
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await dispatch(win, { type: 'goLive', presentationId: presentation, slideIndex: 0 });
  await expect(win.getByTestId('slide-thumb').first()).toHaveAttribute('aria-current', 'true');
  const SHOW =
    '[data-testid="layer-bar"] button, [data-testid="show-next"], [data-testid="show-back"], [data-testid="slide-thumb"], [data-testid="live-preview"], [data-testid="look-button"]';
  expect(await moving(win, SHOW)).toEqual([]);
  // Next, pressed: the slide changes at once and nothing in the window starts moving with it.
  await letTimePass(win, 900, 'the show has not changed for a moment');
  const started = watchAnimations(win, 700);
  await win.getByTestId('show-next').click();
  await expect(win.getByTestId('slide-thumb').nth(1)).toHaveAttribute('aria-current', 'true');
  expect(await started).toEqual([]);
  expect(await moving(win, SHOW)).toEqual([]);
  await app.close();

  // Started again in Lively: whatever is there as the window opens is simply there.
  const again = await relaunchApp(userData);
  const next = await operatorPage(again.app);
  await expect(next.locator('html')).toHaveAttribute('data-interface-motion', 'lively');
  await operatorReady(next);
  await expect(next.locator('html')).toHaveAttribute('data-opened', '');
  expect(await running(next)).toEqual([]);
  await again.app.close();
});
