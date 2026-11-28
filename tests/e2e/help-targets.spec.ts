import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { NETWORK_ENV, networkOn } from './devices';
import { settledRead } from './help';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  openAllSections,
  operatorPage,
  operatorReady,
} from './helpers';
import { CI_WINDOW } from './window-size';

/*
 * Every "What is this?" a target of at least 24 × 24 px (WCAG 2.5.8, the redesign's rule; qtargets, alpha.24): the top
 * bar's beside Stream, Phones and Announcements were 20 × 20 px until then (uitop's hands-on pass, row 21). Each is now a
 * 24 px target in the 20 px room it had, held while Help is off too (topbar, alpha.24, item 6), so the bar's group and
 * every persistent control keep their places as Help changes. The sections under LIVE hold still as Help turns on
 * (0 px, help-switch.spec.ts's rule for the show controls' keys): each heading keeps its one row with its ?, and no
 * section moves. In CI's 1024 × 645 and the
 * owner's 1410 × 900, Pro Mode with Phones off and on (the Announcements ? then too, from 1280 px) and every section
 * under LIVE open, and Simple Mode, which has no ? of its own.
 */

/** The controls of a target: what fit.ts counts as one. */
const CONTROLS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [role="spinbutton"]';

/**
 * What Help may change, measured: the top bar in sight (Pro Mode's or Simple Mode's): every control in it but its ?,
 * how big (`sizes`) and where (`places`), its group's width and how many ? are in it; and the column under LIVE: the
 * LIVE block's height, and each section's and its heading's box in the sections' own place (whatever it has scrolled).
 */
const layout = (win: Page) =>
  win.evaluate((controls) => {
    const seen = (el: Element) => el.getClientRects().length > 0;
    const px = (n: number) => n.toFixed(1);
    const nameOf = (el: Element) =>
      el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40);
    const bars = [...document.querySelectorAll('header[data-header]')].filter(seen);
    const bar = bars.length === 1 ? bars[0] : undefined;
    const parts = bar
      ? [...bar.querySelectorAll(controls)].filter((el) => seen(el) && !el.matches('[data-what-is-this]'))
      : [];
    const group = bar?.querySelector('[data-top-group]');
    const top = {
      bars: bars.length,
      sizes: parts.map((el) => {
        const r = el.getBoundingClientRect();
        return `${nameOf(el)}: ${px(r.width)} × ${px(r.height)}`;
      }),
      places: parts.map((el) => {
        const r = el.getBoundingClientRect();
        return `${nameOf(el)}: ${px(r.left)}, ${px(r.top)}`;
      }),
      group: group ? group.getBoundingClientRect().width : null,
      asks: bar ? [...bar.querySelectorAll('[data-what-is-this]')].filter(seen).length : 0,
    };
    const live: string[] = [];
    const still = document.querySelector('[data-testid="live-still"]');
    const rest = document.querySelector('[data-testid="live-rest"]');
    if (still && seen(still)) live.push(`the LIVE block: ${px(still.getBoundingClientRect().height)} tall`);
    if (rest && seen(rest)) {
      const r0 = rest.getBoundingClientRect();
      const at = (r: DOMRect) =>
        `${px(r.left - r0.left)}, ${px(r.top - r0.top + rest.scrollTop)}, ${px(r.width)} × ${px(r.height)}`;
      for (const section of rest.querySelectorAll('section')) {
        if (!seen(section)) continue;
        const title = section.querySelector('h2')?.textContent.trim() ?? nameOf(section);
        const heading = section.querySelector(':scope > header');
        live.push(`${title}: ${at(section.getBoundingClientRect())}`);
        if (heading) live.push(`${title}'s heading: ${at(heading.getBoundingClientRect())}`);
      }
    }
    return { top, live };
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
 * room reaches into the gaps beside it, never onto what is past them. What is in sight of each is compared (cut by
 * every box around it that hides its overflow or scrolls, and by the window, as fit.ts's inSight): a section under LIVE
 * scrolled past the column's end lies under the bar along the bottom, out of sight, and is no target there.
 */
const asksOverOthers = (win: Page) =>
  win.evaluate((controls) => {
    interface Box {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
    const meet = (a: Box, b: Box): Box | null => {
      const m = {
        left: Math.max(a.left, b.left),
        top: Math.max(a.top, b.top),
        right: Math.min(a.right, b.right),
        bottom: Math.min(a.bottom, b.bottom),
      };
      return m.right - m.left > 0.5 && m.bottom - m.top > 0.5 ? m : null;
    };
    /** What of `el` is in sight: its box cut by the window and by every box around it that does not show overflow. */
    const seen = (el: Element): Box | null => {
      if (el.getClientRects().length === 0) return null;
      let box: Box | null = meet(el.getBoundingClientRect(), {
        left: 0,
        top: 0,
        right: innerWidth,
        bottom: innerHeight,
      });
      for (let at = el.parentElement; at && box; at = at.parentElement) {
        const style = getComputedStyle(at);
        const r = at.getBoundingClientRect();
        if (style.overflowX !== 'visible') box = meet(box, { ...box, left: r.left, right: r.right });
        if (box && style.overflowY !== 'visible') box = meet(box, { ...box, top: r.top, bottom: r.bottom });
      }
      return box;
    };
    const out: string[] = [];
    const others = [...document.querySelectorAll(controls)].flatMap((el) => {
      const box = seen(el);
      return box ? [{ el, box }] : [];
    });
    for (const ask of document.querySelectorAll('[data-what-is-this]')) {
      const a = seen(ask);
      if (!a) continue;
      for (const { el: other, box: b } of others) {
        if (other === ask || other.contains(ask) || ask.contains(other)) continue;
        const both = meet(a, b);
        if (both) {
          const name =
            other.getAttribute('data-testid') ?? other.getAttribute('aria-label') ?? other.textContent.trim();
          out.push(
            `${ask.getAttribute('aria-label') ?? ''} over ${name.slice(0, 40)} (${(both.right - both.left).toFixed(1)} × ${(both.bottom - both.top).toFixed(1)} px)`,
          );
        }
      }
    }
    return out;
  }, CONTROLS);

/** Whatever of the top bar runs past the window's edge, and the page or the top bar scrolling sideways. */
const topBarPastTheEdge = (win: Page) =>
  win.evaluate(() => {
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
  });

test('every What is this? is a target of at least 24 × 24 px, over no other, in the room the top bar had for it, and the sections under LIVE hold still as Help turns on, at 1024 × 645 and 1410 × 900, in Pro Mode (Phones off and on) and Simple Mode', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  // Every section under LIVE open, so each heading has its buttons too (Timers: Calendar and New timer).
  await openAllSections(win);
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
      const atRest = await settledRead(
        win,
        size,
        () => layout(win),
        `${where}: the top bar and LIVE's column`,
      );
      expect(atRest.top.bars, `${where}: one top bar in sight`).toBe(1);
      expect(atRest.top.sizes.length, `${where}: what is measured`).toBeGreaterThanOrEqual(
        mode === 'pro' ? 7 : 1,
      );
      if (mode === 'pro')
        expect(atRest.live.length, `${where}: LIVE's sections measured`).toBeGreaterThanOrEqual(20);

      // Help on: the sections under LIVE hold still, then and after. The top bar's ? rooms are already held, so its
      // group and every persistent control keep their sizes and places (topbar, item 6).
      await help.dispatchEvent('click');
      await expect(help).toHaveAttribute('aria-pressed', 'true');
      const on = await layout(win);
      expect(on.live, `${where}: Help on, the sections under LIVE where they were`).toEqual(atRest.live);
      expect(on.top.sizes, `${where}: Help on, the top bar's controls as big as they were`).toEqual(
        atRest.top.sizes,
      );
      expect(on.top.places, `${where}: Help on, every top-bar control where it was`).toEqual(
        atRest.top.places,
      );
      if (mode === 'pro') {
        // Below 1280 px with Phones on the top bar's ? go (top-bar.ts), Help on or off; each panel has its own.
        const inBar =
          phones && size.width < 1280 ? [] : ['stream', 'phones', ...(phones ? ['announcements'] : [])];
        for (const id of inBar) await expect(header(id), `${where}: ${id}'s ?`).toBeVisible();
        if (inBar.length === 0) await expect(header('stream')).toBeHidden();
        expect(on.top.asks, `${where}: the top bar's ? in sight`).toBe(inBar.length);
        expect(
          (on.top.group ?? 0) - (atRest.top.group ?? 0),
          `${where}: the top bar's group keeps its held rooms`,
        ).toBe(0);
      } else await expect(asks).toHaveCount(0);
      await holdStill(
        async () => JSON.stringify((await layout(win)).live) === JSON.stringify(atRest.live),
        600,
        `${where}: Help on, every section under LIVE where it was`,
      );

      // Every ? in sight at least 24 × 24 px, and none over another target; the top bar still fits.
      const shown = await asksInSight(win);
      if (mode === 'pro') expect(shown.length, `${where}: the ? in sight`).toBeGreaterThanOrEqual(8);
      expect(
        shown
          .filter((a) => a.width < 24 || a.height < 24)
          .map((a) => `${a.name}: ${a.width.toFixed(1)} × ${a.height.toFixed(1)}`),
        `${where}: every ? at least 24 × 24 px`,
      ).toEqual([]);
      expect(await asksOverOthers(win), `${where}: a ? over another target`).toEqual([]);
      expect(await topBarPastTheEdge(win), `${where}: the top bar fits with Help on`).toEqual([]);

      // Help off again: the ? go, and everything is where it was.
      await help.dispatchEvent('click');
      await expect(help).toHaveAttribute('aria-pressed', 'false');
      await expect(asks).toHaveCount(0);
      expect(await layout(win), `${where}: Help off again`).toEqual(atRest);
    }
  }
  await app.close();
});
