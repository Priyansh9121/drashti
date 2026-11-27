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
      // Its corners rounded by a ring of the ground (no rounded clip: the review's S1), under what it holds (the
      // re-review of 6e6d4fea2, SHOULD-1: over it, it would be a layer of its own over a playing video or a glide).
      const corners = getComputedStyle(el, '::before');
      return [
        s.backgroundColor,
        s.borderLeftWidth,
        s.borderRightWidth,
        s.borderLeftColor,
        s.borderTopLeftRadius,
        s.backgroundClip,
        corners.borderTopLeftRadius,
        corners.boxShadow,
        corners.zIndex,
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
    '-1',
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
 * What draws over a column's rounded corners: at three points outside each corner's arc, everything the column holds
 * there (above it, under the point) with a background of its own. The ring of the ground lies under what the column
 * holds (the re-review of 6e6d4fea2, SHOULD-1), so anything there with a background would show the corner square. Not
 * seen (accepted, the review of copylook ee108ee50, SHOULD-2): what takes no pointer (elementsFromPoint skips it); and
 * passed by name: LIVE's rows, 4 px in, cut by the column's foot or top where what is under LIVE scrolls (about 3 x 8 px
 * of a corner, as CI's Windows shows at 1280 x 720 with every section folded: run 45957201941).
 */
function overCorners(win: Page) {
  return win.evaluate(() => {
    const found: string[] = [];
    for (const id of ['column-left', 'column-middle', 'column-right']) {
      const column = document.querySelector(`[data-testid="${id}"]`);
      if (!(column instanceof HTMLElement)) continue;
      const box = column.getBoundingClientRect();
      const st = getComputedStyle(column);
      const left = box.left + Number.parseFloat(st.borderLeftWidth);
      const right = box.right - Number.parseFloat(st.borderRightWidth);
      // Three points outside the arc at each corner, in from its edges (the release lead's review of copylook
      // ee108ee50, SHOULD-2): what is inset a few pixels and reaches an edge covers part of the corner too.
      const points = [
        [left, box.top, 1, 1],
        [right, box.top, -1, 1],
        [left, box.bottom, 1, -1],
        [right, box.bottom, -1, -1],
      ].flatMap(([x = 0, y = 0, dx = 0, dy = 0]) =>
        [
          [1.5, 1.5],
          [4.5, 1],
          [1, 4.5],
        ].map(([ax = 0, ay = 0]) => [x + dx * ax, y + dy * ay] as const),
      );
      for (const [x, y] of points) {
        for (const el of document.elementsFromPoint(x, y)) {
          if (el === column) break;
          // Accepted (the review of copylook ee108ee50, SHOULD-2): LIVE's rows, 4 px in, cut by the column's foot or
          // top where what is under LIVE scrolls, cover at most about 3 x 8 px of a corner.
          if (!column.contains(el) || el.matches('[data-testid="live-rest"] > div > *')) continue;
          const own = getComputedStyle(el);
          const clear = /^rgba\(\d+, \d+, \d+, 0\)$|^transparent$/u.test(own.backgroundColor);
          if (clear && own.backgroundImage === 'none') continue;
          const what = el.getAttribute('data-testid') ?? el.tagName.toLowerCase();
          found.push(
            `${id} at ${String(Math.round(x))},${String(Math.round(y))}: ${what} ${own.backgroundColor} ${own.backgroundImage}`,
          );
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
  await chooseMenuItem(app, 'appearance-follow');
  await expect(win.locator('html')).toHaveAttribute('data-window-look', 'depth');
  await app.close();
});

/*
 * The release lead's review of copylook ee108ee50, MUST-1: what lies at the left column's foot while it is up, the
 * Library sheet (over the playlists, down to the column's foot) and an Undo line (the column's foot), has a background
 * of its own over the ring under it. In Depth their bottom corners are the panel's.
 */
test('B · Depth: the left column’s corners stay round with the Library open and with an Undo line up, light and dark', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(OWN_APPEARANCE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // A playlist with a presentation in it, open: its row is what an Undo line brings back.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [a] = await d.library.listPresentations();
    const made = await d.playlists.create('Placeholder corners', null, false);
    if (!made.ok) throw new Error(made.message);
    await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'presentation', presentationId: a?.id ?? '' },
    ]);
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
