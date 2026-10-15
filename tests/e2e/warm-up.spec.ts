import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { MOVEMENTS } from '../../src/shared/looks';
import { TRANSITION_KINDS } from '../../src/shared/model';
import { launchApp, operatorPage, operatorReady, outputPage, outputPages, setUpScreen } from './helpers';
import { goLive, makeSlides } from './placeholder-slides';

/*
 * Warming the GPU, unseen (Session 27, render/WarmUp.tsx): before a screen first draws the show, it draws
 * every transition kind in both Movements part-way, with a Look's lower third, messages, the ticker's band
 * and the idle rotation, under a brightness(0) filter, so the GPU has made what they need before the first
 * Bold transition of a show; the audience sees black throughout. A test switch keeps it drawn, to look at.
 * Placeholder words and pictures only.
 */

const HOLD = { DRASHTI_TEST_HOLD_WARM_UP: '1' };

/**
 * The brightest any pixel is (0 to 255, any channel) in a page's screenshot, or in one element's box of it,
 * 2 px in from its edges (a box at fractions of a pixel takes in what is around it: the LIVE picture's border).
 */
async function brightest(page: Page, selector?: string): Promise<number> {
  const box = selector ? await page.locator(selector).first().boundingBox() : null;
  const clip = box ? { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 } : null;
  const png = (await page.screenshot({ scale: 'css', ...(clip ? { clip } : {}) })).toString('base64');
  return page.evaluate(async (png) => {
    // Decoded by hand: the page's security policy refuses fetch() of a data URL.
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let max = 0;
    for (let i = 0; i < data.length; i += 4)
      max = Math.max(max, data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    return max;
  }, png);
}

/**
 * Each warm-up scene in `scope` as drawn now: its slide's transition, how far through, its words apart. Its
 * shadow tree is open only while the test switch keeps it drawn (closed, nothing finds it).
 */
const scenesIn = (page: Page, scope: string) =>
  page.evaluate((scope) => {
    const tree = document.querySelector(scope)?.querySelector('[data-warm-up]')?.shadowRoot;
    return [...(tree?.querySelectorAll<HTMLElement>('[data-warm-scene]') ?? [])].map((s) => {
      const layer = s.querySelector<HTMLElement>('[data-layer="slide"]');
      return {
        key: s.dataset['warmScene'] ?? '',
        kind: layer?.dataset['transition'] ?? '',
        fade: Number(layer?.dataset['fade'] ?? Number.NaN),
        apart: s.querySelector('[data-words-apart]')?.getAttribute('data-words-apart') ?? '',
        lowerThird: s.querySelector('[data-testid="lower-third"]') !== null,
        messages: s.querySelector('[data-layer="messages"]') !== null,
        ticker: s.querySelector('[data-layer="ticker"]') !== null,
        idle: s.querySelectorAll('[data-layer="idle"] [data-idle-item]').length,
      };
    });
  }, scope);

/** How each kind's words move on a Bold screen while it runs (a Calm one: only line by line and word by word). */
const BOLD_APART: Record<string, string> = {
  dissolve: 'settle',
  wipe: 'wipe',
  push: 'push',
  'zoom-dissolve': 'zoom',
  lines: 'lines',
  words: 'words',
};

/** What a page's warm-up draws, part-way, and that all of it is black. */
async function expectWarmUp(page: Page, scope: string, what: string, ticker = true): Promise<void> {
  await expect(page.locator(`${scope} [data-warm-up="during"]`), what).toHaveCount(1, { timeout: 30_000 });
  // Every frame of a transition that runs ten seconds, drawn by its own clock: part-way when looked at.
  await expect
    .poll(async () =>
      (await scenesIn(page, scope)).every(
        (s) => !s.key.includes('/') || !Number.isNaN(s.fade) || s.key.startsWith('lower-third'),
      ),
    )
    .toBe(true);
  const scenes = await scenesIn(page, scope);
  for (const movement of MOVEMENTS)
    for (const kind of TRANSITION_KINDS.filter((k) => k !== 'cut')) {
      const s = scenes.find((x) => x.key === `${kind}/${movement}`);
      expect(s?.kind, `${what}: ${kind} on ${movement}`).toBe(kind);
      expect(s?.fade, `${what}: ${kind} on ${movement} part-way`).toBeGreaterThan(0.3);
      expect(s?.fade, `${what}: ${kind} on ${movement} part-way`).toBeLessThan(0.7);
      const apart =
        movement === 'bold' ? (BOLD_APART[kind] ?? '') : kind === 'lines' || kind === 'words' ? kind : '';
      expect(s?.apart, `${what}: ${kind} on ${movement}, the words`).toBe(apart);
    }
  for (const movement of MOVEMENTS) {
    const fade = scenes.find((x) => x.key === `dissolve/${movement}`);
    expect(fade?.messages, `${what}: a message coming in on ${movement}`).toBe(true);
    expect(fade?.ticker, `${what}: the ticker's band on ${movement}`).toBe(ticker);
    for (const phase of ['in', 'change'])
      expect(
        scenes.find((x) => x.key === `lower-third-${phase}/${movement}`)?.lowerThird,
        `${what}: a lower third ${phase} on ${movement}`,
      ).toBe(true);
  }
  expect(scenes.find((x) => x.key === 'idle')?.idle, `${what}: the idle rotation dissolving`).toBe(2);
  // The audience sees none of it.
  expect(await brightest(page, `${scope} [data-warm-up]`), `${what}: black throughout`).toBe(0);
}

async function streamPage(app: ElectronApplication): Promise<Page> {
  const isStream = (p: Page) => p.url().includes('stream.html');
  return app.windows().find(isStream) ?? app.waitForEvent('window', { predicate: isStream });
}

test('before a screen first draws the show it draws every kind in both Movements part-way, unseen: an output, the LIVE picture and the stream’s page', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...HOLD, DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_FAKE_DEVICES: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await expectWarmUp(win, '[data-testid="live-preview"]', 'the LIVE picture');
  await setUpScreen(win);
  const out = await outputPage(app);
  await expectWarmUp(out, '[data-testid="output-root"]', 'an output');
  // Until it is done, the show is not drawn there (nor is the screen ready).
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'loading');
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-warm-up', 'warming');
  expect(await brightest(out), 'the whole output').toBe(0);
  await win.getByTestId('open-stream').click();
  const program = await streamPage(app);
  // The stream draws no ticker.
  await expectWarmUp(program, '[data-testid="program-root"]', 'the stream’s page', false);
  await app.close();
});

test('the warm-up passes by itself and the show is drawn after it; the screen is black until then', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const id = await makeSlides(
    win,
    'Placeholder warm-up slides',
    [{ words: 'Placeholder words', background: '#3a6ea5' }],
    {
      kind: 'dissolve',
      durationMs: 400,
    },
  );
  await expect(win.locator('[data-testid="live-preview"] [data-warm-up]')).toHaveCount(0, {
    timeout: 60_000,
  });
  // Every frame each new window draws, from its first: the brightest pixel (every 7th looked at).
  await app.evaluate(({ app }) => {
    const seen = new Map<number, { url: string; frames: number; max: number; stop: () => void }>();
    (globalThis as { warmFrames?: typeof seen }).warmFrames = seen;
    app.on('browser-window-created', (_event, w) => {
      const id = w.webContents.id;
      const mine = { url: '', frames: 0, max: 0, stop: () => w.webContents.endFrameSubscription() };
      seen.set(id, mine);
      // From its page's first moments (a frame subscription before then gets nothing): the warm-up waits
      // for the fonts and its pictures, so it has drawn nothing yet.
      w.webContents.once('dom-ready', () => {
        w.webContents.beginFrameSubscription(false, (image) => {
          const bitmap = image.toBitmap();
          let max = 0;
          for (let i = 0; i + 2 < bitmap.length; i += 28)
            max = Math.max(max, bitmap[i] ?? 0, bitmap[i + 1] ?? 0, bitmap[i + 2] ?? 0);
          mine.url = w.webContents.getURL();
          mine.frames += 1;
          mine.max = Math.max(mine.max, max);
        });
      });
    });
  });
  await setUpScreen(win);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const out = await outputPage(app);
  const root = out.getByTestId('output-root');
  await expect(root).toHaveAttribute('data-warm-up', 'done', { timeout: 60_000 });
  const frames = await app.evaluate(() => {
    const seen = (
      globalThis as {
        warmFrames?: Map<number, { url: string; frames: number; max: number; stop: () => void }>;
      }
    ).warmFrames;
    const all = [...(seen?.values() ?? [])];
    for (const w of all) w.stop();
    const output = all.find((w) => w.url.includes('output.html'));
    return {
      frames: output?.frames ?? 0,
      max: output?.max ?? -1,
      windows: all.map((w) => `${w.url.split('?')[0] ?? ''} ${String(w.frames)}`),
    };
  });
  expect(frames.frames, `frames drawn while it warmed up (${frames.windows.join('; ')})`).toBeGreaterThan(3);
  expect(frames.max, `black throughout (${String(frames.frames)} frames)`).toBe(0);
  await expect(root).toHaveAttribute('data-fonts', 'ready');
  await expect(out.locator('[data-warm-up]')).toHaveCount(1);
  await expect(out.locator('[data-warm-scene]')).toHaveCount(0);
  // Then the show draws as ever.
  await goLive(win, id, 0);
  await expect.poll(() => brightest(out), { timeout: 15_000 }).toBeGreaterThan(40);
  await app.close();
});
