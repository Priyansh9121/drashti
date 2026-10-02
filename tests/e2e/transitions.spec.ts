import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, outputPages, setUpScreen } from './helpers';
import { makeTestImage } from './test-media';

/*
 * Transitions (Session 7): a dissolve runs on two audience screens at the
 * same moment (timed from the engine's clock), a background the slide
 * brings dissolves with it, a slide's pictures are loaded before its fade
 * starts, a screen that joins afterwards shows the finished slide, and the
 * stage screen always cuts. Placeholder words and generated pictures.
 */

const MS = 1500;

async function screens(app: ElectronApplication): Promise<{ audience: Page[]; stage: Page }> {
  await expect.poll(() => outputPages(app).length).toBe(3);
  const pages = outputPages(app);
  const roles = () => Promise.all(pages.map((p) => p.getByTestId('output-root').getAttribute('data-role')));
  await expect.poll(async () => (await roles()).sort().join(', ')).toBe('audience, audience, stage');
  const r = await roles();
  const stage = pages[r.indexOf('stage')];
  if (!stage) throw new Error('no stage screen');
  return { audience: pages.filter((_, i) => r[i] === 'audience'), stage };
}

const shownAt = (win: Page) =>
  win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.shownAt,
  );

const goLive = (win: Page, presentationId: string, slideIndex: number) =>
  win.evaluate(
    ({ presentationId, slideIndex }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex }),
    { presentationId, slideIndex },
  );

/** When a screen's slide (or background) dissolve started, or null while it waits or is not fading. */
const fadeStart = (page: Page, layer: 'slide' | 'background') =>
  page.locator(`[data-layer="${layer}"][data-fading="true"]`).evaluateAll((els) => {
    const v = els[0]?.getAttribute('data-fade-start');
    return v ? Number(v) : null;
  });

const notFading = async (pages: Page[]) => {
  for (const p of pages) await expect(p.locator('[data-fading="true"]')).toHaveCount(0, { timeout: MS * 4 });
};

test('a dissolve on two screens at once, with its background, after its pictures load; the stage cuts', async () => {
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
    DRASHTI_TEST_MEDIA_DELAY_MS: '300',
  });
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-transitions-'));
  const words = join(dir, 'Placeholder Dissolving.txt');
  writeFileSync(words, '[Verse]\nPlaceholder first\n\nPlaceholder second\n\nPlaceholder third\n');
  const backdrop = await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), {
    width: 320,
    height: 180,
    color: '#204060',
  });
  const placed = await makeTestImage(win, join(dir, 'Placeholder placed.png'), {
    width: 320,
    height: 180,
    color: '#806020',
  });
  const [id = ''] = await importAndGetIds(win, [words, backdrop, placed]);
  // The presentation dissolves; the second slide brings a background, the third has a picture on it.
  await win.evaluate(
    async ({ id, ms }) => {
      const d = (globalThis as PageGlobals).drashti;
      const media = await d.library.listMedia();
      const backdropId = media.find((m) => m.name.startsWith('Placeholder backdrop'))?.id ?? '';
      const placedId = media.find((m) => m.name.startsWith('Placeholder placed'))?.id ?? '';
      const opened = await d.library.slidesForEdit(id);
      if (!opened.ok) throw new Error(opened.message);
      const doc = opened.doc;
      doc.transition = { kind: 'dissolve', durationMs: ms };
      const [, second, third] = doc.groups[0]?.slides ?? [];
      if (!second || !third) throw new Error('slides missing');
      second.cues = [
        {
          id: 'placeholder-bg',
          kind: 'background',
          label: '',
          mediaId: backdropId,
          props: JSON.stringify({ media: 'image', fit: 'fill', loop: false }),
        },
      ];
      third.elements.push({
        id: 'placeholder-pic',
        kind: 'image',
        frame: { x: 100, y: 100, width: 640, height: 360 },
        mediaId: placedId,
        fit: 'fit',
      });
      const saved = await d.library.saveSlides(id, doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
    },
    { id, ms: MS },
  );
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Side Hall', 1);
  await setUpScreen(win, 'Stage', 2);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const stage = (await d.screens.get()).groups.find((g) => g.name === 'Stage');
    if (stage) await d.screens.setGroupRole(stage.id, 'stage');
  });
  const { audience, stage } = await screens(app);
  const [one, two] = audience;
  if (!one || !two) throw new Error('two audience screens expected');

  // The first slide fades in from nothing, then settles.
  expect(await goLive(win, id, 0)).toMatchObject({ ok: true });
  for (const p of audience)
    await expect(p.locator('[data-layer="slide"]')).toContainText('Placeholder first');
  await notFading(audience);

  // Straight to the third slide (its picture was not loaded ahead): the old slide stays fully up until
  // the picture can be drawn, then the dissolve starts, after the slide went live.
  await goLive(win, id, 2);
  const third = await shownAt(win);
  for (const p of audience) await expect(p.locator('[data-slide-out]')).toContainText('Placeholder first');
  await expect.poll(() => fadeStart(one, 'slide')).not.toBeNull();
  expect((await fadeStart(one, 'slide')) ?? 0).toBeGreaterThanOrEqual((third ?? 0) + 250);
  // The stage screen has the new words at once.
  await expect(stage.getByTestId('stage-current')).toContainText('Placeholder third');
  await notFading(audience);
  for (const p of audience) await expect(p.locator('[data-slide-out]')).toHaveCount(0);

  // The second slide: no pictures of its own, so both screens dissolve from the very moment it went
  // live; the background it brings dissolves with it.
  await goLive(win, id, 1);
  const second = await shownAt(win);
  await expect.poll(() => fadeStart(one, 'slide')).toBe(second);
  await expect.poll(() => fadeStart(two, 'slide')).toBe(second);
  for (const p of audience) {
    await expect(p.locator('[data-slide-in]')).toContainText('Placeholder second');
    await expect(p.locator('[data-slide-out]')).toContainText('Placeholder third');
  }
  await expect.poll(() => fadeStart(one, 'background')).not.toBeNull();
  await expect.poll(() => fadeStart(two, 'background')).not.toBeNull();
  const bgStarts = [await fadeStart(one, 'background'), await fadeStart(two, 'background')];
  expect(Math.abs((bgStarts[0] ?? 0) - (bgStarts[1] ?? 0))).toBeLessThan(100);
  // The stage screen never fades.
  await expect(stage.getByTestId('stage-current')).toContainText('Placeholder second');
  await expect(stage.locator('[data-fading]')).toHaveCount(0);
  await notFading(audience);
  for (const p of audience)
    await expect(p.locator('[data-layer="slide"]')).toHaveText(/^Placeholder second$/u);

  // A screen that comes along afterwards shows the finished slide.
  await two.reload();
  await expect(two.locator('[data-layer="slide"]')).toContainText('Placeholder second');
  await expect(two.locator('[data-fading="true"]')).toHaveCount(0);

  // Black-out and clearing stay immediate.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearLayer', layer: 'slide' }),
  );
  for (const p of audience) await expect(p.locator('[data-layer="slide"]')).toHaveCount(0);
  await app.close();
});
