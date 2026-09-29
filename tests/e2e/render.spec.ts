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
      return { lang, ok: r.width > innerWidth * 0.3 && r.height > 20 && inView && hit === el };
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
