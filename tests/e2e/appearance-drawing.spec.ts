import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { BUILT_IN } from '../../src/shared/appearance/appearances';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * What Drashti's own windows draw, in every appearance (Sessions 39–40; Session 26g's checks): the mark beside the
 * name in the logo's own colours, plain surfaces in the appearance's colours with no lamp light (nor the phone
 * pages, Black since Session 41), a warning still a filled amber rail with an icon and words, the live slide's underglow switching
 * at once, and nothing that costs a computer without a graphics chip a new way of drawing. Placeholder content
 * only.
 */

const style = (l: Locator, prop: string, pseudo: string | null = null) =>
  l.evaluate((el, { p, ps }) => getComputedStyle(el, ps).getPropertyValue(p), { p: prop, ps: pseudo });

/** "#rrggbb" as getComputedStyle writes it. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))).join(', ')})`;

async function plainHeader(header: Locator, name: string, panel: string) {
  // The mark beside the name, decoration only: the heading still reads "Drashti".
  await expect(header.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(header.locator('h1 svg[data-mark]')).toBeVisible();
  // No light across the header and no hairline: the panel's own colour, nothing drawn before it.
  expect(await style(header, 'background-color')).toBe(rgb(panel));
  expect(await style(header, 'background-image')).toBe('none');
  expect(await style(header, 'content', '::before')).toBe('none');
  expect(await style(header.locator('.mark-halo').first(), 'content', '::before')).toBe('none');
}

for (const a of BUILT_IN) {
  test(`${a.name}: the mark in the logo’s colours on plain surfaces, in Pro Mode and Simple Mode; a warning still a filled amber rail`, async () => {
    const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
    const win = await operatorPage(app);
    await operatorReady(win);
    await chooseMenuItem(app, `appearance-${a.id}`);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
    await plainHeader(win.getByTestId('app-header'), 'Drashti', a.colours.panel);
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

    // Simple Mode: the same mark and plain header.
    await win.getByRole('button', { name: 'Simple Mode' }).click();
    const simple = win.getByTestId('simple-mode');
    await expect(simple).toBeVisible();
    await plainHeader(simple.locator('header').first(), 'Drashti', a.colours.panel);
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
 * corner, any gradient but the primary's, and a shape filled with a gradient (the mark is flat beside a name),
 * each a new way of drawing for the chip to work out; and a layer of its own (will-change), which is put
 * together again at every frame. Slides themselves (inside a scene) are the audience's.
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
          if (!primary) found.push(`${name(el, pseudo)}: ${st.backgroundImage.slice(0, 80)}`);
        }
        if (st.willChange !== 'auto')
          found.push(`${name(el, pseudo)}: a layer of its own (${st.willChange})`);
        if (pseudo === null && el instanceof SVGElement && `${st.fill} ${st.stroke}`.includes('url('))
          found.push(`${name(el, pseudo)}: a shape filled with a gradient`);
      }
    }
    return [...new Set(found)];
  });
}

for (const a of BUILT_IN)
  test(`${a.name}: in the window, Simple Mode, the Appearance window and every component: no new way of drawing, no layer of its own`, async () => {
    // Each new way of drawing costs a computer without a graphics chip a pause the first time (CI's Mac:
    // 100–600 ms each, in the Performance check's slide changes), and each layer costs it every frame,
    // so every appearance keeps to the few ways it needs and adds no layer.
    const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
    const win = await operatorPage(app);
    await operatorReady(win);
    await chooseMenuItem(app, `appearance-${a.id}`);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
    expect(await newWaysToDraw(win), 'the window, nothing live').toEqual([]);
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const [p] = await d.library.listPresentations();
      await d.engine.dispatch({ type: 'goLive', presentationId: p?.id ?? '', slideIndex: 0 });
    });
    await expect(win.getByTestId('live-preview')).toHaveClass(/border-live/u);
    expect(await newWaysToDraw(win), 'the window in a show').toEqual([]);
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

    await win.getByRole('button', { name: 'Simple Mode' }).click();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    expect(await newWaysToDraw(win), 'Simple Mode').toEqual([]);
    await app.close();
  });
