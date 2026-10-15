import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Diya, Drashti's own look (Session 26g), in the real window: the mark beside the name, the lamp's
 * light falling from it, the unlit lamp in empty places, and nothing in that light that could be
 * taken for a warning. Placeholder content only.
 */

/** The lamp's light, as getComputedStyle writes it. */
const LAMP = /rgba\(255, 176, 128, 0\.\d+\)/u;
/** The warning colour (#f2b23e), which the lamp's light never is. */
const WARNING = 'rgb(242, 178, 62)';

const style = (l: Locator, prop: string, pseudo: string | null = null) =>
  l.evaluate((el, { p, ps }) => getComputedStyle(el, ps).getPropertyValue(p), { p: prop, ps: pseudo });

async function lampHeader(header: Locator, name: string) {
  // The mark beside the name, decoration only: the heading still reads "Drashti".
  await expect(header.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(header.locator('h1 svg[data-mark]')).toBeVisible();
  // The lamp's light across the header and the hairline beneath it, both drawn once on a layer of
  // their own under the words, as radial gradients only (app.css, "The lamp"), on the panel's colour.
  const light = await style(header, 'background-image', '::before');
  expect(light).toMatch(LAMP);
  expect(light.match(/radial-gradient\(/gu)).toHaveLength(2);
  expect(light).not.toContain('linear-gradient');
  expect(await style(header, 'will-change', '::before')).toBe('transform');
  expect(await style(header, 'background-color')).toBe('rgb(30, 16, 29)');
  expect(light).not.toContain(WARNING);
}

test('the mark beside the name and the lamp’s light, in Pro Mode and Simple Mode; never a warning', async () => {
  const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await lampHeader(win.getByTestId('app-header'), 'Drashti');
  // The window: the lamp's light from the top left, over ink, never a filled shape.
  const window = win.locator('.lamp-window').first();
  expect(await style(window, 'background-image', '::before')).toMatch(LAMP);
  expect(await style(window, 'will-change', '::before')).toBe('transform');
  expect(await style(window, 'background-color')).toBe('rgb(21, 10, 20)');

  // Empty places: the unlit lamp in its faint light, with no colour of a warning.
  const playlists = win.getByText('No playlists yet');
  await expect(playlists).toBeVisible();
  const empty = win.locator('.lamp-empty').filter({ has: playlists });
  await expect(empty.getByTestId('unlit-lamp')).toBeVisible();
  expect(await style(empty, 'background-image', '::before')).toMatch(LAMP);
  expect(await style(empty, 'will-change', '::before')).toBe('transform');
  expect(await style(empty, 'background-color')).toBe('rgba(0, 0, 0, 0)');

  // A warning is still a filled amber rail with an icon and words (the component gallery's).
  const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('gallery.html') });
  await chooseMenuItem(app, 'component-gallery');
  const gallery: Page = await opened;
  const warning = gallery
    .getByText('Sound output not connected')
    .locator('xpath=ancestor::div[contains(@class,"border-l-4")][1]');
  await expect(warning).toBeVisible();
  expect(await style(warning, 'background-color')).toBe('rgb(59, 42, 10)');
  expect(await style(warning, 'border-left-color')).toBe(WARNING);
  expect(Number.parseFloat(await style(warning, 'border-left-width'))).toBeGreaterThanOrEqual(4);
  await expect(warning.locator('svg').first()).toBeVisible();
  await gallery.close();

  // Simple Mode: the same mark and light.
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  await lampHeader(simple.locator('header').first(), 'Drashti');
  await app.close();
});

test('the live slide’s red underglow sits under the live thumbnail and moves with it at once', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const glow = win.getByTestId('live-glow');
  const thumbs = win.getByTestId('slide-thumb');
  await expect(thumbs.first()).toBeVisible();
  // Nothing live yet: no glow.
  expect(await style(glow, 'opacity')).toBe('0');
  /** The glow's middle and top, against a thumbnail's middle and bottom edge (page pixels). */
  const under = async (i: number) => {
    const [g, t] = await Promise.all([glow.boundingBox(), thumbs.nth(i).boundingBox()]);
    if (!g || !t) return false;
    return Math.abs(g.x + g.width / 2 - (t.x + t.width / 2)) < 2 && Math.abs(g.y - (t.y + t.height - 12)) < 2;
  };
  for (const i of [1, 0, 2]) {
    await thumbs.nth(i).click();
    await expect(thumbs.nth(i)).toHaveAttribute('aria-current', 'true');
    // In the same frame as the border: no transition or animation on it.
    expect(await style(glow, 'opacity')).toBe('1');
    expect(await under(i)).toBe(true);
    expect(await style(glow, 'transition-duration')).toBe('0s');
    expect(await style(glow, 'animation-name')).toBe('none');
  }
  // A layer of its own, drawn once and moved by the compositor.
  expect(await style(glow, 'will-change')).toBe('transform');
  await app.close();
});

/**
 * What in a page the graphics chip would have to work out a new way of drawing for (app.css, "Depth"
 * and "The lamp"): a soft shadow round a rounded corner (each needs a mask or a blur profile drawn
 * first), and a gradient anywhere but the lamp's light on a layer of its own (radial only) or the
 * primary's plum. Slides themselves (inside a scene) are the audience's, not Diya's.
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
          const lamp =
            st.willChange.includes('transform') && !/(linear|conic)-gradient\(/u.test(st.backgroundImage);
          const plum = pseudo === null && el.getAttribute('data-variant') === 'primary';
          if (!lamp && !plum) found.push(`${name(el, pseudo)}: ${st.backgroundImage.slice(0, 80)}`);
        }
      }
    }
    return [...new Set(found)];
  });
}

test('in the window, Simple Mode and every component, nothing new for the graphics chip to work out', async () => {
  // Each new way of drawing costs a computer without a graphics chip a pause the first time (CI's Mac:
  // 100–600 ms each, in the Performance check's slide changes), so Diya keeps to the few it needs.
  const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
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
