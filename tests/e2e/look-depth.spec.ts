import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { Appearance } from '../../src/shared/appearance/appearances';
import { BLACK, WHITE } from '../../src/shared/appearance/appearances';
import {
  chooseMenuItem,
  closeLibrary,
  launchApp,
  openLibrary,
  OWN_APPEARANCE,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';

/*
 * B · Depth (alpha.24, the owner's QA24-UI-4; src/renderer/src/styles/look-depth.css): while the window follows the
 * computer (the default), the three columns are rounded panels on the window's own colour, 4 px in from either side
 * (8 px between two: the splitters' own width), the side columns a surface above the middle; the top bar, the bar of
 * clears and the status bar sit on that ground with no line; the sections under LIVE are rounded rows with no line
 * between them; LIVE is its red frame with a light red ring round the picture and a light red tint in the live row,
 * never a glow; and none of it is a new way of drawing. Simple Mode looks the same. An appearance chosen by name draws
 * as before (appearance-decoration.spec holds Black and White to 9ed5d00), and in forced colours none of it applies.
 * Read from the page as it draws; placeholder content only.
 */

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))).join(', ')})`;
const CLEAR = 'rgba(0, 0, 0, 0)';

/** How the window draws its parts now (the mode's own root: Pro Mode's or Simple Mode's). */
function drawnNow(win: Page) {
  return win.evaluate(() => {
    const st = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el) : null;
    };
    const column = (id: string) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const s = getComputedStyle(el);
      // Its corners rounded by a ring of the ground over them (no rounded clip: the review's S1).
      const corners = getComputedStyle(el, '::after');
      return [
        s.backgroundColor,
        s.borderLeftWidth,
        s.borderRightWidth,
        s.borderLeftColor,
        s.borderTopLeftRadius,
        s.backgroundClip,
        corners.borderTopLeftRadius,
        corners.boxShadow,
      ];
    };
    const header = st('[data-header]');
    const bar = st('[data-zone="bar"]');
    const footer = st('footer[aria-label="Status"]');
    const sections = [...document.querySelectorAll('[data-testid="live-rest"] > div > *')].map((el) => {
      const s = getComputedStyle(el);
      return [s.borderTopWidth, s.borderBottomWidth, s.borderTopLeftRadius, s.marginLeft].join(' ');
    });
    const playlists = document.querySelector('section[aria-label="Playlists"]')?.getBoundingClientRect();
    return {
      look: document.documentElement.dataset['windowLook'] ?? null,
      // The ground under the bars and in the gaps (look-depth.css), as a colour this page draws.
      ground: (() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--depth-ground)';
        document.body.append(probe);
        const colour = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return colour;
      })(),
      header: header ? [header.backgroundColor, header.borderBottomColor] : null,
      bar: bar ? [bar.backgroundColor, bar.borderTopColor] : null,
      footer: footer ? [footer.backgroundColor, footer.borderTopColor] : null,
      left: column('column-left'),
      middle: column('column-middle'),
      right: column('column-right'),
      // The splitter between the left column and the middle: its line at rest.
      splitter: st('[data-testid="column-left"] + [role="separator"] > span')?.backgroundColor ?? null,
      sections: [...new Set(sections)],
      // The left column's panel starts its gap in from the window's edge.
      playlistsAt: playlists ? Math.round(playlists.x) : null,
    };
  });
}

/** What Depth draws in an appearance Follow the computer shows (Black or White, each zone its own surfaces). */
const depthOf = (a: Appearance, ground: string) => {
  const panel = (bg: string) => [
    rgb(bg),
    '4px',
    '4px',
    CLEAR,
    '0px',
    'padding-box',
    '12px',
    `${ground} 0px 0px 0px 12px`,
  ];
  return {
    look: 'depth',
    ground,
    header: [ground, CLEAR],
    bar: [ground, CLEAR],
    footer: [ground, CLEAR],
    left: panel(a.colours['panel-2']),
    middle: panel(a.colours.panel),
    right: panel(a.colours['panel-2']),
    splitter: CLEAR,
    sections: ['0px 0px 8px 4px'],
    playlistsAt: 4,
  };
};

/**
 * What would cost a computer without a graphics chip a new way of drawing (appearance-drawing.spec's rules): a blur
 * round a rounded corner, a gradient but the primary's and the decoration's, a layer of its own.
 */
function newWaysToDraw(win: Page) {
  return win.evaluate(() => {
    const found: string[] = [];
    const parts = (list: string) => {
      const out: string[] = [];
      let depth = 0;
      let part = '';
      for (const ch of list) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) {
          out.push(part);
          part = '';
        } else part += ch;
      }
      if (part.trim() !== '') out.push(part);
      return out;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[data-testid="scene"], [data-chip-warm-up], [data-touch-layer]')) continue;
      for (const pseudo of [null, '::before', '::after']) {
        const st = getComputedStyle(el, pseudo);
        if (pseudo !== null && st.content === 'none') continue;
        const name = `${el.getAttribute('data-testid') ?? el.tagName.toLowerCase()}${pseudo ?? ''}`;
        const corner = Math.max(
          ...[
            st.borderTopLeftRadius,
            st.borderTopRightRadius,
            st.borderBottomLeftRadius,
            st.borderBottomRightRadius,
          ].map((r) => Number.parseFloat(r) || 0),
        );
        if (st.boxShadow !== 'none')
          for (const shadow of parts(st.boxShadow)) {
            if (shadow.includes('inset')) continue;
            const [, , blur = 0, spread = 0] = [
              ...shadow.replace(/rgba?\([^)]*\)|color\([^)]*\)/gu, '').matchAll(/(-?[\d.]+)px/gu),
            ].map((m) => Number(m[1]));
            if (blur > 0 && spread + corner > 0)
              found.push(`${name}: a blur round a ${String(corner)} px corner`);
          }
        if (st.backgroundImage.includes('gradient(')) {
          const allowed =
            pseudo === null &&
            (el.getAttribute('data-variant') === 'primary' ||
              el.matches('[data-header], [data-strip], [data-decoration]'));
          if (!allowed) found.push(`${name}: a gradient`);
        }
        if (st.willChange !== 'auto') found.push(`${name}: a layer of its own`);
      }
    }
    return [...new Set(found)];
  });
}

/**
 * Back's and Oops's left edges and the next picture's right edge, each against the live picture's own (0: in line with
 * it), and the picture's box. a24-lookgap put Depth's picture back at the width and place it has in a flat look (356 x
 * 202 in CI's 380 px live column), 4 px past the row under it on each side (lead 2's lookcheck); the row and Oops's
 * line reach the gaps' room back too, so they line up with the picture again, as in a flat look.
 */
function liveEdges(win: Page) {
  return win.evaluate(() => {
    const box = (id: string) =>
      document.querySelector(`[data-testid="column-right"] [data-testid="${id}"]`)?.getBoundingClientRect() ??
      null;
    const picture = box('live-preview');
    const step = (a: number | undefined, b: number | undefined) =>
      a === undefined || b === undefined ? null : Math.round((a - b) * 10) / 10;
    return {
      picture: picture
        ? [picture.x, picture.width, picture.height].map((v) => Math.round(v * 10) / 10)
        : null,
      back: step(box('show-back')?.left, picture?.left),
      oops: step(box('show-oops')?.left, picture?.left),
      nextUp: step(picture?.right, box('next-up')?.right),
      // Nothing reaches past the live column's room: it never scrolls sideways (a scrolling LIVE column would).
      sideways: (() => {
        const scroller = document.querySelector('[data-testid="live-scroll"]');
        return scroller ? scroller.scrollWidth - scroller.clientWidth : null;
      })(),
    };
  });
}

/**
 * What draws over a column's rounded corners (the alpha.25 list's item 15; copylook's review of ee108ee50, SHOULD-2):
 * at every whole pixel of each corner that lies outside its arc (by a pixel or more, past the arc's own soft edge),
 * everything the window draws there over the column's ring of the ground: whatever has a colour, a picture or an edge
 * of its own there, found by its box and its own rounded corners (not by the pointer: what takes none, or is hidden from
 * it, is seen too), clipped by what it scrolls in, and above the ring in the column's own stacking (the ring is the
 * column's ::before or ::after, at its z-index: over it, only what lies higher; under it, all the column holds). LIVE's
 * rows cut by the column's foot are seen like anything else.
 */
function overCorners(win: Page) {
  return win.evaluate(() => {
    const found: string[] = [];
    const px = (v: string) => Number.parseFloat(v) || 0;
    const clear = (c: string) => c === 'transparent' || /^rgba\([^)]*,\s*0\)$/u.test(c);
    const named = (el: Element) => el.getAttribute('data-testid') ?? el.tagName.toLowerCase();
    /** Whether (x, y) lies inside a box with these rounded corners (the CSS radii, each [x, y]). */
    const inRounded = (b: DOMRect, st: CSSStyleDeclaration, x: number, y: number) => {
      if (x < b.left || x > b.right || y < b.top || y > b.bottom) return false;
      const radii = (v: string) => {
        const [rx = 0, ry = rx] = v.split(' ').map(px);
        return [Math.min(rx, b.width / 2), Math.min(ry, b.height / 2)] as const;
      };
      for (const [r, cx, cy, sx, sy] of [
        [radii(st.borderTopLeftRadius), b.left, b.top, 1, 1],
        [radii(st.borderTopRightRadius), b.right, b.top, -1, 1],
        [radii(st.borderBottomLeftRadius), b.left, b.bottom, 1, -1],
        [radii(st.borderBottomRightRadius), b.right, b.bottom, -1, -1],
      ] as const) {
        const [rx, ry] = r;
        if (rx <= 0 || ry <= 0) continue;
        const ox = cx + sx * rx;
        const oy = cy + sy * ry;
        if ((x - ox) * sx >= 0 || (y - oy) * sy >= 0) continue;
        if (((x - ox) / rx) ** 2 + ((y - oy) / ry) ** 2 > 1) return false;
      }
      return true;
    };
    /** What an element draws at (x, y) of its own (a colour, a picture, an edge), or null. */
    const drawsAt = (el: Element, st: CSSStyleDeclaration, b: DOMRect, x: number, y: number) => {
      if (!clear(st.backgroundColor)) return st.backgroundColor;
      if (st.backgroundImage !== 'none') return st.backgroundImage;
      if (/^(img|video|canvas|iframe|svg)$/u.test(el.tagName.toLowerCase())) return el.tagName.toLowerCase();
      for (const [side, near] of [
        ['Top', y - b.top],
        ['Bottom', b.bottom - y],
        ['Left', x - b.left],
        ['Right', b.right - x],
      ] as const) {
        const width = px(st.getPropertyValue(`border-${side.toLowerCase()}-width`));
        const colour = st.getPropertyValue(`border-${side.toLowerCase()}-color`);
        if (
          width > 0 &&
          !clear(colour) &&
          st.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' &&
          near < width
        )
          return `its ${side.toLowerCase()} edge ${colour}`;
      }
      return null;
    };
    /** Whether an element starts a stacking context (a positioned auto parent lets a high child escape). */
    const stacks = (el: Element, st: CSSStyleDeclaration) => {
      const parent = el.parentElement ? getComputedStyle(el.parentElement).display : '';
      return (
        (st.zIndex !== 'auto' && (st.position !== 'static' || /flex|grid/u.test(parent))) ||
        /^(fixed|sticky)$/u.test(st.position) ||
        Number(st.opacity) < 1 ||
        st.transform !== 'none' ||
        st.filter !== 'none' ||
        st.isolation === 'isolate' ||
        st.willChange !== 'auto' ||
        st.mixBlendMode !== 'normal'
      );
    };
    for (const id of ['column-left', 'column-middle', 'column-right']) {
      const column = document.querySelector(`[data-testid="${id}"]`);
      if (!(column instanceof HTMLElement)) continue;
      const box = column.getBoundingClientRect();
      const st = getComputedStyle(column);
      // The ring: the column's ::before or ::after, at its z-index.
      const pseudo = getComputedStyle(column, '::before').content !== 'none' ? '::before' : '::after';
      const ring = getComputedStyle(column, pseudo);
      if (ring.content === 'none') continue;
      const ringZ = Number(ring.zIndex) || 0;
      const r = px(ring.borderTopLeftRadius);
      // The padding box (where the ring lies).
      const pad = {
        left: box.left + px(st.borderLeftWidth),
        right: box.right - px(st.borderRightWidth),
        top: box.top + px(st.borderTopWidth),
        bottom: box.bottom - px(st.borderBottomWidth),
      };
      // Every whole pixel's middle in each corner's r x r square that lies a pixel or more outside its arc.
      const points: [number, number][] = [];
      for (const [cx, cy, sx, sy] of [
        [pad.left, pad.top, 1, 1],
        [pad.right, pad.top, -1, 1],
        [pad.left, pad.bottom, 1, -1],
        [pad.right, pad.bottom, -1, -1],
      ] as const)
        for (let i = 0; i < r; i++)
          for (let j = 0; j < r; j++) {
            const dx = i + 0.5;
            const dy = j + 0.5;
            if (Math.hypot(r - dx, r - dy) >= r + 1) points.push([cx + sx * dx, cy + sy * dy]);
          }
      // What the column holds whose box reaches a corner.
      const near = (b: DOMRect) =>
        b.width > 0 &&
        b.height > 0 &&
        ((b.left < pad.left + r && b.right > pad.left) || (b.right > pad.right - r && b.left < pad.right)) &&
        ((b.top < pad.top + r && b.bottom > pad.top) || (b.bottom > pad.bottom - r && b.top < pad.bottom));
      for (const el of column.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        if (!near(b)) continue;
        const own = getComputedStyle(el);
        if (own.visibility === 'hidden' || own.display === 'contents') continue;
        // Its place in the column's stacking: the outermost stacking context up to the column; a positioned auto
        // ancestor alone does not trap a high child. Hidden through transparent ancestors; clipped by scrollports.
        let z: number | 'flow' = 'flow';
        let shown = true;
        const clips: Element[] = [];
        for (let at: Element | null = el; at && at !== column; at = at.parentElement) {
          const s = getComputedStyle(at);
          if (Number(s.opacity) === 0) shown = false;
          if (stacks(at, s)) z = s.zIndex === 'auto' ? 0 : Number(s.zIndex);
          else if (s.position !== 'static' && z === 'flow') z = 0;
          if (at !== el && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) clips.push(at);
        }
        if (!shown) continue;
        const above = z === 'flow' ? ringZ < 0 : ringZ < 0 ? z >= ringZ : z > ringZ;
        if (!above) continue;
        for (const [x, y] of points) {
          if (!inRounded(b, own, x, y)) continue;
          if (clips.some((c) => !inRounded(c.getBoundingClientRect(), getComputedStyle(c), x, y))) continue;
          const what = drawsAt(el, own, b, x, y);
          if (what === null) continue;
          found.push(`${id} at ${x.toFixed(1)},${y.toFixed(1)}: ${named(el)} ${what}`);
          break;
        }
      }
    }
    return found;
  });
}

const turnComputer = (app: ElectronApplication, source: 'light' | 'dark') =>
  app.evaluate(({ nativeTheme }, s) => {
    nativeTheme.themeSource = s;
  }, source);

test('B · Depth while the window follows the computer, in Pro Mode and Simple Mode, light and dark; flat in one chosen by name and in forced colours', async () => {
  test.setTimeout(120_000);
  // Follow the computer (CI's Black job would start every other Drashti in Black, chosen by name).
  const { app } = await launchApp(OWN_APPEARANCE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // The live picture's box in each Depth base, to hold against a flat look's below.
  const pictures: (number[] | null)[] = [];
  for (const [source, a] of [
    ['light', WHITE],
    ['dark', BLACK],
  ] as const) {
    await turnComputer(app, source);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
    await expect(win.locator('html')).toHaveAttribute('data-window-look', 'depth');
    const pro = await drawnNow(win);
    // A darker ground than the window's own colour (lead 2's nearer-the-mockup round), the same under every bar.
    expect(pro.ground, `${a.name}: the ground`).not.toBe(rgb(a.colours.ink));
    expect(pro, `${a.name}: Pro Mode`).toEqual(depthOf(a, pro.ground));
    expect(await newWaysToDraw(win), `${a.name}: nothing live`).toEqual([]);
    expect(await overCorners(win), `${a.name}: the columns' corners`).toEqual([]);

    // A slide live: the live picture's red frame with a light red ring round it, no blur; the live row tinted inside.
    const thumbs = win.getByTestId('slide-thumb');
    await expect(thumbs.first()).toBeVisible();
    await thumbs.first().click();
    await expect(thumbs.first()).toHaveAttribute('aria-current', 'true');
    const preview = win.getByTestId('live-preview');
    await expect(preview).toHaveClass(/border-live-edge/u);
    const live = await win.evaluate(() => ({
      picture: getComputedStyle(document.querySelector('[data-testid="live-preview"]') ?? document.body)
        .boxShadow,
      row: getComputedStyle(
        document.querySelector('[data-testid="slide-thumb"][aria-current="true"]') ?? document.body,
      ).boxShadow,
    }));
    // Inside its frame as before (its light along the top), the ring outside it.
    expect(live.picture, `${a.name}: the live picture`).toMatch(
      /^rgba\(255, 255, 255, [\d.]+\) 0px 1px 0px 0px inset, rgba\(212, 42, 49, 0\.\d+\) 0px 0px 0px 4px$/u,
    );
    expect(live.row, `${a.name}: the live row`).toMatch(
      /^rgba\(212, 42, 49, 0\.\d+\) 0px 0px 0px \d+px inset$/u,
    );
    expect(await newWaysToDraw(win), `${a.name}: in a show`).toEqual([]);
    expect(await overCorners(win), `${a.name}: the columns' corners in a show`).toEqual([]);
    // Back, Oops and the next picture in line with the live picture's edges.
    const edges = await liveEdges(win);
    expect(edges, `${a.name}: Back, Oops and Next up at the picture's edges`).toMatchObject({
      back: 0,
      oops: 0,
      nextUp: 0,
      sideways: 0,
    });
    pictures.push(edges.picture);
    // At CI's short size the whole LIVE column scrolls: the rows must stay inside its room there too.
    await win.setViewportSize({ width: 1024, height: 645 });
    await expect
      .poll(() => liveEdges(win), { message: `${a.name}: the scrolling LIVE column at 1024 × 645` })
      .toMatchObject({ back: 0, oops: 0, nextUp: 0, sideways: 0 });
    expect(await overCorners(win), `${a.name}: the columns' corners at 1024 × 645`).toEqual([]);
    await win.setViewportSize({ width: 1280, height: 720 });
    await win.evaluate(() =>
      (
        globalThis as unknown as { drashti: { engine: { dispatch(c: unknown): Promise<unknown> } } }
      ).drashti.engine.dispatch({ type: 'clearAll' }),
    );
  }

  // Simple Mode: the same look.
  await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const simple = await drawnNow(win);
  expect(simple.ground, 'Simple Mode: the ground').not.toBe(rgb(BLACK.colours.ink));
  const black = depthOf(BLACK, simple.ground);
  expect(simple, 'Simple Mode').toMatchObject({
    look: 'depth',
    header: black.header,
    bar: black.bar,
    footer: black.footer,
    left: black.left,
    middle: black.middle,
    right: black.right,
    splitter: CLEAR,
  });
  expect(await newWaysToDraw(win), 'Simple Mode').toEqual([]);
  expect(await overCorners(win), "Simple Mode: the columns' corners").toEqual([]);
  // Simple Mode's Back and next picture in line with its live picture (it has no Oops).
  expect(await liveEdges(win), "Simple Mode: Back and Next up at the picture's edges").toMatchObject({
    back: 0,
    oops: null,
    nextUp: 0,
    sideways: 0,
  });
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);

  // Forced colours (a Windows contrast theme): the system's colours, and none of Depth's gaps or rows.
  await win.emulateMedia({ forcedColors: 'active' });
  await expect
    .poll(() => win.getByTestId('column-left').evaluate((el) => getComputedStyle(el).borderLeftWidth))
    .toBe('0px');
  await win.emulateMedia({ forcedColors: 'none' });

  // Black chosen by name: flat, exactly as before; Follow the computer again: Depth again.
  await chooseMenuItem(app, `appearance-${BLACK.id}`);
  await expect(win.locator('html')).toHaveAttribute('data-window-look', 'flat');
  const flat = await drawnNow(win);
  expect(flat.header?.[0]).toBe(rgb(BLACK.decoration.header));
  expect(flat.left?.slice(0, 3)).toEqual([rgb(BLACK.colours.panel), '0px', '0px']);
  expect(flat.left?.[7], 'flat: no ring over the corners').toBe('none');
  expect(flat.playlistsAt).toBe(0);
  // Flat: the picture and the row under it as before, the picture's box the one Depth draws.
  const flatEdges = await liveEdges(win);
  expect(flatEdges, "flat: Back, Oops and Next up at the picture's edges").toMatchObject({
    back: 0,
    oops: 0,
    nextUp: 0,
    sideways: 0,
  });
  expect(pictures, "the live picture's box: Depth's the flat look's").toEqual([
    flatEdges.picture,
    flatEdges.picture,
  ]);
  await chooseMenuItem(app, 'appearance-follow');
  await expect(win.locator('html')).toHaveAttribute('data-window-look', 'depth');
  await app.close();
});

/*
 * What lies at the left column's corners while it is up (copylook's review of ee108ee50, MUST-1): the Library sheet
 * (over the playlists, from the column's top to its foot) and an Undo line (the column's foot), each with a background
 * of its own. Nothing draws over the columns' rounded corners then either (overCorners).
 */
test('B · Depth: nothing draws over the columns’ corners with the Library open or an Undo line up, light and dark', async () => {
  const { app } = await launchApp(OWN_APPEARANCE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // A playlist with a presentation in it, open: its row is what an Undo line brings back.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [a] = await d.library.listPresentations();
    if (!a) throw new Error('Missing placeholder presentation');
    const made = await d.playlists.create('Placeholder corners', null, false);
    if (!made.ok) throw new Error(made.message);
    await d.playlists.addItems(made.ids[0] ?? '', null, [{ kind: 'presentation', presentationId: a.id }]);
  });
  await win
    .getByTestId('playlist-node')
    .filter({ hasText: /^Placeholder corners/u })
    .click();
  const items = win.getByTestId('playlist-item');
  await expect(items).toHaveCount(1);
  for (const [source, a] of [
    ['light', WHITE],
    ['dark', BLACK],
  ] as const) {
    await turnComputer(app, source);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
    await expect(win.locator('html')).toHaveAttribute('data-window-look', 'depth');
    await openLibrary(win);
    expect(await overCorners(win), `${a.name}: the Library open`).toEqual([]);
    await closeLibrary(win);
    // An Undo line: the playlist's row deleted, its Undo at the column's foot.
    await items.first().click();
    await win.keyboard.press('Delete');
    await expect(win.getByTestId('undo-removal')).toBeVisible();
    expect(await overCorners(win), `${a.name}: an Undo line up`).toEqual([]);
    await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
    await expect(items).toHaveCount(1);
  }
  await app.close();
});
