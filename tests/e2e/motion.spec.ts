import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

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
  await win.getByTestId('playlist-item').first().click();
  const card = win.getByTestId('item-media');
  await card.click();
  await expect(card).toHaveAttribute('aria-current', 'true');
  // The picture's card, live, its border and glow red: still.
  await card.hover();
  expect(await moving(win, '[data-testid="item-media"], [data-testid="live-preview"]')).toEqual([]);
  const presentation = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.library.listPresentations())[0]?.id ?? '',
  );
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await dispatch(win, { type: 'goLive', presentationId: presentation, slideIndex: 0 });
  await expect(win.getByTestId('slide-thumb').first()).toHaveAttribute('aria-current', 'true');

  const SHOW =
    '[data-testid="layer-bar"] button, [data-testid="slide-thumb"], [data-testid="item-media"], [data-testid="live-preview"], [data-testid="look-button"]';
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
  await win.locator('[data-move="up"]').click();
  expect(await watch).toContain(180);
  await expect(rows.first()).toHaveAttribute('data-item-id', moved ?? '');
  await app.close();
});

test('with the computer set to reduce motion, nothing in the window moves at all', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await operatorReady(win);
  /** Anything in the window that moves, except the pictures of the screens (what the hall sees). */
  const still = async (what: string) => {
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
  };
  await still('the window');
  await win.keyboard.press('Shift+Slash');
  await expect(win.getByTestId('keys-sheet')).toBeVisible();
  await still('a dialog');
  await win.keyboard.press('Escape');
  await still('a dialog closing');
  await win.getByRole('button', { name: 'Themes' }).click();
  await still('a side sheet');
  await win.keyboard.press('Escape');
  await win.getByTestId('presentation-list').getByRole('button').first().click({ button: 'right' });
  await expect(win.getByRole('menu')).toBeVisible();
  await still('a menu');
  await win.keyboard.press('Escape');
  await win.getByTestId('what-is-this-live').click();
  await still('What is this?');
  // A playlist row moving.
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
  await win
    .getByTestId('playlist-node')
    .filter({ hasText: /^Placeholder still/u })
    .click();
  await win.getByTestId('playlist-item').nth(1).click();
  await win.locator('[data-move="up"]').click();
  await still('a row moving up');
  await app.close();
});
