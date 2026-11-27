import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { settled } from './a11y';
import { chooseMenuItem, launchApp, openAllSections, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW } from './window-size';

/*
 * The last small targets of the operator window (alpha.24, targets; the joined-tree hands-on's A4, the a25 list's
 * item 34; all as in alpha.23). Nothing clickable is smaller than 24 × 24 px (WCAG 2.5.8, docs/design.md):
 * - Audio's Music steps aside switch was 20 px tall. It is now a 24 px target in the 20 px line it had: it reaches
 *   2 px up into the block's padding and 2 px down into the gap under it, so nothing under it moves.
 * - The sound's two sliders (Audio, Video) were 6 px tall. Each is now 24 px tall in the 28 px row its Mute switch
 *   gives the line, so nothing moves.
 * - The column splitters stay the 8 px gap between the columns. A 24 px hit area would reach 12 px into each column,
 *   and it was measured there: in the looks chosen by name (flat) it would cover LIVE's section headings' fold
 *   buttons (8 px from the gap's middle) and the playlists' rows (8 px), and in every look the scroll bar of a list
 *   flush with the gap (0 px in the flat looks, 4 px in Depth; Windows draws an 11 px bar). So the splitters use
 *   WCAG 2.5.8's spacing exception instead: a 24 px circle centred on each splitter's box touches no other target,
 *   nor another small target's circle. Each still takes a press across its whole width, along its whole length.
 *   In Depth (Follow the computer, the default) no list's scroll bar lies under one either.
 * Measured at CI's 1024 × 645 and the owner's 1410 × 900, in Pro and Simple Mode, in Depth and in Black (flat), with
 * every section under LIVE open, each part that scrolls at its top and at its end.
 */

const OWNERS_WINDOW = { width: 1410, height: 900 } as const;

const SIZES = [CI_WINDOW, OWNERS_WINDOW] as const;

/** The controls of a target: what fit.ts counts as one (help-targets.spec.ts's CONTROLS, with the show's own). */
const CONTROLS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [role="spinbutton"], [data-show-control], [data-testid="next-up"]';

/** The three small targets this spec grew, by test id. */
const GROWN = ['music-steps-aside-switch', 'sound-level-audio-slider', 'sound-level-video-slider'] as const;

/**
 * Laid out, and what a size or look change starts done: three frames, then every finite animation running then
 * finished (a11y's settled).
 */
async function laidOut(win: Page): Promise<void> {
  await win.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }),
  );
  await settled(win);
}

/** Every part of the window that scrolls up and down, at its top or at its end, then laid out. */
async function scrollAll(win: Page, end: boolean): Promise<void> {
  await win.evaluate((end) => {
    for (const el of document.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
      const y = getComputedStyle(el).overflowY;
      if (y === 'auto' || y === 'scroll') el.scrollTop = end ? el.scrollHeight : 0;
    }
  }, end);
  await laidOut(win);
}

/**
 * Each way the operator window can be: Depth (Follow the computer) and Black (chosen by name, flat), each in Pro Mode
 * and then Simple Mode (which keeps the look chosen in Pro Mode), at each size; `visit` measures it.
 */
async function eachWay(
  app: ElectronApplication,
  win: Page,
  visit: (where: string) => Promise<void>,
): Promise<void> {
  const simple = win.getByTestId('simple-mode');
  for (const look of ['follow', 'black'] as const) {
    for (const mode of ['pro', 'simple'] as const) {
      if (mode === 'pro') {
        if (await simple.isVisible()) {
          await chooseMenuItem(app, 'switch-mode');
          await expect(simple).toBeHidden();
        }
        await chooseMenuItem(app, `appearance-${look}`);
      } else {
        await chooseMenuItem(app, 'switch-mode');
        await expect(simple).toBeVisible();
      }
      await expect(win.locator('html')).toHaveAttribute(
        'data-window-look',
        look === 'follow' ? 'depth' : 'flat',
      );
      for (const size of SIZES) {
        await win.setViewportSize(size);
        await expect
          .poll(() => win.evaluate(() => [window.innerWidth, window.innerHeight]))
          .toEqual([size.width, size.height]);
        await laidOut(win);
        await visit(
          `${mode === 'pro' ? 'Pro' : 'Simple'} Mode, ${look === 'follow' ? 'Depth' : 'Black'}, at ${String(size.width)} × ${String(size.height)}`,
        );
      }
    }
  }
}

/**
 * One grown target (by test id), scrolled into sight: its size; the other targets its box lies over, in sight (more
 * than half a pixel each way, as fit.ts counts it); where a press near each of its four edges lands (it must be on it);
 * and the room it takes: the switch's line (the words under it start 24 px below the block's padding, its 20 px line
 * and the 4 px gap, as before), a slider's row (as tall as its Mute switch, as before).
 */
const readGrown = (win: Page, id: string) =>
  win.evaluate(
    ({ id, controls }) => {
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
      /** What of `el` is in sight: its box cut by the window and by every box round it that does not show overflow. */
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
      const named = (el: Element) =>
        el.getAttribute('data-testid') ??
        el.getAttribute('aria-label') ??
        `${el.tagName.toLowerCase()} “${el.textContent.trim().slice(0, 30)}”`;
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const mine = seen(el);
      const over: string[] = [];
      if (mine)
        for (const other of document.querySelectorAll(controls)) {
          if (other === el || other.contains(el) || el.contains(other)) continue;
          const b = seen(other);
          const both = b && meet(mine, b);
          if (both)
            over.push(
              `${named(other)} (${(both.right - both.left).toFixed(1)} × ${(both.bottom - both.top).toFixed(1)} px)`,
            );
        }
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const presses: string[] = [];
      for (const [x, y, edge] of [
        [cx, r.top + 0.5, 'top'],
        [cx, r.bottom - 0.5, 'bottom'],
        [r.left + 0.5, cy, 'left'],
        [r.right - 0.5, cy, 'right'],
      ] as const) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(hit === el || el.contains(hit)))
          presses.push(`a press at its ${edge} edge lands on ${hit ? named(hit) : 'nothing'}`);
      }
      let room = '';
      if (id === 'music-steps-aside-switch') {
        const block = el.parentElement;
        const under = el.nextElementSibling;
        if (block && under) {
          const top = block.getBoundingClientRect().top + parseFloat(getComputedStyle(block).paddingTop);
          room = `the words under it start ${(under.getBoundingClientRect().top - top).toFixed(1)} px below the block's padding`;
        }
      } else {
        const row = el.parentElement;
        const mute = row?.querySelector('[role="switch"]');
        if (row && mute)
          room = `its row ${row.getBoundingClientRect().height.toFixed(1)} px tall, its Mute switch ${mute.getBoundingClientRect().height.toFixed(1)} px`;
      }
      return { width: r.width, height: r.height, over, presses, room };
    },
    { id, controls: CONTROLS },
  );

/**
 * The column splitters, measured in words (each a fault), and how many were measured: each the gap's 8 px, centred
 * on the edge between its two columns, which together are as wide as the window (the splitters take no room); a
 * press at either of its edges and its middle, every 8 px down its length, lands on it; the 24 px circle centred on
 * its box (WCAG 2.5.8's spacing test) lies over no other target in sight (half a pixel spared, as fit.ts's meet), nor
 * over another small target's own circle; and, in Depth, no list's scroll bar lies under it.
 */
const readSplitters = (win: Page) =>
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
    const named = (el: Element) =>
      el.getAttribute('data-testid') ??
      el.getAttribute('aria-label') ??
      `${el.tagName.toLowerCase()} “${el.textContent.trim().slice(0, 30)}”`;
    /** How far a point is from a box (0 inside it). */
    const away = (x: number, y: number, b: Box) =>
      Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
    const faults = new Set<string>();
    const depth = document.documentElement.getAttribute('data-window-look') === 'depth';
    const columns = ['column-left', 'column-middle', 'column-right'].map((id) =>
      document.querySelector(`[data-testid="${id}"]`),
    );
    const widths = columns.map((c) => c?.getBoundingClientRect().width ?? 0);
    const sum = widths.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - innerWidth) > 1)
      faults.add(
        `the columns are ${widths.map((w) => w.toFixed(1)).join(' + ')} px, not the window's ${String(innerWidth)}`,
      );
    const targets = [...document.querySelectorAll(controls)].flatMap((el) => {
      const box = seen(el);
      return box ? [{ el, box }] : [];
    });
    const splitters = [
      ...document.querySelectorAll('[role="separator"][aria-orientation="vertical"]'),
    ].filter((s) => s.getClientRects().length > 0);
    for (const s of splitters) {
      const name = s.getAttribute('aria-label') ?? 'a splitter';
      const r = s.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (Math.abs(r.width - 8) > 0.5)
        faults.add(`${name} is ${r.width.toFixed(1)} px wide, not the gap's 8 px`);
      const before = s.previousElementSibling;
      const edge = before?.getBoundingClientRect().right ?? NaN;
      if (!(Math.abs(cx - edge) <= 0.5))
        faults.add(
          `${name}'s middle is at ${cx.toFixed(1)} px, not on its columns' edge at ${edge.toFixed(1)}`,
        );
      for (let y = Math.max(r.top, 0) + 4; y <= Math.min(r.bottom, innerHeight) - 4; y += 8)
        for (const [x, where] of [
          [r.left + 0.5, 'left edge'],
          [cx, 'middle'],
          [r.right - 0.5, 'right edge'],
        ] as const) {
          const hit = document.elementFromPoint(x, y);
          if (!hit || !(hit === s || s.contains(hit)))
            faults.add(`a press on ${name}'s ${where} lands on ${hit ? named(hit) : 'nothing'}`);
        }
      for (const { el, box } of targets) {
        if (el === s || s.contains(el)) continue;
        const d = away(cx, cy, box);
        if (d < 12 - 0.5)
          faults.add(`the 24 px circle on ${name} reaches ${named(el)} (${d.toFixed(1)} px from its middle)`);
        // Another small target's own 24 px circle (on its box's middle) may not meet this one.
        const w = box.right - box.left;
        const h = box.bottom - box.top;
        const whole = el.getBoundingClientRect();
        if (whole.width < 24 || whole.height < 24) {
          const apart = Math.hypot((box.left + box.right) / 2 - cx, (box.top + box.bottom) / 2 - cy);
          if (apart < 24 - 0.5)
            faults.add(
              `the 24 px circle on ${name} meets the small ${named(el)}'s (${w.toFixed(1)} × ${h.toFixed(1)} px, ${apart.toFixed(1)} px apart)`,
            );
        }
      }
      if (depth)
        for (const el of document.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement) || el.getClientRects().length === 0) continue;
          const style = getComputedStyle(el);
          if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
          const bar =
            el.offsetWidth -
            el.clientWidth -
            parseFloat(style.borderLeftWidth) -
            parseFloat(style.borderRightWidth);
          if (bar <= 0) continue;
          const b = el.getBoundingClientRect();
          const right = b.right - parseFloat(style.borderRightWidth);
          if (meet({ left: right - bar, top: b.top, right, bottom: b.bottom }, r))
            faults.add(`${named(el)}'s ${bar.toFixed(1)} px scroll bar lies under ${name}`);
        }
    }
    return { faults: [...faults], measured: splitters.length };
  }, CONTROLS);

test('the Music steps aside switch and the two sound sliders are targets of at least 24 × 24 px in the room they had, over no other target, in Pro and Simple Mode, Depth and Black, at 1024 × 645 and 1410 × 900', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // Every section under LIVE open: Audio (with its switch) among them, and the most a column can hold.
  await openAllSections(win);
  await eachWay(app, win, async (where) => {
    for (const id of GROWN) {
      await win.getByTestId(id).scrollIntoViewIfNeeded();
      await laidOut(win);
      const got = await readGrown(win, id);
      expect(got, `${where}: ${id} is there`).not.toBeNull();
      if (!got) continue;
      expect(
        { width: got.width >= 24, height: got.height >= 24 },
        `${where}: ${id} is at least 24 × 24 px (${got.width.toFixed(1)} × ${got.height.toFixed(1)})`,
      ).toEqual({ width: true, height: true });
      expect(got.over, `${where}: ${id} over another target`).toEqual([]);
      expect(got.presses, `${where}: a press anywhere on ${id} is its`).toEqual([]);
      expect(got.room, `${where}: ${id} takes the room it had`).toBe(
        id === 'music-steps-aside-switch'
          ? "the words under it start 24.0 px below the block's padding"
          : 'its row 28.0 px tall, its Mute switch 28.0 px',
      );
    }
  });
  await app.close();
});

test('the column splitters keep the 8 px gap and take a press across it, spaced as WCAG 2.5.8 asks (a 24 px circle on each touches no other target), in Pro and Simple Mode, Depth and Black, at 1024 × 645 and 1410 × 900, every list at its top and its end', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await openAllSections(win);
  await eachWay(app, win, async (where) => {
    for (const end of [false, true]) {
      await scrollAll(win, end);
      const got = await readSplitters(win);
      expect(got.measured, `${where}, every list at its ${end ? 'end' : 'top'}: both splitters`).toBe(2);
      expect(got.faults, `${where}, every list at its ${end ? 'end' : 'top'}`).toEqual([]);
    }
  });
  await app.close();
});
