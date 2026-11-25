import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { settled } from './a11y';

/**
 * Check a panel or dialog is laid out at the window's size: inside the
 * window, nothing sideways-scrolling, and no button whose words do not fit.
 */
export async function expectFits(panel: Locator, what: string): Promise<void> {
  await expect(panel).toBeVisible();
  // Where it settles, once it has risen or slid in (Session 26g).
  await settled(panel.page());
  const problems = await panel.evaluate((root) => {
    const out: string[] = [];
    const vw = innerWidth;
    const vh = innerHeight;
    const r = root.getBoundingClientRect();
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5)
      out.push(
        `it is cut off (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`,
      );
    if (document.documentElement.scrollWidth > vw) out.push('the page scrolls sideways');
    for (const b of root.querySelectorAll('button')) {
      const box = b.getBoundingClientRect();
      if (box.width === 0) continue;
      if (b.scrollWidth > b.clientWidth + 1) out.push(`“${b.textContent}”: its words do not fit`);
      if (box.right > vw + 0.5) out.push(`“${b.textContent}” is off the right edge`);
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-scroll-x="no"], footer, header')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()} scrolls sideways`);
    }
    return out;
  });
  expect(problems, what).toEqual([]);
}

/** Nothing that runs the show is under `notice`: Next, Back, the layer bar, LIVE, Simple Mode's big buttons. */
export async function clearOfShowControls(win: Page, notice: Locator): Promise<void> {
  const box = await notice.boundingBox();
  expect(box).not.toBeNull();
  const controls = await win.locator('[data-show-control]').evaluateAll((els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
  );
  expect(controls.length).toBeGreaterThan(0);
  const n = box ?? { x: 0, y: 0, width: 0, height: 0 };
  for (const c of controls)
    expect(
      n.x < c.x + c.width && c.x < n.x + n.width && n.y < c.y + c.height && c.y < n.y + n.height,
      `the notice ${JSON.stringify(n)} covers a show control ${JSON.stringify(c)}`,
    ).toBe(false);
}

/**
 * Everything that does not fit in the operator window as it is laid out now, each in words: a control, a heading or a
 * key hint cut (its contents run past it), cut off by what holds it, running out of its column, lying over another, or
 * under a notice; words lying over a control; words of Drashti's own cut short with an ellipsis (a name the operator
 * gave, placeholder here, may be); anything scrolling sideways. What a scroller has scrolled out of sight is not
 * looked at, nor what is hidden from people (aria-hidden, unseen). `names`: the names the operator gave in the test
 * (operator-fit.spec.ts's NAMES); moved here from it unchanged for chat-operator.spec.ts (alpha.23).
 */
export const fitFaults = (win: Page, names: string[]) =>
  win.evaluate((names) => {
    const out = new Set<string>();
    const REGIONS: [string, string][] = [
      ['the header', '[data-header]'],
      ['the left column', '[data-testid="column-left"]'],
      ['the middle', '[data-testid="column-middle"]'],
      ['the live column', '[data-testid="column-right"]'],
      ['the quick bar', '[data-testid="quick-bar"]'],
      ['the bar of clears', '[data-testid="layer-bar"], [data-testid="simple-buttons"]'],
      ['the status bar', 'footer[aria-label="Status"]'],
    ];
    const NOTICES = '[data-testid="operator-notice"], [data-testid="import-notice"]';
    const CONTROLS =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [role="spinbutton"], [data-show-control], [data-testid="next-up"]';
    const LABELS = 'h1, h2, h3, h4, [role="heading"], label, legend, kbd';
    const WORDS_CUT =
      'button, a, [role="button"], [role="tab"], kbd, h1, h2, h3, h4, [role="heading"], label, legend';

    interface Box {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
    const boxOf = (r: DOMRect | Box): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    const meet = (a: Box, b: Box): Box | null => {
      const m = {
        left: Math.max(a.left, b.left),
        top: Math.max(a.top, b.top),
        right: Math.min(a.right, b.right),
        bottom: Math.min(a.bottom, b.bottom),
      };
      return m.right - m.left > 0.5 && m.bottom - m.top > 0.5 ? m : null;
    };
    const named = (el: Element): string => {
      const id = el.getAttribute('data-testid');
      const label = el.getAttribute('aria-label');
      const words = el.textContent.replace(/\s+/gu, ' ').trim().slice(0, 40);
      const what = el.tagName.toLowerCase();
      return `${what} “${id ?? label ?? words}”`;
    };

    /** Not drawn, or drawn unseen (a screen reader's words alone, hidden, see-through). */
    const unseen = (el: Element): boolean => {
      if (el.getClientRects().length === 0) return true;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return true;
      for (let at: Element | null = el; at; at = at.parentElement) {
        const s = getComputedStyle(at);
        if (s.visibility === 'hidden' || Number(s.opacity) < 0.05) return true;
      }
      return false;
    };
    /** Not there for people: unseen, inert, or hidden from screen readers (the live picture excepted). */
    const hidden = (el: Element): boolean => {
      if (el.closest('[inert]')) return true;
      const quiet = el.closest('[aria-hidden="true"]');
      if (quiet && el.closest('[data-testid="live-preview"]') !== el) return true;
      return unseen(el);
    };

    /**
     * What of `box` is in sight: cut by every box around it that hides its overflow, scrolls, or is the window. Says
     * too whether something that does not scroll (overflow hidden) cut it, and where.
     */
    const inSight = (from: Element | null, box: Box): { seen: Box | null; cutBy: Element | null } => {
      let seen: Box | null = meet(box, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
      let cutBy: Element | null = null;
      for (let at = from; at && seen; at = at.parentElement) {
        const s = getComputedStyle(at);
        const x = s.overflowX;
        const y = s.overflowY;
        if (x === 'visible' && y === 'visible') continue;
        const a = at.getBoundingClientRect();
        const clipX = x !== 'visible';
        const clipY = y !== 'visible';
        const edge = {
          left: clipX ? a.left : -Infinity,
          right: clipX ? a.right : Infinity,
          top: clipY ? a.top : -Infinity,
          bottom: clipY ? a.bottom : Infinity,
        };
        // What is still in sight of it, past the boxes inside this one (one that scrolls has its own room).
        const cutX = clipX && (seen.left < edge.left - 1 || seen.right > edge.right + 1);
        const cutY = clipY && (seen.top < edge.top - 1 || seen.bottom > edge.bottom + 1);
        // Cut by a box that cannot scroll to it: out of reach (a scroller's own cut is scrolling, said below if sideways).
        const scrollsX = x === 'auto' || x === 'scroll';
        const scrollsY = y === 'auto' || y === 'scroll';
        if (!cutBy && ((cutX && !scrollsX) || (cutY && !scrollsY))) cutBy = at;
        seen = meet(seen, edge);
      }
      return { seen, cutBy };
    };

    const notices = [...document.querySelectorAll(NOTICES)].filter((n) => !hidden(n));
    // What of each is in sight (the notices scroll in their own place when there are many: one scrolled away covers
    // nothing).
    const noticeBoxes = notices.map((n) => inSight(n.parentElement, boxOf(n.getBoundingClientRect())).seen);

    interface Part {
      el: Element;
      region: string;
      seen: Box;
      control: boolean;
    }
    const parts: Part[] = [];
    const regions = REGIONS.flatMap(([name, selector]) =>
      [...document.querySelectorAll(selector)].filter((r) => !hidden(r)).map((r) => ({ name, r })),
    );
    for (const { name, r } of regions) {
      const edge = r.getBoundingClientRect();
      // Nothing in it scrolls sideways.
      for (const el of [r, ...r.querySelectorAll('*')]) {
        if (!(el instanceof HTMLElement) || el.scrollWidth <= el.clientWidth + 1) continue;
        const x = getComputedStyle(el).overflowX;
        if ((x === 'auto' || x === 'scroll') && !hidden(el))
          out.add(`${name}: ${named(el)} scrolls sideways`);
      }
      for (const el of r.querySelectorAll(`${CONTROLS}, ${LABELS}`)) {
        if (hidden(el) || el.closest(NOTICES)) continue;
        const box = boxOf(el.getBoundingClientRect());
        const { seen, cutBy } = inSight(el.parentElement, box);
        if (cutBy) out.add(`${name}: ${named(el)} is cut off by ${named(cutBy)}`);
        if (!seen) continue;
        if (box.left < edge.left - 0.5 || box.right > edge.right + 0.5)
          out.add(`${name}: ${named(el)} runs out of it`);
        if (el.matches(WORDS_CUT) && el instanceof HTMLElement) {
          // Cut with an ellipsis is the next check's (a name the operator gave may be).
          const style = getComputedStyle(el);
          const ellipsis = style.textOverflow === 'ellipsis' && style.overflowX !== 'visible';
          if (!ellipsis && el.scrollWidth > el.clientWidth + 1)
            out.add(
              `${name}: ${named(el)} is cut (${String(el.scrollWidth)} > ${String(el.clientWidth)} px)`,
            );
          // Its key and icon inside it.
          for (const inner of el.querySelectorAll('kbd, svg'))
            if (!unseen(inner) && !meet(boxOf(inner.getBoundingClientRect()), box))
              out.add(`${name}: ${named(el)}'s ${inner.tagName.toLowerCase()} is outside it`);
        }
        parts.push({ el, region: name, seen, control: el.matches(CONTROLS) });
      }
      // Words of Drashti's own cut short with an ellipsis (a name the operator gave may be: NAMES).
      for (const el of r.querySelectorAll('*')) {
        if (!(el instanceof HTMLElement) || el.scrollWidth <= el.clientWidth + 1) continue;
        const style = getComputedStyle(el);
        if (style.textOverflow !== 'ellipsis' || style.overflowX === 'visible' || hidden(el)) continue;
        const words = el.textContent.replace(/\s+/gu, ' ').trim();
        if (
          words !== '' &&
          !names.some((n) => words.includes(n)) &&
          inSight(el.parentElement, boxOf(el.getBoundingClientRect())).seen
        )
          out.add(`${name}: “${words.slice(0, 60)}” is cut short`);
      }
    }

    // Controls and headings lying over each other, and controls under a notice. A control wholly in another's box is
    // an action in a row's own room (Rename and Delete at its end): the row's words and icons must not be under it.
    const within = (a: Box, b: Box) =>
      a.left >= b.left - 0.5 &&
      a.right <= b.right + 0.5 &&
      a.top >= b.top - 0.5 &&
      a.bottom <= b.bottom + 0.5;
    const icons = (el: Element) =>
      [...el.querySelectorAll('svg, img')]
        .filter((g) => !unseen(g))
        .map((g) => boxOf(g.getBoundingClientRect()));
    parts.forEach((a, i) => {
      for (const b of parts.slice(i + 1)) {
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        if (a.el instanceof HTMLLabelElement && a.el.control === b.el) continue;
        if (b.el instanceof HTMLLabelElement && b.el.control === a.el) continue;
        if (!meet(a.seen, b.seen)) continue;
        const outer = within(b.seen, a.seen) ? a : within(a.seen, b.seen) ? b : null;
        const inner = outer === a ? b : a;
        if (outer?.control && inner.control) {
          if (icons(outer.el).some((g) => meet(g, inner.seen)))
            out.add(`${outer.region}: an icon of ${named(outer.el)} lies under ${named(inner.el)}`);
          continue;
        }
        out.add(`${a.region}: ${named(a.el)} and ${named(b.el)} lie over each other`);
      }
      if (a.control)
        noticeBoxes.forEach((n, k) => {
          if (n && meet(a.seen, n))
            out.add(`${a.region}: ${named(a.el)} is under ${named(notices[k] ?? a.el)}`);
        });
    });

    // Words lying over a control that does not hold them.
    const controls = parts.filter((p) => p.control);
    for (const { name, r } of regions) {
      const walk = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const parent = node.parentElement;
        if (!parent || !node.textContent?.trim() || hidden(parent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          // Its own box's cut counts (an ellipsis's words).
          const { seen } = inSight(parent, boxOf(rect));
          if (!seen) continue;
          for (const c of controls)
            if (!c.el.contains(parent) && !parent.contains(c.el) && meet(seen, c.seen))
              out.add(`${name}: “${node.textContent.trim().slice(0, 40)}” lies over ${named(c.el)}`);
        }
      }
    }
    return [...out];
  }, names);
