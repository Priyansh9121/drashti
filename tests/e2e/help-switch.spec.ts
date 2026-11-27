import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { LowerThirdInput } from '../../src/shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../src/shared/lower-thirds';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  openAllSections,
  openSection,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';
import { CI_WINDOW, liveColumnToTop } from './window-size';

/*
 * Help on demand (alpha.24, the owner's "we also want a really innovative and non-congusted UI"): the status bar's Help
 * switch, where its ? was, is off at a first start. Off, no ? is drawn anywhere (so none is a Tab stop) and the keys
 * beside the buttons' words are hidden to the eye, each button still read out with its key; Alt (Option on a Mac) held
 * on its own shows the keys while it is held, and a look at them never gives Windows' menu bar the keyboard. On, every ?
 * and every key shows as before. It is remembered on this computer. Simple Mode the same, with no ? of its own.
 */

/**
 * Whether a key is where the eye sees it. Hidden to the eye it is a box of 1 px, or (in a show control, which keeps
 * its room) drawn see-through; read out all the same either way.
 */
const seen = (key: Locator) =>
  key.evaluate((k) => {
    if (k.getBoundingClientRect().width <= 1) return false;
    for (let at: Element | null = k; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.visibility !== 'visible' || Number(style.opacity) < 0.05) return false;
    }
    return true;
  });

/**
 * Every show control along the bottom, in the quick bar and under LIVE (Back, Next, Oops), and the Undo line's Undo:
 * where each is and how big, and where its first word or icon is (what the eye is on: Next's "Next", a pin's icon, the
 * bar's words), its key never counted.
 */
const keyedButtons = (win: Page) =>
  win.evaluate(() => {
    const at = (r: DOMRect) =>
      `${r.left.toFixed(1)}, ${r.top.toFixed(1)}, ${r.width.toFixed(1)} × ${r.height.toFixed(1)}`;
    const first = (el: Element): string => {
      for (const part of el.childNodes) {
        if (part.nodeType === Node.TEXT_NODE) {
          if (part.textContent?.trim() === '') continue;
          const range = document.createRange();
          range.selectNodeContents(part);
          const r = range.getBoundingClientRect();
          if (r.width > 0) return `“${part.textContent?.trim() ?? ''}” at ${at(r)}`;
          continue;
        }
        if (!(part instanceof Element) || part.matches('kbd, [data-keys]')) continue;
        const r = part.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) return `${part.tagName.toLowerCase()} at ${at(r)}`;
      }
      return 'nothing';
    };
    return [
      ...document.querySelectorAll(
        '[data-zone="bar"] button, [data-testid="quick-bar"] button, [data-testid="show-back"], [data-testid="show-next"], [data-testid="show-oops"], [data-testid="undo-removal"] button',
      ),
    ]
      .filter((el) => el.getClientRects().length > 0 && !el.matches('[data-what-is-this]'))
      .map((el) => {
        const name = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent.trim();
        return `${name}: ${at(el.getBoundingClientRect())}; first ${first(el)}`;
      });
  });

/**
 * The window laid out at `size` after a resize, then what keyedButtons reads, once every box has held still for half a
 * second (the columns take their widths from the window's after its resize event, a frame or more later: the Mac's
 * CI read them mid-way once). It waits for that, then measures; it changes nothing that is compared.
 */
async function settledButtons(win: Page, size: { width: number; height: number }): Promise<string[]> {
  await expect
    .poll(() => win.evaluate(() => [window.innerWidth, window.innerHeight]), {
      message: `the page at ${String(size.width)} × ${String(size.height)}`,
    })
    .toEqual([size.width, size.height]);
  return stillFor(() => keyedButtons(win), `at ${String(size.width)} × ${String(size.height)}`);
}

/** What `read` reads once it has read the same for half a second (the layout settled); it waits, it compares nothing. */
async function stillFor(read: () => Promise<string[]>, where: string): Promise<string[]> {
  let last = '';
  let since = 0;
  let got: string[] = [];
  await expect
    .poll(
      async () => {
        got = await read();
        const now = JSON.stringify(got);
        if (now !== last) {
          last = now;
          since = Date.now();
        }
        return Date.now() - since >= 500;
      },
      { message: `every box still for half a second ${where}`, intervals: [100] },
    )
    .toBe(true);
  return got;
}

/** Under LIVE: every section's heading toggle and the timers' Show, where each is and how big. */
const liveParts = (win: Page) =>
  win.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="live-column"] [data-testid="timer-show"], [data-testid="live-column"] [data-testid^="group-"][data-testid$="-toggle"]',
      ),
    ]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.getAttribute('data-testid') ?? ''}: ${r.left.toFixed(1)}, ${r.top.toFixed(1)}, ${r.width.toFixed(1)} × ${r.height.toFixed(1)}`;
      }),
  );

/** Every ? in the window. */
const asks = (win: Page) => win.locator('[data-what-is-this]');

/** Hold Alt for a look at the keys (as long as an operator does: past the half second that makes it a look). */
async function lookWithAlt(win: Page, key: Locator): Promise<void> {
  const focused = () => win.evaluate(() => document.hasFocus());
  const before = await focused();
  await win.keyboard.down('Alt');
  await expect.poll(() => seen(key), { message: 'the key shown while Alt is held' }).toBe(true);
  await holdStill(
    async () => (await seen(key)) && (await asks(win).count()) === 0,
    600,
    'Alt held for a look: the keys stay, and no ? comes with them',
  );
  await win.keyboard.up('Alt');
  await expect.poll(() => seen(key), { message: 'the key hidden once Alt is let go' }).toBe(false);
  // The window keeps the keyboard as it had it: no menu bar took it (Windows).
  expect(await focused()).toBe(before);
}

test('Pro Mode: Help off at a first start: no ?, the keys hidden but read out, Alt held shows them; Help on shows every ? and key, remembered on this computer', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const help = win
    .getByRole('contentinfo', { name: 'Status' })
    .getByRole('button', { name: 'Help', exact: true });
  await expect(help).toHaveAttribute('data-testid', 'help-toggle');
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  // No ? anywhere: there were 12 in sight at this size until alpha.24.
  await expect(asks(win)).toHaveCount(0);
  const next = win.getByTestId('show-next');
  const nextKey = next.locator('kbd');
  const clearAll = win.getByTestId('layer-bar').getByRole('button', { name: /^Clear all/u });
  const clearAllKey = clearAll.locator('kbd');
  await expect.poll(() => seen(nextKey)).toBe(false);
  await expect.poll(() => seen(clearAllKey)).toBe(false);
  // Read out with its key all the same.
  await expect(next).toHaveAccessibleName(/^Next\s*→$/u);
  await expect(clearAll).toHaveAccessibleName(/^Clear all\s*F1$/u);
  await expectNoSeriousA11yIssues(win, 'Help off');

  await lookWithAlt(win, nextKey);
  // Alt with another key is a shortcut, not Alt on its own: the keys hide.
  await win.keyboard.down('Alt');
  await expect.poll(() => seen(clearAllKey)).toBe(true);
  await win.keyboard.down('Shift');
  await expect.poll(() => seen(clearAllKey)).toBe(false);
  await win.keyboard.up('Shift');
  await win.keyboard.up('Alt');

  // Help on: every ? and key as before.
  await help.click();
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect(win.getByTestId('what-is-this-live')).toBeVisible();
  await expect(win.getByTestId('what-is-this-statusbar')).toBeVisible();
  await expect(win.getByTestId('what-is-this-controls')).toBeVisible();
  // In CI's 1024 × 645 the switch is its round ? alone, in the ?'s own 24 px, and the bar's own ? goes (as the
  // header's do below 1280 px), so the bar holds no more than before: nothing runs past the window.
  await win.setViewportSize({ width: 1024, height: 645 });
  await expect(win.getByTestId('what-is-this-statusbar')).toBeHidden();
  await expect.poll(async () => (await help.boundingBox())?.width).toBe(24);
  await expect(help).toHaveAccessibleName('Help');
  await expect
    .poll(() => win.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
      message: 'the page does not scroll sideways at 1024 × 645',
    })
    .toBe(true);
  await win.setViewportSize({ width: 1280, height: 720 });
  await expect(win.getByTestId('what-is-this-statusbar')).toBeVisible();
  await expect.poll(() => seen(nextKey)).toBe(true);
  await expect.poll(() => seen(clearAllKey)).toBe(true);
  await expect(next).toHaveAccessibleName(/^Next\s*→$/u);
  await expect(clearAll).toHaveAccessibleName(/^Clear all\s*F1$/u);
  // A ? opens its words as before.
  await win.getByTestId('what-is-this-live').click();
  const card = win.getByTestId('what-is-this');
  await expect(card).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Help on, a ? open');
  // Help off, by the keyboard: the card and every ? go, the keys hide; on again, the card is not open again.
  await help.focus();
  await win.keyboard.press('Enter');
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  await expect(card).toHaveCount(0);
  await expect(asks(win)).toHaveCount(0);
  await expect.poll(() => seen(nextKey)).toBe(false);
  await win.keyboard.press('Enter');
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect(win.getByTestId('what-is-this-live')).toBeVisible();
  await expect(card).toHaveCount(0);
  await app.close();

  // Remembered on this computer: on after a new start, and off again once turned off.
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await win2.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win2);
  const help2 = win2.getByTestId('help-toggle');
  await expect(help2).toHaveAttribute('aria-pressed', 'true');
  await expect(win2.getByTestId('what-is-this-live')).toBeVisible();
  await help2.click();
  await expect(asks(win2)).toHaveCount(0);
  await again.app.close();
  const third = await relaunchApp(userData);
  const win3 = await operatorPage(third.app);
  await operatorReady(win3);
  await expect(win3.getByTestId('help-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(asks(win3)).toHaveCount(0);
  await third.app.close();
});

test('Simple Mode: the keys hidden at rest, Alt held shows them, Help on shows them; never a ?', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const help = win
    .getByRole('contentinfo', { name: 'Status' })
    .getByRole('button', { name: 'Help', exact: true });
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  const blackout = win.getByTestId('simple-blackout');
  const blackoutKey = blackout.locator('kbd');
  const nextKey = win.getByTestId('show-next').locator('kbd');
  await expect.poll(() => seen(blackoutKey)).toBe(false);
  await expect.poll(() => seen(nextKey)).toBe(false);
  await expect(blackout).toHaveAccessibleName(/^Black-out\s*B$/u);
  await lookWithAlt(win, blackoutKey);
  await help.click();
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => seen(blackoutKey)).toBe(true);
  await expect.poll(() => seen(nextKey)).toBe(true);
  await expect(asks(win)).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'Simple Mode, Help on');
  await app.close();
});

/** A lower third, placeholder words only: one deleted is a change the Undo line says. */
const lowerThird = (name: string): LowerThirdInput => ({
  lines: [name, 'Placeholder title', ''],
  look: DEFAULT_LOWER_THIRD_LOOK,
  where: 'hall',
  animation: 'fade-quick',
});

test('nothing moves as the keys come and go: Help off, Alt held and Help on draw every show control and the Undo line, and what is on them, in place, at 1024 × 645 and 1440 × 820, in Pro and Simple Mode', async () => {
  test.setTimeout(150_000);
  // The Undo line's clock held (its test switch), so it stays while it is measured.
  const { app } = await launchApp({ DRASHTI_TEST_UNDO_LINE: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  // Two pins in the quick bar (Pro Mode's), so its keys are measured too.
  const set = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.quickBar.set([
      { kind: 'message', templateId: 'placeholder-message-1', label: 'Placeholder hello' },
      { kind: 'message', templateId: 'placeholder-message-2', label: 'Placeholder thanks' },
    ]),
  );
  expect(set.ok).toBe(true);
  await expect(win.getByTestId('quick-bar').getByRole('button')).toHaveCount(2);
  // A lower third deleted with its trash: the Undo line at the left column's foot, with Undo and its key.
  await win.evaluate(async (i) => {
    const made = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, i);
    if (!made.ok) throw new Error(made.message);
  }, lowerThird('Placeholder one'));
  await openSection(win, 'lower-thirds');
  await win.getByTestId('lower-thirds-panel').getByTestId('lower-third-delete').click();
  const undoLine = win.getByTestId('undo-removal');
  await expect(undoLine).toContainText('Deleted “Placeholder one”');
  const help = win.getByTestId('help-toggle');
  const nextKey = win.getByTestId('show-next').locator('kbd');
  for (const mode of ['pro', 'simple'] as const) {
    if (mode === 'simple') {
      await chooseMenuItem(app, 'switch-mode');
      await expect(win.getByTestId('simple-mode')).toBeVisible();
    }
    for (const size of [CI_WINDOW, { width: 1440, height: 820 }]) {
      const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}`;
      await win.setViewportSize(size);
      await expect(help).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => seen(nextKey), { message: `${where}: Next's key hidden` }).toBe(false);
      if (mode === 'pro') await expect(undoLine.getByRole('button', { name: /^Undo/u })).toBeVisible();
      // Measured once the resize has settled (the Mac's CI once read the boxes 17 ms after it, mid-layout).
      const atRest = await settledButtons(win, size);
      expect(atRest.length, `${where}: what is measured`).toBeGreaterThanOrEqual(mode === 'pro' ? 14 : 8);
      // Alt held for a look: the keys come, and nothing moves all the while it is held.
      await win.keyboard.down('Alt');
      await expect.poll(() => seen(nextKey), { message: `${where}: Next's key shown with Alt` }).toBe(true);
      await holdStill(
        async () => JSON.stringify(await keyedButtons(win)) === JSON.stringify(atRest),
        600,
        `${where}: Alt held, every one where it was`,
      );
      expect(await keyedButtons(win), `${where}: Alt held`).toEqual(atRest);
      await win.keyboard.up('Alt');
      await expect.poll(() => seen(nextKey), { message: `${where}: Next's key hidden again` }).toBe(false);
      expect(await keyedButtons(win), `${where}: Alt let go`).toEqual(atRest);
      // Help on: the keys come, and nothing moves; Help off again.
      await help.dispatchEvent('click');
      await expect(help).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(() => seen(nextKey), { message: `${where}: Next's key shown with Help on` })
        .toBe(true);
      expect(await keyedButtons(win), `${where}: Help on`).toEqual(atRest);
      await help.dispatchEvent('click');
      await expect(help).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => seen(nextKey)).toBe(false);
      expect(await keyedButtons(win), `${where}: Help off again`).toEqual(atRest);
    }
  }
  await app.close();
});

test('in forced colours (a contrast theme), Help pressed and not pressed look different', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await win.emulateMedia({ forcedColors: 'active' });
  const help = win.getByTestId('help-toggle');
  const ground = () => help.evaluate((b) => getComputedStyle(b).backgroundColor);
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  const off = await ground();
  await help.dispatchEvent('click');
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(ground, { message: 'Help on draws a ground of its own' }).not.toBe(off);
  await win.emulateMedia({ forcedColors: 'none' });
  await app.close();
});

test('turning Help on or off moves nothing under LIVE: the timers’ Show and every section stay put, at 1024 × 645 and 1410 × 900, in Pro and Simple Mode', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // A timer, so the Timers section has its Show for the audience; every section open (Pro Mode's).
  await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.timers.create({
      name: 'Placeholder timer',
      kind: 'countdown',
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!made.ok) throw new Error(made.message);
  });
  await openAllSections(win);
  await expect(win.getByTestId('timers').getByTestId('timer-show')).toHaveCount(1);
  const help = win.getByTestId('help-toggle');
  const live = win.getByRole('complementary', { name: 'Live' });
  for (const mode of ['pro', 'simple'] as const) {
    if (mode === 'simple') {
      await chooseMenuItem(app, 'switch-mode');
      await expect(win.getByTestId('simple-mode')).toBeVisible();
    }
    for (const size of [CI_WINDOW, { width: 1410, height: 900 }]) {
      const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}`;
      await win.setViewportSize(size);
      await expect
        .poll(() => win.evaluate(() => [window.innerWidth, window.innerHeight]))
        .toEqual([size.width, size.height]);
      await liveColumnToTop(live);
      await expect(help).toHaveAttribute('aria-pressed', 'false');
      const atRest = await stillFor(() => liveParts(win), `under LIVE, ${where}`);
      expect(atRest.length, `${where}: the sections measured`).toBeGreaterThanOrEqual(
        mode === 'pro' ? 13 : 1,
      );
      // Help on: the ? come (the Timers heading's among them), and nothing under LIVE moves.
      await help.dispatchEvent('click');
      await expect(help).toHaveAttribute('aria-pressed', 'true');
      if (mode === 'pro') await expect(win.getByTestId('what-is-this-timers')).toBeVisible();
      expect(await stillFor(() => liveParts(win), `with Help on, ${where}`), `${where}: Help on`).toEqual(
        atRest,
      );
      // Help off again: they go, and nothing moves.
      await help.dispatchEvent('click');
      await expect(help).toHaveAttribute('aria-pressed', 'false');
      await expect(win.locator('[data-what-is-this]')).toHaveCount(0);
      expect(
        await stillFor(() => liveParts(win), `with Help off again, ${where}`),
        `${where}: Help off`,
      ).toEqual(atRest);
    }
  }
  await app.close();
});
