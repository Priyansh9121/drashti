import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { NETWORK_ENV, networkOn } from './devices';
import { settledRead } from './help';
import { chooseMenuItem, holdStill, launchApp, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW } from './window-size';

/*
 * Every "What is this?" a target of at least 24 × 24 px (WCAG 2.5.8, the redesign's rule; qtargets, alpha.24): the top
 * bar's beside Stream, Phones and Announcements were 20 × 20 px until then (uitop's hands-on pass, row 21). Each is now a
 * 24 px target in the 20 px room it had, so the bar holds what it held; and the top bar keeps that room while Help is
 * off, so Help turned on draws each ? in it and moves nothing there (help-switch.spec.ts's rule for the show controls'
 * keys, here for the top bar). In CI's 1024 × 645 and the owner's 1410 × 900, Pro Mode with Phones off and on (the
 * Announcements ? then too, from 1280 px), and Simple Mode, which has no ? of its own.
 */

/** The controls of a target: what fit.ts counts as one. */
const CONTROLS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [role="spinbutton"]';

/**
 * The top bar in sight (Pro Mode's or Simple Mode's): its name, its states and every control in it but its ?, each
 * where it is and how big.
 */
const topBar = (win: Page) =>
  win.evaluate((controls) => {
    const at = (r: DOMRect) =>
      `${r.left.toFixed(1)}, ${r.top.toFixed(1)}, ${r.width.toFixed(1)} × ${r.height.toFixed(1)}`;
    const bars = [...document.querySelectorAll('header[data-header]')].filter(
      (h) => h.getClientRects().length > 0,
    );
    if (bars.length !== 1) return [`${String(bars.length)} top bars in sight`];
    const bar = bars[0];
    if (!bar) return [];
    return [...bar.querySelectorAll(`h1, [data-header-states], [data-top-group], ${controls}`)]
      .filter((el) => el.getClientRects().length > 0 && !el.matches('[data-what-is-this]'))
      .map((el) => {
        const name = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent.trim();
        return `${el.tagName.toLowerCase()} ${name}: ${at(el.getBoundingClientRect())}`;
      });
  }, CONTROLS);

/** Every ? in sight: its name and its box. */
const asksInSight = (win: Page) =>
  win.evaluate(() =>
    [...document.querySelectorAll('[data-what-is-this]')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.getAttribute('aria-label') ?? '', width: r.width, height: r.height };
      }),
  );

/**
 * A ? lying over another target, in words (more than half a pixel each way, as fit.ts counts it): a 24 px ? in a 20 px
 * room reaches into the gaps beside it, never onto what is past them.
 */
const asksOverOthers = (win: Page) =>
  win.evaluate((controls) => {
    const out: string[] = [];
    const inSight = (el: Element) => el.getClientRects().length > 0;
    const others = [...document.querySelectorAll(controls)].filter(inSight);
    for (const ask of [...document.querySelectorAll('[data-what-is-this]')].filter(inSight)) {
      const a = ask.getBoundingClientRect();
      for (const other of others) {
        if (other === ask || other.contains(ask) || ask.contains(other)) continue;
        const b = other.getBoundingClientRect();
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (across > 0.5 && down > 0.5) {
          const name =
            other.getAttribute('data-testid') ?? other.getAttribute('aria-label') ?? other.textContent.trim();
          out.push(
            `${ask.getAttribute('aria-label') ?? ''} over ${name.slice(0, 40)} (${across.toFixed(1)} × ${down.toFixed(1)} px)`,
          );
        }
      }
    }
    return out;
  }, CONTROLS);

test('every What is this? is a target of at least 24 × 24 px, over no other, and Help turned on moves nothing in the top bar, at 1024 × 645 and 1410 × 900, in Pro Mode (Phones off and on) and Simple Mode', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const help = win.getByTestId('help-toggle');
  const asks = win.locator('[data-what-is-this]');
  const header = (id: string) => win.getByTestId('app-header').getByTestId(`what-is-this-${id}`);
  const steps = [
    { mode: 'pro', phones: false },
    { mode: 'pro', phones: true },
    { mode: 'simple', phones: true },
  ] as const;
  for (const { mode, phones } of steps) {
    if (mode === 'pro' && phones) {
      await networkOn(win);
      await expect(win.getByTestId('open-announcements')).toBeVisible();
    }
    if (mode === 'simple') {
      await chooseMenuItem(app, 'switch-mode');
      await expect(win.getByTestId('simple-mode')).toBeVisible();
    }
    for (const size of [CI_WINDOW, { width: 1410, height: 900 }]) {
      const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode, Phones ${phones ? 'on' : 'off'}, at ${String(size.width)} × ${String(size.height)}`;
      await win.setViewportSize(size);
      await expect(help).toHaveAttribute('aria-pressed', 'false');
      await expect(asks).toHaveCount(0);
      const atRest = await settledRead(win, size, () => topBar(win), `${where}: the top bar`);
      expect(atRest.length, `${where}: what is measured`).toBeGreaterThanOrEqual(mode === 'pro' ? 9 : 3);

      // Help on: each ? in its room, and nothing in the top bar moves, then or after.
      await help.dispatchEvent('click');
      await expect(help).toHaveAttribute('aria-pressed', 'true');
      expect(await topBar(win), `${where}: Help on`).toEqual(atRest);
      if (mode === 'pro') {
        // Below 1280 px with Phones on the top bar's ? go (top-bar.ts), Help on or off; each panel has its own.
        const inBar =
          phones && size.width < 1280 ? [] : ['stream', 'phones', ...(phones ? ['announcements'] : [])];
        for (const id of inBar) await expect(header(id), `${where}: ${id}'s ?`).toBeVisible();
        if (inBar.length === 0) await expect(header('stream')).toBeHidden();
      } else await expect(asks).toHaveCount(0);
      await holdStill(
        async () => JSON.stringify(await topBar(win)) === JSON.stringify(atRest),
        600,
        `${where}: Help on, every top bar control where it was`,
      );

      // Every ? in sight at least 24 × 24 px, and none over another target.
      const shown = await asksInSight(win);
      if (mode === 'pro') expect(shown.length, `${where}: the ? in sight`).toBeGreaterThanOrEqual(8);
      expect(
        shown
          .filter((a) => a.width < 24 || a.height < 24)
          .map((a) => `${a.name}: ${a.width.toFixed(1)} × ${a.height.toFixed(1)}`),
        `${where}: every ? at least 24 × 24 px`,
      ).toEqual([]);
      expect(await asksOverOthers(win), `${where}: a ? over another target`).toEqual([]);
      // The top bar still fits: nothing past the window's edge, nothing scrolls sideways.
      expect(
        await win.evaluate(() => {
          const out: string[] = [];
          if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways');
          for (const bar of document.querySelectorAll<HTMLElement>('header[data-header]')) {
            if (bar.getClientRects().length === 0) continue;
            if (bar.scrollWidth > bar.clientWidth + 1) out.push('the top bar scrolls sideways');
            for (const el of bar.querySelectorAll('button, [role="switch"], [data-what-is-this]'))
              if (el.getClientRects().length > 0 && el.getBoundingClientRect().right > innerWidth + 0.5)
                out.push(`${el.getAttribute('data-testid') ?? el.textContent.trim()} past the window's edge`);
          }
          return out;
        }),
        `${where}: the top bar fits with Help on`,
      ).toEqual([]);

      // Help off again: the ? go, and still nothing has moved.
      await help.dispatchEvent('click');
      await expect(help).toHaveAttribute('aria-pressed', 'false');
      await expect(asks).toHaveCount(0);
      expect(await topBar(win), `${where}: Help off again`).toEqual(atRest);
    }
  }
  await app.close();
});
