import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { TEST_LINES } from '../../src/main/db/seed';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage } from './helpers';

async function outputPage(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((w) => w.url().includes('output.html'));
  if (existing) return existing;
  return app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
}

/** Create a screen group on the first display through the bridge; returns the screen id. */
async function setUpOneScreen(win: Page): Promise<string> {
  return win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const created = await d.screens.createGroup('Main Hall');
    if (!created.ok) throw new Error(created.message);
    const groupId = created.snapshot.groups[0]?.id ?? '';
    const displayId = created.snapshot.displays[0]?.id ?? -1;
    // The first display may hold the operator window; a test needs the output anyway.
    const assigned = await d.screens.assignDisplay(groupId, displayId, { coverOperator: true });
    if (!assigned.ok) throw new Error(assigned.message);
    return assigned.snapshot.groups[0]?.screens[0]?.id ?? '';
  });
}

test('the test slide renders all four languages with the bundled fonts, shaped correctly', async () => {
  const testInfo = test.info();
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await expect(win.getByTestId('presentation-list').getByRole('button')).toHaveCount(2);
  const screenId = await setUpOneScreen(win);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');

  const presentationId = await win.evaluate(async () => {
    const list = await (globalThis as PageGlobals).drashti.library.listPresentations();
    return list.find((p) => p.name === 'Language test slides')?.id ?? '';
  });
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    presentationId,
  );

  // Every line is on the output, and in the operator's preview (same renderer).
  for (const [lang, text] of Object.entries(TEST_LINES)) {
    await expect(output.locator(`[data-lang="${lang}"]`)).toHaveText(text);
    await expect(win.getByTestId('live-preview').locator(`[data-lang="${lang}"]`)).toHaveText(text);
  }

  // ...and actually painted: each line has a real size on screen and is what you hit at its centre.
  const painted = await output.evaluate(() =>
    ['en', 'gu', 'hi', 'translit'].map((lang) => {
      const el = document.querySelector(`[data-lang="${lang}"]`);
      if (!el) return { lang, ok: false };
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const inView = r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
      return {
        lang,
        ok: r.width > innerWidth * 0.3 && r.height > 20 && inView && hit !== null && el.contains(hit),
      };
    }),
  );
  expect(painted).toEqual(['en', 'gu', 'hi', 'translit'].map((lang) => ({ lang, ok: true })));

  // Fonts come from the app itself (no network), and are loaded.
  const fonts = await output.evaluate(() => {
    const urls: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const src = rule.style.getPropertyValue('src');
        for (const m of src.matchAll(/url\(["']?([^"')]+)["']?\)/g))
          urls.push(new URL(m[1] ?? '', sheet.href ?? document.baseURI).href);
      }
    }
    const loaded = Array.from(document.fonts)
      .filter((f) => f.status === 'loaded')
      .map((f) => f.family.replace(/["']/g, ''));
    return {
      urls,
      loadedFamilies: [...new Set(loaded)].sort(),
      gujarati: document.fonts.check('500 80px "Noto Sans Gujarati"', 'ક્ષ'),
      devanagari: document.fonts.check('500 80px "Noto Sans Devanagari"', 'क्ष'),
      latin: document.fonts.check('400 68px "Noto Sans"', 'āīṣṇḍṁ'),
    };
  });
  expect(fonts.urls.length).toBeGreaterThan(0);
  for (const url of fonts.urls) expect(url).toMatch(/^file:.*\.woff2?$/);
  expect(fonts.loadedFamilies).toEqual(['Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Gujarati']);
  expect(fonts).toMatchObject({ gujarati: true, devanagari: true, latin: true });

  // Chromium reports which font actually drew each line.
  const cdp = await output.context().newCDPSession(output);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const usedFonts: Record<string, string[]> = {};
  for (const lang of ['en', 'gu', 'hi', 'translit']) {
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `[data-lang="${lang}"]`,
    });
    const { fonts: platform } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    usedFonts[lang] = platform.map((f) => `${f.familyName}${f.isCustomFont ? '' : ' (system)'}`);
  }
  // One bundled (not system) face per line, e.g. "Noto Sans Gujarati Medium" for weight 500.
  const face = (family: string) => [expect.stringMatching(new RegExp(`^${family}( [A-Za-z]+)?$`))];
  expect(usedFonts['gu']).toEqual(face('Noto Sans Gujarati'));
  expect(usedFonts['hi']).toEqual(face('Noto Sans Devanagari'));
  expect(usedFonts['en']).toEqual(face('Noto Sans'));
  expect(usedFonts['translit']).toEqual(face('Noto Sans'));
  testInfo.annotations.push({ type: 'fonts used', description: JSON.stringify(usedFonts) });

  // Shaping: conjuncts become one glyph cluster, narrower than their parts drawn separately.
  const shaping = await output.evaluate(() => {
    const width = (text: string, font: string) => {
      const s = document.createElement('span');
      s.style.font = font;
      s.style.whiteSpace = 'pre';
      s.style.position = 'absolute';
      s.textContent = text;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const gu = '500 80px "Noto Sans Gujarati"';
    const hi = '500 80px "Noto Sans Devanagari"';
    const parts = (chars: string[], font: string) => chars.reduce((sum, c) => sum + width(c, font), 0);
    return {
      gujaratiKsha: width('ક્ષ', gu) < parts(['ક', '્', 'ષ'], gu) - 5,
      gujaratiSva: width('સ્વ', gu) < parts(['સ', '્', 'વ'], gu) - 5,
      devanagariKsha: width('क्ष', hi) < parts(['क', '्', 'ष'], hi) - 5,
      devanagariSva: width('स्व', hi) < parts(['स', '्', 'व'], hi) - 5,
    };
  });
  expect(shaping).toEqual({
    gujaratiKsha: true,
    gujaratiSva: true,
    devanagariKsha: true,
    devanagariSva: true,
  });

  await testInfo.attach('output-test-slide', { body: await output.screenshot(), contentType: 'image/png' });
  await output.screenshot({ path: testInfo.outputPath('output-test-slide.png') });
  await win.screenshot({ path: testInfo.outputPath('operator.png') });

  // Styled runs: one text box on the kirtan slide holds a large Gujarati line and a smaller italic
  // transliteration line, each in its own bundled font.
  const kirtanId = await win.evaluate(async () => {
    const list = await (globalThis as PageGlobals).drashti.library.listPresentations();
    return list.find((p) => p.name === 'Sample kirtan (placeholder)')?.id ?? '';
  });
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    kirtanId,
  );
  const guRun = output.locator('[data-run][data-lang="gu"]');
  const trRun = output.locator('[data-run][data-lang="translit"]');
  await expect(guRun).toHaveText('નમૂનાની પહેલી પંક્તિ');
  await expect(trRun).toHaveText('Namūnānī pahelī paṅkti');
  const runStyles = await output.evaluate(() =>
    ['gu', 'translit'].map((lang) => {
      const el = document.querySelector(`[data-run][data-lang="${lang}"]`);
      const cs = el ? getComputedStyle(el) : null;
      return { size: cs?.fontSize, style: cs?.fontStyle, weight: cs?.fontWeight };
    }),
  );
  expect(runStyles).toEqual([
    { size: '92px', style: 'normal', weight: '600' },
    { size: '60px', style: 'italic', weight: '400' },
  ]);
  const runFonts: string[][] = [];
  for (const selector of ['[data-run][data-lang="gu"]', '[data-run][data-lang="translit"]']) {
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: (await cdp.send('DOM.getDocument', { depth: -1 })).root.nodeId,
      selector,
    });
    runFonts.push((await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map((f) => f.familyName));
  }
  expect(runFonts[0]).toEqual(face('Noto Sans Gujarati'));
  expect(runFonts[1]).toEqual(face('Noto Sans'));
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    presentationId,
  );

  // Each screen has its own canvas: change it and the output redraws at that size.
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.screens.updateScreen(id, { canvasWidth: 1280, canvasHeight: 720 }),
    screenId,
  );
  await expect(output.getByTestId('scene')).toHaveAttribute('data-canvas', '1280x720');
  await expect(output.locator('[data-lang="gu"]')).toHaveText(TEST_LINES.gu);
  await app.close();
});

/** The colour of each point (CSS pixels) in a page screenshot, decoded in the page itself. */
async function pixels(page: Page, points: { x: number; y: number }[]): Promise<number[][]> {
  const png = (await page.screenshot({ scale: 'css' })).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      // Decoded by hand: the page's security policy refuses fetch() of a data URL.
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(bitmap, 0, 0);
      return points.map(({ x, y }) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data]);
    },
    { png, points },
  );
}

const near = (rgba: number[] | undefined, rgb: [number, number, number], within = 40) =>
  rgba !== undefined && rgb.every((c, i) => Math.abs((rgba[i] ?? -999) - c) <= within);

test('an output draws shapes, outlines, shadows, rotation and shrink-to-fit', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpOneScreen(win);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const style = {
    fontFamily: null,
    fontSize: 120,
    fontWeight: 700,
    color: '#ffffff',
    align: 'center' as const,
    verticalAlign: 'middle' as const,
    lineHeight: 1.2,
    shadow: false,
  };
  const long = Array.from({ length: 40 }, (_, i) => `Placeholder word ${i + 1}`).join(' ');
  await win.evaluate(
    async ({ style, long }) => {
      const d = (globalThis as PageGlobals).drashti;
      const result = await d.engine.dispatch({
        type: 'showProp',
        prop: {
          id: 'placeholder-look',
          name: 'Placeholder look',
          width: 1920,
          height: 1080,
          elements: [
            {
              id: 'outlined',
              kind: 'text',
              frame: { x: 60, y: 40, width: 800, height: 200 },
              text: 'OUTLINE',
              lang: 'en',
              style: { ...style, outline: { color: '#ff0000', width: 6 } },
            },
            {
              id: 'shadowed',
              kind: 'text',
              frame: { x: 1000, y: 40, width: 800, height: 200 },
              text: 'SHADOW',
              lang: 'en',
              style: { ...style, shadow: { color: '#00ff00', blur: 0, x: 14, y: 14 } },
            },
            {
              id: 'turned',
              kind: 'text',
              frame: { x: 60, y: 400, width: 400, height: 100 },
              rotation: 90,
              text: 'TURNED',
              lang: 'en',
              style: { ...style, fontSize: 60 },
            },
            {
              id: 'oval',
              kind: 'shape',
              shape: 'ellipse',
              frame: { x: 600, y: 360, width: 400, height: 300 },
              fill: '#0000ff',
              cornerRadius: 0,
              opacity: 1,
              outline: { color: '#ffff00', width: 10 },
            },
            {
              id: 'rule',
              kind: 'shape',
              shape: 'line',
              frame: { x: 1100, y: 400, width: 700, height: 40 },
              fill: null,
              cornerRadius: 0,
              opacity: 1,
              outline: { color: '#ff00ff', width: 12 },
            },
            {
              id: 'fitted',
              kind: 'text',
              frame: { x: 1100, y: 600, width: 700, height: 300 },
              text: long,
              lang: 'en',
              style: { ...style, fontSize: 90, shrinkToFit: true },
            },
            {
              id: 'overflowing',
              kind: 'text',
              frame: { x: 60, y: 760, width: 500, height: 100 },
              text: long,
              lang: 'en',
              style: { ...style, fontSize: 40, verticalAlign: 'top' },
            },
          ],
        },
      });
      if (!result.ok) throw new Error(result.message);
    },
    { style, long },
  );
  const el = (id: string) => output.locator(`[data-element="${id}"]`);
  await expect(el('outlined')).toHaveText('OUTLINE');

  // The styles the renderer gives each box.
  const css = await output.evaluate(() => {
    const cs = (id: string) => {
      const found = document.querySelector(`[data-element="${id}"]`);
      if (!found) throw new Error(`${id} is not on the output`);
      return getComputedStyle(found);
    };
    return {
      stroke: cs('outlined').getPropertyValue('-webkit-text-stroke-width'),
      paintOrder: cs('outlined').getPropertyValue('paint-order'),
      shadow: cs('shadowed').textShadow,
      turned: cs('turned').transform,
    };
  });
  expect(css).toEqual({
    stroke: '12px',
    // Stroke first, then the letters over it (Chromium leaves out the rest of the default order).
    paintOrder: 'stroke',
    shadow: 'rgb(0, 255, 0) 14px 14px 0px',
    turned: 'matrix(0, 1, -1, 0, 0, 0)',
  });

  // Turned a quarter: its bounds on screen are tall, not wide.
  const turned = await el('turned').boundingBox();
  expect(turned && turned.height > turned.width * 3).toBe(true);

  // Shrink-to-fit: the words are made smaller until they fit; without it they run over.
  const fit = await output.evaluate(() => {
    const box = (id: string) => {
      const found = document.querySelector<HTMLElement>(`[data-element="${id}"]`);
      if (!found) throw new Error(`${id} is not on the output`);
      return found;
    };
    const words = (id: string) => {
      const found = box(id).firstElementChild;
      if (!(found instanceof HTMLElement)) throw new Error(`${id} has no words`);
      return found;
    };
    return {
      fit: Number(box('fitted').dataset['fit']),
      fits: words('fitted').offsetHeight <= box('fitted').clientHeight + 1,
      overflows: words('overflowing').offsetHeight > box('overflowing').clientHeight,
    };
  });
  expect(fit.fit).toBeGreaterThan(0.1);
  expect(fit.fit).toBeLessThan(1);
  expect(fit).toMatchObject({ fits: true, overflows: true });

  // What is painted: the outline in red round white letters, the shadow in green, the ellipse
  // filled blue with a yellow edge (its frame's corner left black), and the magenta line.
  const at = async (id: string) => {
    const b = await el(id).boundingBox();
    if (!b) throw new Error(`${id} is not on the output`);
    return b;
  };
  const outlined = await at('outlined');
  const shadowed = await at('shadowed');
  const oval = await at('oval');
  const rule = await at('rule');
  const scale = oval.width / 400;
  const scanRow = (b: { x: number; y: number; width: number; height: number }) =>
    Array.from({ length: 120 }, (_, i) => ({ x: b.x + (b.width * i) / 120, y: b.y + b.height / 2 }));
  const outlineRow = await pixels(output, scanRow(outlined));
  const shadowRow = await pixels(output, scanRow(shadowed));
  expect(outlineRow.filter((p) => near(p, [255, 0, 0], 60)).length).toBeGreaterThan(5);
  expect(outlineRow.filter((p) => near(p, [255, 255, 255], 30)).length).toBeGreaterThan(0);
  expect(shadowRow.filter((p) => near(p, [0, 255, 0], 60)).length).toBeGreaterThan(5);
  const [middle, corner, edge, line] = await pixels(output, [
    { x: oval.x + oval.width / 2, y: oval.y + oval.height / 2 },
    { x: oval.x + 3 * scale, y: oval.y + 3 * scale },
    { x: oval.x + oval.width / 2, y: oval.y + 1 * scale },
    { x: rule.x + rule.width / 2, y: rule.y + rule.height / 2 },
  ]);
  expect(near(middle, [0, 0, 255])).toBe(true);
  expect(near(corner, [0, 0, 0])).toBe(true);
  expect(near(edge, [255, 255, 0], 60)).toBe(true);
  expect(near(line, [255, 0, 255])).toBe(true);
  await test.info().attach('output-look', { body: await output.screenshot(), contentType: 'image/png' });
  await app.close();
});
