import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../src/shared/lower-thirds';
import { settled } from './a11y';
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
import { helpOn } from './help';

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
  // One click on its card puts it up (Session 54; Session 55: its row in the playlist says LIVE, the middle having
  // no picture of its own for it any more).
  const card = win.getByTestId('playlist-item').first();
  await card.click();
  await expect(card).toHaveAttribute('data-live', 'true');
  // The picture's row, live: still (a show control never fades).
  await card.hover();
  expect(await moving(win, '[data-testid="playlist-item"], [data-testid="live-preview"]')).toEqual([]);
  const presentation = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.library.listPresentations())[0]?.id ?? '',
  );
  // With no playlist open, the library's chosen presentation shows in the middle as rows (Session 55).
  await win.getByTestId('playlist-close').click();
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await dispatch(win, { type: 'goLive', presentationId: presentation, slideIndex: 0 });
  await expect(win.getByTestId('slide-thumb').first()).toHaveAttribute('aria-current', 'true');

  const SHOW =
    '[data-testid="layer-bar"] button, [data-testid="show-next"], [data-testid="show-back"], [data-testid="slide-thumb"], [data-testid="playlist-item"], [data-testid="live-preview"]';
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

  // Simple Mode, on the playlist opened again in Pro Mode (its one playlist, Session 55, Part 18): its show's controls
  // (Pro Mode's, fewer) and its rows still.
  await closeLibrary(win);
  await win
    .getByTestId('playlist-node')
    .filter({ hasText: /^Placeholder motion/u })
    .click();
  await win.getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('simple-mode').getByTestId('playlist-item')).toHaveCount(1);
  expect(
    await moving(
      win,
      '[data-testid="simple-buttons"] button, [data-testid="show-next"], [data-testid="show-back"], [data-testid="playlist-item"], [data-testid="live-preview"]',
    ),
  ).toEqual([]);
  await app.close();
});

test('dialogs, sheets, menus and notices arrive with their tokens, and leave unseen by the show’s keys', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await helpOn(win);
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

  // A side sheet slides 16 px from its edge over 240 ms (Screens; Themes until Session 55 took it out).
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
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
  await helpOn(win);
  await still(win, 'the window');
  await win.keyboard.press('Shift+Slash');
  await expect(win.getByTestId('keys-sheet')).toBeVisible();
  await still(win, 'a dialog');
  await win.keyboard.press('Escape');
  await still(win, 'a dialog closing');
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
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
  // A section under LIVE opening (Audio, a group as More tools was until alpha.22; folded at the start), and folding
  // again (alpha.24: no copy of it is drawn).
  await win.getByTestId('group-audio-toggle').click();
  await still(win, 'a panel opening');
  await win.getByTestId('group-audio-toggle').click();
  await still(win, 'a panel folding');
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

/** Whether Chromium draws without a graphics chip, once it has said (data-chip: unknown until then). */
async function chipless(win: Page): Promise<boolean> {
  await expect(win.locator('html')).toHaveAttribute('data-chip', /^(yes|no)$/u);
  const chip = await win.locator('html').getAttribute('data-chip');
  // In the run's log, so a reader sees which branch of each step ran (the release lead's review of uimotion, S1).
  console.log(`data-chip: ${chip ?? 'none'}`);
  return chip === 'no';
}

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

/**
 * Every animation that starts in the page within `ms` of the next click it takes (what that click sets moving). The
 * watch starts as the click reaches the window, not as the test asks for it: on CI's Mac VM a click can take over a
 * second to land (Session 55's gate: 1,151 ms, against an 800 ms watch started just before it). It looks at the page
 * as it changes as well as at each frame, so a slow frame there can't hide an animation that started.
 */
const watchClick = (win: Page, ms: number) =>
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
        };
        window.addEventListener(
          'click',
          () => {
            look();
            const changes = new MutationObserver(look);
            changes.observe(document, { subtree: true, childList: true, attributes: true });
            let frame = 0;
            const each = () => {
              look();
              frame = requestAnimationFrame(each);
            };
            frame = requestAnimationFrame(each);
            setTimeout(() => {
              changes.disconnect();
              cancelAnimationFrame(frame);
              resolve([...seen.values()]);
            }, wait);
          },
          { capture: true, once: true },
        );
      }),
    ms,
  );

test('Lively: the tab’s underline and the chosen playlist glide, cards arrive one after another, a panel opens, a press answers, and an appearance fades into the next (Session 40); without a graphics chip, none of it (alpha.24)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await interfaceMotion(win, 'lively');
  // All of Lively waits for a graphics chip since alpha.24 (the release lead's review of uimotion, MUST-1, answered as
  // recommended): without one (CI's Windows) it moves as Calm does, so each step below says both.
  const noChip = await chipless(win);
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
    // An audio playlist, so Audio's insides hold the music's Play, Previous and Next (show controls, alpha.24's S4).
    const sounds = await d.music.create('Placeholder lively sounds');
    if (!sounds.ok) throw new Error('Could not make the audio playlist');
  });
  const row = (name: string) =>
    win.getByTestId('playlist-node').filter({ hasText: new RegExp(`^${name}`, 'u') });
  await expect(row('Placeholder lively two')).toBeVisible();
  // Nothing starts while the show is changing: let the window's own start settle first.
  await letTimePass(win, 900, 'the show has not changed for a moment, as Lively waits for');

  // The playlist opens: its cards arrive one after another, 30 ms apart (watched from the click's arrival).
  let started = watchClick(win, 800);
  await row('Placeholder lively one').click();
  await expect(win.getByTestId('playlist-item')).toHaveCount(2);
  const arrivals = (await started).filter((a) => a.what === 'LI');
  expect(arrivals.map((a) => [a.ms, a.delay])).toEqual(
    noChip
      ? []
      : [
          [220, 0],
          [220, 30],
        ],
  );

  // The chosen playlist's highlight glides to the next one chosen.
  started = watchClick(win, 800);
  await row('Placeholder lively two').click();
  expect((await started).some((a) => a.what === 'SPAN' && a.ms === 240)).toBe(!noChip);

  // The tab's underline glides to the tab chosen.
  await openLibrary(win);
  started = watchClick(win, 800);
  await win.getByTestId('library-tab-media').click();
  expect((await started).some((a) => a.what === 'underline' && a.ms === 240)).toBe(!noChip);

  // A folded panel's insides arrive as it opens (every section under LIVE is folded at the start, alpha.22), unrolling
  // (alpha.24): Show a Window's. Audio's hold the music's show controls (alpha.24's review, S4), so they are there at
  // once (S2). Without a graphics chip (CI's Windows), simply there.
  // Watch from the click itself: an arrival that has ended is now forgotten at once (item 8), so a later snapshot
  // cannot say whether it played. Audio's show controls never arrive, and its unused marker goes at once too.
  const windowOpened = await pressFold(win);
  await expect(win.getByTestId('show-a-window')).toBeVisible();
  expect(windowOpened.arrivals).toEqual(noChip ? [] : ['lively-open 250']);
  expect(await arrival(win)).toBe('none none none 0s');
  await letTimePass(win, 900, 'the show has not changed for a moment, as Lively waits for');
  const audioOpened = await pressFold(win, 'audio');
  await expect(win.getByTestId('music-panel')).toBeVisible();
  await expect(win.getByTestId('music-play')).toHaveAttribute('data-show-control', '');
  expect(audioOpened.arrivals).toEqual([]);
  expect(await arrival(win, 'audio')).toBe('none none none 0s');

  // A button answers a press; a show control never does.
  const transitions = (sel: string) =>
    win
      .locator(sel)
      .first()
      .evaluate((el) => getComputedStyle(el).transitionProperty);
  if (noChip) expect(await transitions('[data-testid="open-network"]')).not.toContain('transform');
  else expect(await transitions('[data-testid="open-network"]')).toContain('transform');
  expect(await transitions('[data-testid="show-next"]')).toBe('none');

  // One appearance fades into the next.
  started = watchAnimations(win, 800);
  await chooseMenuItem(app, 'appearance-white');
  await chooseMenuItem(app, 'appearance-black');
  expect((await started).some((a) => a.what.includes('::view-transition') && a.ms === 200)).toBe(!noChip);
  await app.close();
});

test('Lively: the band sweeps in once as the appearance changes, a block at a time; never in Calm, nor with reduced motion (Session 42), nor without a graphics chip (alpha.24)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await interfaceMotion(win, 'lively');
  // Without a graphics chip (CI's Windows), Lively is held whole (alpha.24's review of uimotion, MUST-1): no sweep.
  const noChip = await chipless(win);
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
  if (noChip) {
    await expect(win.locator('html')).toHaveAttribute('data-appearance', 'dhaja');
    await letTimePass(win, 600, 'long enough for a sweep to have started');
    expect(await sweeps()).toEqual([]);
  } else {
    await expect.poll(sweeps).toEqual(each('band-sweep-a'));
    // Once: then it is still, and nothing keeps moving.
    await expect.poll(bandMoving).toBe(0);
    // The next change plays it again.
    await listen();
    await chooseMenuItem(app, 'appearance-tiranga');
    await expect.poll(sweeps).toEqual(each('band-sweep-b'));
    await expect.poll(bandMoving).toBe(0);
  }

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
    '[data-testid="layer-bar"] button, [data-testid="show-next"], [data-testid="show-back"], [data-testid="slide-thumb"], [data-testid="live-preview"]';
  expect(await moving(win, SHOW)).toEqual([]);
  // Next, pressed: the slide changes at once and nothing in the window starts moving with it.
  const started = watchClick(win, 700);
  const beforeNext = await Promise.race([
    started.then(() => 'ended'),
    letTimePass(win, 900, 'Next can take longer to reach the page than the animation watch').then(
      () => 'waiting',
    ),
  ]);
  expect(beforeNext, 'the animation watch is still waiting for Next').toBe('waiting');
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

/*
 * alpha.24 (uimotion; the owner's QA24-UI-3 "a more interactive and more animated, more transitions"): a section under
 * LIVE folds and unfolds as its heading is pressed. Calm fades its insides in and a copy of them out, every box in its
 * place in the frame the press lands (so nothing that measures the window catches a fold half-open); Lively unrolls
 * them as what is under it glides; and, as a live look's touch, none of it without a graphics chip, with Off or with
 * reduced motion, or while the show changes. No copy and no glide where a show control is near, and nothing for the
 * column scrolling back (the release lead's review, MUST-2; lead 2's hands-on pass, problem 1). Placeholder content
 * only.
 */

interface FoldMoves {
  /** Each glide's length (ms). */
  glides: number[];
  /** Each copy's kind. */
  copies: string[];
  /** Each insides' arrival: its animation's name and length (ms). */
  arrivals: string[];
}

/** What a press sets moving in the column from the click's arrival, for `ms`. */
const watchFold = (win: Page, ms: number) =>
  win.evaluate(
    (wait) =>
      new Promise<FoldMoves>((resolve) => {
        const glides: number[] = [];
        const copies: string[] = [];
        const arrivals: string[] = [];
        const seen = new Set<Animation>();
        const look = () => {
          for (const a of document.getAnimations()) {
            if (seen.has(a) || a instanceof CSSTransition) continue;
            seen.add(a);
            const effect = a.effect as KeyframeEffect | null;
            const target = effect?.target;
            if (!effect || !target?.closest('[data-testid="live-rest"]')) continue;
            const ms = Number(effect.getComputedTiming().duration ?? 0);
            if (a instanceof CSSAnimation) {
              if (target.matches('[id$="-body"]')) arrivals.push(`${a.animationName} ${String(ms)}`);
            } else if (
              effect.getKeyframes().some((k) => String(k['transform'] ?? '').startsWith('translateY'))
            )
              glides.push(ms);
          }
        };
        const hosts = new MutationObserver((records) => {
          for (const r of records)
            for (const n of r.addedNodes)
              if (n instanceof HTMLElement && n.dataset['leavingHost']) copies.push(n.dataset['leavingHost']);
        });
        window.addEventListener(
          'click',
          () => {
            hosts.observe(document.body, { childList: true });
            const changes = new MutationObserver(look);
            changes.observe(document, { subtree: true, childList: true, attributes: true });
            let frame = 0;
            const each = () => {
              look();
              frame = requestAnimationFrame(each);
            };
            frame = requestAnimationFrame(each);
            setTimeout(() => {
              hosts.disconnect();
              changes.disconnect();
              cancelAnimationFrame(frame);
              resolve({ glides, copies, arrivals });
            }, wait);
          },
          { capture: true, once: true },
        );
      }),
    ms,
  );

/*
 * Show a Window: its insides are words and a button, the same however long it has been open (Messages' list comes a
 * moment after it opens, and would move what is under it then).
 */
const SECTION = 'show-a-window';

/** The top of the section under Show a Window (its heading's button), now. */
const belowTop = (win: Page) =>
  win
    .getByTestId('group-show-a-stream-link-toggle')
    .evaluate((el) => Math.round(el.getBoundingClientRect().top));

/** The opened insides as they are now: their data-fold, data-lively, animation's name and length. */
const arrival = (win: Page, id = SECTION) =>
  win
    .getByTestId(`group-${id}-toggle`)
    .locator('xpath=ancestor::section[1]')
    .evaluate((section) => {
      const body = section.querySelector<HTMLElement>('[id$="-body"]');
      if (!body) return 'no body';
      const st = getComputedStyle(body);
      return `${body.dataset['fold'] ?? 'none'} ${body.dataset['lively'] ?? 'none'} ${st.animationName} ${st.animationDuration}`;
    });

/** Press a section's heading (Show a Window's unless named), and what it set moving; then everything settled. */
async function pressFold(win: Page, id = SECTION): Promise<FoldMoves & { topAtOnce: number }> {
  const watch = watchFold(win, 800);
  await win.getByTestId(`group-${id}-toggle`).click();
  const topAtOnce = await belowTop(win);
  const moved = await watch;
  await settled(win);
  return { ...moved, topAtOnce };
}

/** Whether the LIVE block stands over the sections (data-still), or scrolls with them in one part (a short window). */
const standing = async (win: Page) =>
  (await win.getByRole('complementary', { name: 'Live', exact: true }).getAttribute('data-still')) === 'true';

/**
 * Whether folding the section now will scroll the column back (it is scrolled further than it then can be): then no
 * copy is drawn (ui/fold.ts, scrollsBack).
 */
const willScrollBack = (win: Page, id = SECTION) =>
  win.evaluate((section) => {
    const body = document
      .querySelector(`[data-testid="group-${section}-toggle"]`)
      ?.closest('section')
      ?.querySelector('[id$="-body"]');
    const scroller = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="live-rest"], [data-testid="live-scroll"]'),
    ].find((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY));
    if (!body || !scroller) return false;
    const going = body.getBoundingClientRect().height;
    return scroller.scrollTop > Math.max(0, scroller.scrollHeight - going - scroller.clientHeight) + 0.5;
  }, id);

/** Every CSS animation running in the column now, a frame after a change of motion: none should start then. */
const replays = (win: Page) =>
  win.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve(
              document
                .getAnimations()
                .flatMap((a) =>
                  a instanceof CSSAnimation &&
                  (a.effect as KeyframeEffect | null)?.target?.closest('[data-testid="live-rest"]')
                    ? [a.animationName]
                    : [],
                ),
            );
          }),
        );
      }),
  );

test('a section under LIVE: Calm fades its insides in and a copy of them out, every box in place at once; Lively unrolls it as what is under it glides; Off moves nothing; a change of motion never plays an arrival again (alpha.24)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  const noChip = await chipless(win);
  // A copy only where no show control shares the column (with the LIVE block scrolling with the sections, none) and
  // the column will not scroll back.
  const copy = (kind: string) => (noChip ? [] : [kind]);
  const toggle = win.getByTestId(`group-${SECTION}-toggle`);
  const chevron = toggle.locator('[data-fold-chevron]');
  await letTimePass(win, 900, 'the show has not changed for a moment, as a fold waits for');

  // Calm, opening: the insides fade in where they go; the section under it is in its new place at once.
  let pressed = await pressFold(win);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(pressed.topAtOnce, 'the section under it, in its place at once').toBe(await belowTop(win));
  expect(pressed.glides).toEqual([]);
  expect(pressed.arrivals).toEqual(noChip ? [] : ['fade-in 200']);
  // Arrived, how it arrived is forgotten (lead 2's hands-on pass, problem 4).
  expect(await arrival(win)).toBe('none none none 0s');
  // The chevron turned down (turning, with a chip).
  expect(await chevron.evaluate((el) => getComputedStyle(el).rotate)).toBe('90deg');
  expect(await chevron.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe(
    noChip ? '0s' : '0.2s',
  );
  // Off, then Calm again; the computer set to reduce motion, then not: the open section's insides stay as they are.
  await interfaceMotion(win, 'off');
  await interfaceMotion(win, 'calm');
  expect(await replays(win), 'Off, then Calm').toEqual([]);
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await replays(win), 'reduced motion, then not').toEqual([]);
  // Calm, folding: a copy of the insides fades where they were (unseen: no one can reach it), the rest at once; none
  // where the LIVE block scrolls with the sections (it holds Next and Back).
  const stands = (await standing(win)) && !(await willScrollBack(win));
  pressed = await pressFold(win);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(win.getByTestId(SECTION)).toHaveCount(0);
  expect(pressed.topAtOnce).toBe(await belowTop(win));
  expect(pressed.glides).toEqual([]);
  expect(pressed.copies).toEqual(stands ? copy('fold') : []);
  await expect(win.locator('[data-leaving-host]')).toHaveCount(0);
  expect(await chevron.evaluate((el) => getComputedStyle(el).rotate)).toBe('none');

  // Lively: the insides unroll as the sections under it glide down from where they were, in step; folding, the copy
  // rolls up as they glide back.
  await interfaceMotion(win, 'lively');
  await letTimePass(win, 900, 'the show has not changed for a moment, as a fold waits for');
  pressed = await pressFold(win);
  expect(pressed.arrivals).toEqual(noChip ? [] : ['lively-open 250']);
  if (noChip) expect(pressed.glides).toEqual([]);
  else {
    expect(pressed.glides.length).toBeGreaterThan(0);
    expect(new Set(pressed.glides)).toEqual(new Set([250]));
  }
  // Calm, then Lively again: the Lively-opened insides stay as they are too.
  await interfaceMotion(win, 'calm');
  await interfaceMotion(win, 'lively');
  expect(await replays(win), 'Calm, then Lively').toEqual([]);
  const standsNow = (await standing(win)) && !(await willScrollBack(win));
  pressed = await pressFold(win);
  expect(pressed.copies).toEqual(standsNow ? copy('fold-lively') : []);
  if (noChip) expect(pressed.glides).toEqual([]);
  else expect(new Set(pressed.glides)).toEqual(new Set([187.5]));
  // Off: nothing moves, either way.
  await interfaceMotion(win, 'off');
  for (const expanded of ['true', 'false']) {
    pressed = await pressFold(win);
    await expect(toggle).toHaveAttribute('aria-expanded', expanded);
    expect(pressed).toEqual({ glides: [], copies: [], arrivals: [], topAtOnce: await belowTop(win) });
  }
  await app.close();
});

/**
 * Press a section's heading and change the interface motion at once to each of `motions` in turn, from inside the page
 * (no round trip between): how long that took from the press, and the CSS animations running in the column two frames
 * after the last.
 */
const switchAtOnce = (win: Page, id: string, motions: readonly string[]) =>
  win.evaluate(
    async ({ section, ms }) => {
      const d = (globalThis as PageGlobals).drashti;
      const frame = () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      const started = performance.now();
      document.querySelector<HTMLElement>(`[data-testid="group-${section}-toggle"]`)?.click();
      for (const m of ms) {
        await d.appearance.setMotion(m as 'calm' | 'lively' | 'off');
        while (document.documentElement.dataset['interfaceMotion'] !== m) await frame();
        // Apply each intermediate style before switching back: otherwise Chromium can coalesce Off and Calm into
        // one style update, so no cancellation happened and an original arrival could still be running.
        document
          .querySelector(`[data-testid="group-${section}-toggle"]`)
          ?.closest('section')
          ?.querySelector('[id$="-body"]')
          ?.getAnimations();
        await frame();
      }
      await frame();
      await frame();
      return {
        took: Math.round(performance.now() - started),
        running: document
          .getAnimations()
          .flatMap((a) =>
            a instanceof CSSAnimation &&
            (a.effect as KeyframeEffect | null)?.target?.closest('[data-testid="live-rest"]')
              ? [a.animationName]
              : [],
          ),
      };
    },
    { section: id, ms: motions },
  );

test('a change of motion just after a section opens never plays its arrival again: Calm, Off and back; Lively, Calm and back (alpha.24, lead 2’s item 8; the review of uimotion, NOTE-4)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  // Without a chip nothing arrives at all; with one the initial arrival plays exactly once.
  const noChip = await chipless(win);
  const toggle = win.getByTestId(`group-${SECTION}-toggle`);
  for (const [motion, then] of [
    ['calm', ['off', 'calm']],
    ['lively', ['calm', 'lively']],
  ] as const) {
    await interfaceMotion(win, motion);
    await letTimePass(win, 900, 'the show has not changed for a moment, as a fold waits for');
    const started = watchFold(win, 800);
    const { took, running } = await switchAtOnce(win, SECTION, then);
    const moved = await started;
    expect(moved.arrivals, `${motion}: the initial arrival plays once`).toEqual(
      noChip ? [] : [motion === 'calm' ? 'fade-in 200' : 'lively-open 250'],
    );
    // Within the 0.45 s the section once kept its arrival for (foldArrivalMs), the case that replayed.
    console.log(`${motion}, then ${then.join(', then ')}: ${String(took)} ms after the press`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(running, `${motion}, then ${then.join(', then ')}`).toEqual([]);
    await settled(win);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await settled(win);
  }
  await app.close();
});

test('a show control near a fold: insides holding one are there at once, nothing glides past one, and no copy covers one (alpha.24, the release lead’s review: MUST-2, S2, S4)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  // A placeholder lower third (its Show is a show control) and a placeholder timer (its Start, Pause, Reset and Show
  // for the audience are, since the review's S4).
  await win.evaluate(async (look) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.lowerThirds.save(null, {
      lines: ['Placeholder name', 'Placeholder title', ''],
      look,
      where: 'hall',
      animation: 'fade-quick',
    });
    if (!made.ok) throw new Error(made.message);
    const timer = await d.timers.create({
      name: 'Placeholder countdown',
      kind: 'countdown',
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!timer.ok) throw new Error(timer.message);
  }, DEFAULT_LOWER_THIRD_LOOK);
  const noChip = await chipless(win);
  await letTimePass(win, 900, 'the show has not changed for a moment, as a fold waits for');
  for (const motion of ['calm', 'lively'] as const) {
    await interfaceMotion(win, motion);
    await letTimePass(win, 900, 'the show has not changed for a moment, as a fold waits for');
    // Lower Thirds opened: its insides, Show and all, are there at once (S2); and nothing under it glides.
    let pressed = await pressFold(win, 'lower-thirds');
    await expect(win.getByTestId('lower-third-show').first()).toBeVisible();
    await expect(win.getByTestId('lower-third-show').first()).toHaveAttribute('data-show-control', '');
    expect(pressed.arrivals, motion).toEqual([]);
    expect(pressed.glides, motion).toEqual([]);
    // Timers (above it, its timer's buttons now show controls) opened and folded: nothing glides, and no copy is drawn
    // over the Show that comes up under it (MUST-2).
    pressed = await pressFold(win, 'timers');
    await expect(win.getByTestId('timer-show')).toHaveAttribute('data-show-control', '');
    expect(pressed.arrivals, motion).toEqual([]);
    expect(pressed.glides, motion).toEqual([]);
    pressed = await pressFold(win, 'timers');
    expect(pressed.copies, motion).toEqual([]);
    expect(pressed.glides, motion).toEqual([]);
    // Show a Window (under Lower Thirds) opened and folded: Lower Thirds' Show, higher in the column, stays where it is,
    // so the copy is drawn as for any fold (where the LIVE block stands and the column does not scroll back: lead 2's
    // item 8, the copy held as the glides are), and it lies over no show control (the review's MUST-2).
    await pressFold(win);
    const drawn = !noChip && (await standing(win)) && !(await willScrollBack(win));
    const show = win.getByTestId('lower-third-show').first();
    const showAt = await show.boundingBox();
    const insides = await win
      .getByTestId(`group-${SECTION}-toggle`)
      .locator('xpath=ancestor::section[1]')
      .evaluate((section) => {
        const r = section.querySelector('[id$="-body"]')?.getBoundingClientRect();
        return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
      });
    pressed = await pressFold(win);
    expect(pressed.copies, motion).toEqual(drawn ? [motion === 'lively' ? 'fold-lively' : 'fold'] : []);
    expect(await show.boundingBox(), `${motion}: Lower Thirds' Show stays where it is`).toEqual(showAt);
    const under = await win.evaluate((box) => {
      if (!box) return ['no insides'];
      return [...document.querySelectorAll('[data-show-control]')].flatMap((c) => {
        const r = c.getBoundingClientRect();
        const over =
          r.width > 0 && r.top < box.bottom && r.bottom > box.top && r.left < box.right && r.right > box.left;
        return over ? [c.getAttribute('data-testid') ?? c.tagName] : [];
      });
    }, insides);
    expect(under, `${motion}: no show control where the copy lies`).toEqual([]);
    // Lower Thirds folded again for the next round.
    await pressFold(win, 'lower-thirds');
  }
  await app.close();
});

test('a Lively fold at the column’s end: the column scrolls back at once and nothing glides over the heading above (alpha.24, lead 2’s hands-on pass, problem 1)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  const noChip = await chipless(win);
  await interfaceMotion(win, 'lively');
  // Sections that hold no show control, enough to make the column scroll; then the column at its end.
  for (const id of ['messages', 'show-a-window', 'show-a-stream-link', 'qr-code', 'midi', 'osc']) {
    await win.getByTestId(`group-${id}-toggle`).click();
    await expect(win.getByTestId(`group-${id}-toggle`)).toHaveAttribute('aria-expanded', 'true');
  }
  await settled(win);
  const ends = () =>
    win.evaluate(() => {
      for (const id of ['live-scroll', 'live-rest']) {
        const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (el) el.scrollTop = el.scrollHeight;
      }
    });
  await ends();
  await letTimePass(win, 900, 'the show has not changed for a moment, as a fold waits for');
  const scrolled = await win.evaluate(() =>
    ['live-scroll', 'live-rest'].some(
      (id) => (document.querySelector(`[data-testid="${id}"]`)?.scrollTop ?? 0) > 0,
    ),
  );
  expect(scrolled, 'the column scrolls, and is at its end').toBe(true);
  // OSC, the last, folded: the column scrolls back; at once and after, OSC's heading under MIDI's, never over it.
  const heads = () =>
    win.evaluate(() => {
      const box = (id: string) =>
        document
          .querySelector(`[data-testid="group-${id}-toggle"]`)
          ?.closest('header')
          ?.getBoundingClientRect();
      return { midi: box('midi')?.bottom ?? 0, osc: box('osc')?.top ?? 0 };
    });
  const watch = watchFold(win, 800);
  await win.getByTestId('group-osc-toggle').click();
  const atOnce = await heads();
  const moved = await watch;
  await settled(win);
  expect(atOnce.osc, 'OSC under MIDI as it folds').toBeGreaterThanOrEqual(atOnce.midi - 1);
  const after = await heads();
  expect(after.osc).toBeGreaterThanOrEqual(after.midi - 1);
  expect(moved.glides).toEqual([]);
  // No copy where the column scrolls back under it (with a chip, the only case one could be drawn).
  expect(moved.copies, noChip ? 'no chip' : 'with a chip').toEqual([]);
  await app.close();
});

/**
 * At the press that folds Show a Window: its insides' first button's look (its fill, words, edge and corner) and the
 * section's bottom corners, and, a frame later, the same of the copy left behind (null when no copy is drawn). The copy's
 * closed shadow root is kept by wrapping attachShadow in this page from now on.
 */
const copyLook = (win: Page) =>
  win.evaluate(
    () =>
      new Promise<{ live: string; copy: string | null; row: string; corners: string | null }>((resolve) => {
        const w = window as unknown as { shadows?: ShadowRoot[] };
        if (!w.shadows) {
          w.shadows = [];
          const attach = Object.getOwnPropertyDescriptor(Element.prototype, 'attachShadow')?.value as (
            this: Element,
            init: ShadowRootInit,
          ) => ShadowRoot;
          Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
            const root = attach.call(this, init);
            w.shadows?.push(root);
            return root;
          };
        }
        const look = (el: Element | null | undefined) => {
          if (!el) return null;
          const st = getComputedStyle(el);
          return `${st.backgroundColor} ${st.color} ${st.borderTopColor} ${st.borderTopLeftRadius}`;
        };
        const corners = (el: Element | null | undefined) => {
          if (!el) return null;
          const st = getComputedStyle(el);
          return `${st.borderBottomLeftRadius} ${st.borderBottomRightRadius}`;
        };
        // Read now: once the press has folded it, the button is gone from the page and has no look of its own.
        const section = document.querySelector('[data-testid="section-show-a-window"]');
        const live = look(section?.querySelector('[id$="-body"] [data-variant]'));
        const row = corners(section);
        const before = w.shadows.length;
        window.addEventListener(
          'click',
          () => {
            requestAnimationFrame(() => {
              const root = (w.shadows ?? []).slice(before).at(-1);
              resolve({
                live: live ?? 'none',
                copy: look(root?.querySelector('[data-variant]')),
                row: row ?? 'none',
                corners: corners(root?.querySelector('[data-leaving]')),
              });
            });
          },
          { capture: true, once: true },
        );
      }),
  );

/*
 * Follow the computer as it starts, drawn in B · Depth (light on CI's runners), then White and the light, coloured
 * Sandalwood, chosen by name and drawn flat. In Depth the copy takes the window's look too (lead 2's item 3, alpha.24):
 * the filled pills its buttons are, and the rounded row's corners. In every look the copy's button has the live one's
 * fill, words, edge and corner, and the copy the bottom corners of the row it folds out of.
 */
test('a fold’s copy draws in the window’s appearance and look: Follow the computer (Depth), White and Sandalwood, Calm and Lively (alpha.24, lead 2’s hands-on pass of uilook, problem 1; lead 2’s item 3)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  const noChip = await chipless(win);
  for (const look of ['follow', 'white', 'sandalwood'] as const) {
    if (look === 'follow') await expect(win.locator('html')).toHaveAttribute('data-window-look', 'depth');
    else {
      await chooseMenuItem(app, `appearance-${look}`);
      await expect(win.locator('html')).toHaveAttribute('data-appearance', look);
      await expect(win.locator('html')).toHaveAttribute('data-base', 'light');
      await expect(win.locator('html')).toHaveAttribute('data-window-look', 'flat');
    }
    for (const motion of ['calm', 'lively'] as const) {
      await interfaceMotion(win, motion);
      await letTimePass(win, 900, 'the show has not changed for a moment, as a fold waits for');
      await pressFold(win);
      await expect(win.getByTestId(SECTION)).toBeVisible();
      const drawn = (await standing(win)) && !(await willScrollBack(win)) && !noChip;
      const seen = copyLook(win);
      await win.getByTestId(`group-${SECTION}-toggle`).click();
      const { live, copy, row, corners } = await seen;
      await settled(win);
      console.log(
        `${look}, ${motion}: the button ${live}, its copy ${copy ?? 'not drawn'}; the row's corners ${row}, the copy's ${corners ?? 'not drawn'}`,
      );
      // Drawn only with a chip where nothing holds it (ui/fold.ts); then in the window's own appearance and look.
      if (drawn) {
        expect(copy, `${look}, ${motion}`).toBe(live);
        expect(corners, `${look}, ${motion}: the corners`).toBe(row);
      } else {
        expect(copy, `${look}, ${motion}`).toBeNull();
        expect(corners, `${look}, ${motion}: the corners`).toBeNull();
      }
    }
  }
  await app.close();
});

/**
 * At the press that folds Show a Window: a frame later, the colour of the middle of the copy's probe canvas (as `r g b a`),
 * or null when no copy is drawn. The copy's closed shadow root is kept by wrapping attachShadow, as copyLook does.
 */
const copiedCanvas = (win: Page) =>
  win.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const w = window as unknown as { shadows?: ShadowRoot[] };
        if (!w.shadows) {
          w.shadows = [];
          const attach = Object.getOwnPropertyDescriptor(Element.prototype, 'attachShadow')?.value as (
            this: Element,
            init: ShadowRootInit,
          ) => ShadowRoot;
          Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
            const root = attach.call(this, init);
            w.shadows?.push(root);
            return root;
          };
        }
        const before = w.shadows.length;
        window.addEventListener(
          'click',
          () => {
            requestAnimationFrame(() => {
              const canvas = (w.shadows ?? [])
                .slice(before)
                .at(-1)
                ?.querySelector<HTMLCanvasElement>('canvas[data-probe]');
              const pixel = canvas?.getContext('2d')?.getImageData(4, 4, 1, 1).data;
              resolve(pixel ? [...pixel].join(' ') : null);
            });
          },
          { capture: true, once: true },
        );
      }),
  );

test('a fold’s copy shows what its canvases showed, never blank (alpha.24, lead 2’s item 12; the review of uimotion, a NIT)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  const noChip = await chipless(win);
  for (const motion of ['calm', 'lively'] as const) {
    await interfaceMotion(win, motion);
    await letTimePass(win, 900, 'the show has not changed for a moment, as a fold waits for');
    await pressFold(win);
    await expect(win.getByTestId(SECTION)).toBeVisible();
    // A canvas in its insides, as a level meter or a picture is: a placeholder colour drawn on it.
    await win.getByTestId(SECTION).evaluate((el) => {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      c.dataset['probe'] = '';
      const g = c.getContext('2d');
      if (g) {
        g.fillStyle = 'rgb(200, 30, 40)';
        g.fillRect(0, 0, 8, 8);
      }
      el.append(c);
    });
    const drawn = !noChip && (await standing(win)) && !(await willScrollBack(win));
    const seen = copiedCanvas(win);
    await win.getByTestId(`group-${SECTION}-toggle`).click();
    const pixel = await seen;
    await settled(win);
    console.log(`${motion}: the copy's canvas ${pixel ?? 'not drawn'}`);
    expect(pixel, motion).toBe(drawn ? '200 30 40 255' : null);
  }
  await app.close();
});

test('without a graphics chip a fold moves nothing, in Calm or Lively (alpha.24; the show changing: ui/fold.test.ts)', async () => {
  test.setTimeout(120_000);
  // Without a chip (as CI's Windows always is): Calm and Lively alike.
  const chipOff = await launchApp({ DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software' });
  const win = await operatorPage(chipOff.app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  expect(await chipless(win)).toBe(true);
  await letTimePass(win, 900, 'the show has not changed for a moment, as a fold waits for');
  for (const motion of ['calm', 'lively'] as const) {
    await interfaceMotion(win, motion);
    for (let i = 0; i < 2; i++) {
      const pressed = await pressFold(win);
      expect(pressed, motion).toEqual({
        glides: [],
        copies: [],
        arrivals: [],
        topAtOnce: await belowTop(win),
      });
      expect(await arrival(win)).toMatch(/^(none none none 0s|no body)$/u);
    }
  }
  await chipOff.app.close();
});

test('a new install starts in Lively and keeps it; a computer that had Drashti before starts as it was, Calm until chosen (alpha.24)', async () => {
  test.setTimeout(120_000);
  // An installed Drashti's own new install (the other specs start in Calm: DRASHTI_TEST_MOTION_AT_START, helpers.ts).
  const asInstalled = { DRASHTI_TEST_MOTION_AT_START: '' };
  const { app, userData } = await launchApp(asInstalled);
  const win = await operatorPage(app);
  await expect(win.locator('html')).toHaveAttribute('data-interface-motion', 'lively');
  await operatorReady(win);
  await app.close();
  const again = await relaunchApp(userData, asInstalled);
  const next = await operatorPage(again.app);
  await expect(next.locator('html')).toHaveAttribute('data-interface-motion', 'lively');
  await operatorReady(next);
  await again.app.close();

  // Started before alpha.24 (a data folder Drashti has run in, nothing chosen in the Appearance window): Calm.
  const before = await launchApp();
  const old = await operatorPage(before.app);
  await expect(old.locator('html')).toHaveAttribute('data-interface-motion', 'calm');
  await operatorReady(old);
  await before.app.close();
  const updated = await relaunchApp(before.userData, asInstalled);
  const now = await operatorPage(updated.app);
  await expect(now.locator('html')).toHaveAttribute('data-interface-motion', 'calm');
  await operatorReady(now);
  await updated.app.close();
});

test('the controls that are not show controls answer: a press dims, Lively lifts one pointed at, the focus ring is there at once; a show control never does (alpha.24)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  const noChip = await chipless(win);
  const style = (sel: string, ...names: string[]) =>
    win
      .locator(sel)
      .first()
      .evaluate((el, n) => n.map((name) => getComputedStyle(el).getPropertyValue(name)).join(' | '), names);
  // A button that is not a show control: its focus ring is there at once, 2 px wide and 2 px out, nothing of it moving
  // (lead 2's decision on the hands-on pass, problem 3: only transform and opacity move).
  const network = '[data-testid="open-network"]';
  expect(await style(network, 'transition-property')).not.toContain('outline');
  await win.locator(network).focus();
  await win.keyboard.press('Shift+Tab');
  await win.keyboard.press('Tab');
  await expect(win.locator(network)).toBeFocused();
  expect(await style(network, 'outline-style', 'outline-width', 'outline-offset')).toBe('solid | 2px | 2px');
  // A press dims it by its opacity, held (the pointer let go elsewhere, so nothing is pressed).
  await win.locator(network).hover();
  await win.mouse.down();
  // Polled: with a chip the dimming takes --dur-hover.
  await expect.poll(() => style(network, 'opacity', 'filter')).toBe(noChip ? '1 | none' : '0.85 | none');
  await win.mouse.move(2, 2);
  await win.mouse.up();
  // Let go, it is at once as it was.
  expect(await style(network, 'opacity')).toBe('1');
  // Lively: pointed at, it lifts a pixel (with a chip).
  await interfaceMotion(win, 'lively');
  await win.locator(network).hover();
  await expect.poll(() => style(network, 'translate')).toBe(noChip ? 'none' : '0px -1px');
  await win.mouse.move(2, 2);
  // Audience and Stage change the hall's screens (uitop; the release lead's review, MUST-2): pointed at and held, with a
  // chip or without, they stay as they are: no dimming, no lift, no press, nothing moving. Let go away from it: no click.
  const stage = '[data-testid="switch-stage"]';
  await win.locator(stage).hover();
  await win.mouse.down();
  expect(await style(stage, 'opacity', 'translate', 'transform', 'transition-property')).toBe(
    '1 | none | none | none',
  );
  expect(await win.locator(stage).evaluate((el) => el.getAnimations().length)).toBe(0);
  await win.mouse.move(2, 2);
  await win.mouse.up();
  // A show control, pointed at: no transition, no lift, no dimming.
  await win.getByTestId('show-next').hover();
  expect(
    await style('[data-testid="show-next"]', 'transition-property', 'translate', 'filter', 'opacity'),
  ).toBe('none | none | none | 1');
  // A menu's choices have no transition at all (as before alpha.24; the review's S6).
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click({ button: 'right' });
  await expect(win.getByRole('menu')).toBeVisible();
  expect(await style('[role="menu"] [role^="menuitem"]', 'transition-duration')).toBe('0s');
  await win.keyboard.press('Escape');
  await app.close();
});
