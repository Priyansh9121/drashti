import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { Appearance } from '../../src/shared/appearance/appearances';
import { APPEARANCE_FAMILIES, BUILT_IN, familyOf } from '../../src/shared/appearance/appearances';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * What Drashti's own windows draw, in every appearance (Sessions 39–40; Session 26g's checks): the mark beside the
 * name in the logo's own colours, plain surfaces in the appearance's colours with no lamp light (nor the phone
 * pages, Black since Session 41), a warning still a filled amber rail with an icon and words, the live slide's underglow switching
 * at once, and nothing that costs a computer without a graphics chip a new way of drawing. Session 44: the header
 * and the panels' title strips may be a static gradient (decoration only), never moving and never on a show
 * control, the live picture or words; Black and White draw none. Placeholder content only.
 */

const style = (l: Locator, prop: string, pseudo: string | null = null) =>
  l.evaluate((el, { p, ps }) => getComputedStyle(el, ps).getPropertyValue(p), { p: prop, ps: pseudo });

/** "#rrggbb" as getComputedStyle writes it. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))).join(', ')})`;

/** The header's gradient as the page reports it (Session 44): none in Black and White. */
const headerGradient = (a: Appearance) =>
  a.decoration.header === a.decoration['header-2']
    ? 'none'
    : `linear-gradient(90deg, ${rgb(a.decoration.header)}, ${rgb(a.decoration['header-2'])})`;

async function plainHeader(header: Locator, name: string, a: Appearance) {
  // The mark beside the name, decoration only: the heading still reads "Drashti".
  await expect(header.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(header.locator('h1 svg[data-mark]')).toBeVisible();
  // No light across the header and no hairline: the appearance's header colour (Session 42; Black's and White's
  // their panel), and since Session 44 its static gradient to its far end (none in Black and White), nothing
  // drawn before it.
  expect(await style(header, 'background-color')).toBe(rgb(a.decoration.header));
  expect(await style(header, 'background-image')).toBe(headerGradient(a));
  expect(await style(header, 'content', '::before')).toBe('none');
  expect(await style(header.locator('.mark-halo').first(), 'content', '::before')).toBe('none');
}

/*
 * Every appearance (Session 60: 64, in families), one family to a launch: the same checks for every one, the suite's
 * time growing by the appearances and not by a start of Drashti for each.
 */
const FAMILY_IDS = APPEARANCE_FAMILIES.map((family) => ({
  family,
  list: BUILT_IN.filter((a) => familyOf(a) === family),
}));

/** Back to Pro Mode from Simple Mode (only Pro Mode chooses an appearance). */
async function toProMode(app: Parameters<typeof chooseMenuItem>[0], win: Page): Promise<void> {
  if (!(await win.getByTestId('simple-mode').isVisible())) return;
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
}

for (const { family, list } of FAMILY_IDS) {
  test(`${family} (${list.map((a) => a.name).join(', ')}): the mark in the logo’s colours on plain surfaces, in Pro Mode and Simple Mode; a warning still a filled amber rail`, async () => {
    test.setTimeout(60_000 * list.length);
    const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
    const win = await operatorPage(app);
    await operatorReady(win);
    // Pro Mode in every one first, while there is no playlist yet: Simple Mode makes the day's sabha playlist as it
    // opens, and its empty place would be gone.
    for (const a of list)
      await test.step(`${a.name} in Pro Mode`, async () => {
        await chooseMenuItem(app, `appearance-${a.id}`);
        await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
        await plainHeader(win.getByTestId('app-header'), 'Drashti', a);
        // Empty places: the unlit lamp, in the quietest words' colour, with no light behind it.
        const playlists = win.getByText('No playlists yet');
        await expect(playlists).toBeVisible();
        const empty = win.locator('.lamp-empty').filter({ has: playlists });
        await expect(empty.getByTestId('unlit-lamp')).toBeVisible();
        expect(await style(empty, 'content', '::before')).toBe('none');
        expect(await style(empty.getByTestId('unlit-lamp'), 'color')).toBe(rgb(a.colours.faint));

        // A warning is a filled amber rail with an icon and words (the component gallery's), in this appearance.
        const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('gallery.html') });
        await chooseMenuItem(app, 'component-gallery');
        const gallery: Page = await opened;
        await expect(gallery.locator('html')).toHaveAttribute('data-appearance', a.id);
        const warning = gallery
          .getByText('Sound output not connected')
          .locator('xpath=ancestor::div[contains(@class,"border-l-4")][1]');
        await expect(warning).toBeVisible();
        expect(await style(warning, 'background-color')).toBe(rgb(a.colours['warning-bg']));
        expect(await style(warning, 'border-left-color')).toBe(rgb(a.colours.warning));
        expect(Number.parseFloat(await style(warning, 'border-left-width'))).toBeGreaterThanOrEqual(4);
        await expect(warning.locator('svg').first()).toBeVisible();
        await gallery.close();
      });
    // Then Simple Mode in every one: the same mark and plain header (chosen in Pro Mode, which alone chooses).
    for (const a of list)
      await test.step(`${a.name} in Simple Mode`, async () => {
        await toProMode(app, win);
        await chooseMenuItem(app, `appearance-${a.id}`);
        await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
        await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
        const simple = win.getByTestId('simple-mode');
        await expect(simple).toBeVisible();
        await plainHeader(simple.locator('header').first(), 'Drashti', a);
      });
    await app.close();
  });
}

test('the live slide’s red underglow sits under the live thumbnail and moves with it at once', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const thumbs = win.getByTestId('slide-thumb');
  await expect(thumbs.first()).toBeVisible();
  /** Which thumbnails glow red beneath (the live colour in their shadow). */
  const glowing = () =>
    thumbs.evaluateAll((all) =>
      all.flatMap((t, i) => (getComputedStyle(t).boxShadow.includes('rgba(212, 42, 49') ? [i] : [])),
    );
  // Nothing live yet: no glow.
  expect(await glowing()).toEqual([]);
  for (const i of [1, 0, 2]) {
    await thumbs.nth(i).click();
    await expect(thumbs.nth(i)).toHaveAttribute('aria-current', 'true');
    // In the same frame as the border: no transition or animation on it.
    expect(await glowing()).toEqual([i]);
    expect(await style(thumbs.nth(i), 'transition-duration')).toBe('0s');
    expect(await style(thumbs.nth(i), 'animation-name')).toBe('none');
  }
  await app.close();
});

/**
 * What in a page costs a computer without a graphics chip (app.css, "Depth"): a soft shadow round a rounded
 * corner, any gradient but the primary's and the decoration's (Session 44: the header and the title strips,
 * static), and a shape filled with a gradient (the mark is flat beside a name), each a new way of drawing for the
 * chip to work out; and a layer of its own (will-change), which is put together again at every frame. A
 * decoration's gradient never moves and is never on a show control or the live picture, and no words are ever
 * filled with one. Slides themselves (inside a scene) are the audience's. So is the graphics chip's own warm-up
 * (Session 60, X21: operator/PanelWarmUp.tsx, marked data-chip-warm-up): it draws only where Chromium draws WITH a
 * chip, the chip's ways of drawing made ahead or kept, and chipWarmUps holds it to its own rules.
 */
function newWaysToDraw(page: Page) {
  return page.evaluate(() => {
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
    const name = (el: Element, pseudo: string | null) =>
      `${el.getAttribute('data-testid') ?? el.tagName.toLowerCase()}${pseudo ?? ''} ${(el.getAttribute('class') ?? '').slice(0, 60)}`;
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[data-testid="scene"]')) continue;
      // The graphics chip's own warm-up (chipWarmUps below holds it to its own rules).
      if (el.closest('[data-chip-warm-up]')) continue;
      // A live look's touch (Session 60, the owner's Q60-36 (3)): only where Chromium draws with a graphics chip,
      // after the window has opened; lookTouches below holds it to its own rules.
      if (el.closest('[data-touch-layer]')) continue;
      for (const pseudo of [null, '::before', '::after']) {
        const st = getComputedStyle(el, pseudo);
        if (pseudo !== null && st.content === 'none') continue;
        if (st.boxShadow !== 'none') {
          const corner = Math.max(
            ...[
              st.borderTopLeftRadius,
              st.borderTopRightRadius,
              st.borderBottomLeftRadius,
              st.borderBottomRightRadius,
            ].map((r) => Number.parseFloat(r) || 0),
          );
          for (const shadow of parts(st.boxShadow)) {
            if (shadow.includes('inset')) continue;
            const [, , blur = 0, spread = 0] = [
              ...shadow.replace(/rgba?\([^)]*\)/gu, '').matchAll(/(-?[\d.]+)px/gu),
            ].map((m) => Number(m[1]));
            if (blur > 0 && spread + corner > 0)
              found.push(
                `${name(el, pseudo)}: a blur round a ${String(corner)} px corner (${shadow.trim()})`,
              );
          }
        }
        if (st.backgroundImage.includes('gradient(')) {
          const primary = pseudo === null && el.getAttribute('data-variant') === 'primary';
          const decoration = pseudo === null && el.matches('[data-header], [data-strip], [data-decoration]');
          if (!primary && !decoration) found.push(`${name(el, pseudo)}: ${st.backgroundImage.slice(0, 80)}`);
          if (decoration) {
            const seconds = (list: string) =>
              Math.max(...list.split(',').map((t) => Number.parseFloat(t) || 0));
            const moving =
              st.animationName !== 'none' ||
              (seconds(st.transitionDuration) > 0 && /all|background/u.test(st.transitionProperty));
            if (moving) found.push(`${name(el, pseudo)}: a gradient that moves`);
            if (
              el.matches('[data-show-control]') ||
              el.querySelector('[data-show-control], [data-testid="live-preview"]')
            )
              found.push(`${name(el, pseudo)}: a gradient under a show control or the live picture`);
          }
        }
        if (st.backgroundClip === 'text' || st.getPropertyValue('-webkit-background-clip') === 'text')
          found.push(`${name(el, pseudo)}: words filled with a picture or a gradient`);
        if (st.willChange !== 'auto')
          found.push(`${name(el, pseudo)}: a layer of its own (${st.willChange})`);
        if (pseudo === null && el instanceof SVGElement && `${st.fill} ${st.stroke}`.includes('url('))
          found.push(`${name(el, pseudo)}: a shape filled with a gradient`);
      }
    }
    return [...new Set(found)];
  });
}

/**
 * The graphics chip's own warm-up in the operator window (Session 60, X21: operator/PanelWarmUp.tsx), marked
 * data-chip-warm-up and passed over by newWaysToDraw: the Stream panel's pieces drawn unseen while the LIVE picture
 * warms up (in its black box, under brightness(0)), and the keeper of the primary button's kind (a speck under a
 * cover of the heading's own colour). Where Chromium draws without a graphics chip there is none of it at all; where it
 * draws with one, the keeper is always there; and each is unreachable and unread, and as small and unseen as built.
 */
async function chipWarmUps(page: Page, what: string): Promise<void> {
  const { chipless, marks } = await page.evaluate(async () => ({
    chipless: await (globalThis as PageGlobals).drashti.app.noGpu(),
    marks: [...document.querySelectorAll('[data-chip-warm-up]')].map((el) => {
      const box = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-testid') ?? el.tagName.toLowerCase(),
        hidden: el.getAttribute('aria-hidden') === 'true',
        inert: el instanceof HTMLElement && el.inert,
        width: box.width,
        height: box.height,
        where: el.parentElement?.closest('[data-testid="live-preview"]')
          ? 'the LIVE picture'
          : el.closest('#live-preview-title')
            ? 'the LIVE heading'
            : 'elsewhere',
        // Its own layers each drawn black (the tray's), and nothing in it that can be reached.
        unfiltered: [...el.querySelectorAll('*')].filter((inner) => {
          const st = getComputedStyle(inner);
          return st.willChange !== 'auto' && st.filter !== 'brightness(0)';
        }).length,
        reachable: el.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').length,
      };
    }),
  }));
  if (chipless) {
    expect(marks, `${what}: none of the chip's warm-up without a graphics chip`).toEqual([]);
    return;
  }
  expect(
    marks.map((m) => m.id),
    `${what}: the primary's kind kept, with a graphics chip`,
  ).toContain('panel-kind-keeper');
  for (const m of marks) {
    expect(m, `${what}: ${m.id}`).toMatchObject({ hidden: true, inert: true, reachable: 0 });
    if (m.id === 'panel-kind-keeper') {
      const speck = `${what}: the keeper, a speck in the LIVE heading`;
      expect(m, speck).toMatchObject({ where: 'the LIVE heading' });
      expect(m.width * m.height, speck).toBeLessThanOrEqual(32 * 16);
    } else {
      const tray = `${what}: the warm-up's pieces in the LIVE picture's black box, each layer black`;
      expect(m, tray).toMatchObject({ id: 'panel-warm-up', where: 'the LIVE picture', unfiltered: 0 });
    }
  }
}

for (const { family, list } of FAMILY_IDS)
  test(`${family} (${list.map((a) => a.name).join(', ')}): in the window, Simple Mode, the Appearance window and every component: no new way of drawing, no layer of its own`, async () => {
    // Each new way of drawing costs a computer without a graphics chip a pause the first time (CI's Mac:
    // 100–600 ms each, in the Performance check's slide changes), and each layer costs it every frame,
    // so every appearance keeps to the few ways it needs and adds no layer.
    test.setTimeout(90_000 * list.length);
    const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
    const win = await operatorPage(app);
    await operatorReady(win);
    for (const a of list)
      await test.step(a.name, async () => {
        await toProMode(app, win);
        // Nothing live, as the window first is.
        await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
        await chooseMenuItem(app, `appearance-${a.id}`);
        await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
        expect(await newWaysToDraw(win), 'the window, nothing live').toEqual([]);
        await chipWarmUps(win, 'the window, nothing live');
        await win.evaluate(async () => {
          const d = (globalThis as PageGlobals).drashti;
          const [p] = await d.library.listPresentations();
          await d.engine.dispatch({ type: 'goLive', presentationId: p?.id ?? '', slideIndex: 0 });
        });
        await expect(win.getByTestId('live-preview')).toHaveClass(/border-live/u);
        expect(await newWaysToDraw(win), 'the window in a show').toEqual([]);
        await chipWarmUps(win, 'the window in a show');
        await chooseMenuItem(app, 'keyboard-shortcuts');
        await expect(win.getByRole('dialog')).toBeVisible();
        expect(await newWaysToDraw(win), 'a dialog').toEqual([]);
        await win.keyboard.press('Escape');
        await expect(win.getByRole('dialog')).toHaveCount(0);
        await chooseMenuItem(app, 'appearance-window');
        await expect(win.getByTestId('appearance-dialog')).toBeVisible();
        expect(await newWaysToDraw(win), 'the Appearance window').toEqual([]);
        await win.keyboard.press('Escape');
        await expect(win.getByRole('dialog')).toHaveCount(0);

        const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('gallery.html') });
        await chooseMenuItem(app, 'component-gallery');
        const gallery: Page = await opened;
        await expect(gallery.getByRole('heading', { name: 'Component gallery' })).toBeVisible();
        expect(await newWaysToDraw(gallery), 'the component gallery').toEqual([]);
        await gallery.getByRole('button', { name: 'Open a dialog' }).click();
        await expect(gallery.getByRole('dialog')).toBeVisible();
        expect(await newWaysToDraw(gallery), 'the gallery’s dialog').toEqual([]);
        await gallery.close();

        await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
        await expect(win.getByTestId('simple-mode')).toBeVisible();
        expect(await newWaysToDraw(win), 'Simple Mode').toEqual([]);
        await lookTouches(win, a);
      });
    await app.close();
  });

/**
 * A live look's touch (Session 60): never where Chromium draws without a graphics chip; with one, only in the header
 * and over the band, unreachable and unread, no layer of its own (will-change) and nothing in it a show control;
 * and a still look draws none.
 */
async function lookTouches(page: Page, a: Appearance): Promise<void> {
  // Once Chromium has said whether it draws with a graphics chip (data-chip: unknown until then).
  await expect(page.locator('html')).toHaveAttribute('data-chip', /^(yes|no)$/u);
  const { chipless, layers } = await page.evaluate(() => ({
    chipless: document.documentElement.dataset['chip'] === 'no',
    layers: [...document.querySelectorAll('[data-touch-layer]')].map((el) => ({
      where: el.getAttribute('data-touch-layer'),
      inHeader: el.parentElement?.matches('[data-header]') === true,
      hidden: el.getAttribute('aria-hidden') === 'true',
      inert: el instanceof HTMLElement && el.inert,
      willChange: [el, ...el.querySelectorAll('*')].filter((x) => getComputedStyle(x).willChange !== 'auto')
        .length,
      reachable: el.querySelectorAll(
        'button, a[href], input, select, textarea, [tabindex], [data-show-control]',
      ).length,
    })),
  }));
  if (chipless || a.moving === undefined) {
    expect(layers, `${a.name}: no touch ${chipless ? 'without a graphics chip' : 'in a still look'}`).toEqual(
      [],
    );
    return;
  }
  for (const l of layers) {
    expect(l, `${a.name}: its touch`).toMatchObject({
      hidden: true,
      inert: true,
      willChange: 0,
      reachable: 0,
    });
    if (l.where === 'header')
      expect(l.inHeader, `${a.name}: the header's touch is inside the header`).toBe(true);
    else expect(l.where).toBe('band');
  }
}
