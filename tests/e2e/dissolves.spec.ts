import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady, outputPage, setUpScreen } from './helpers';
import { makeTestImage } from './test-media';

/*
 * Dissolves that never dim or pop (Session 23, MOT-1). A background that a
 * dissolving slide brings fades in over the old one; a slide that brings
 * another background before that fade has finished used to leave the half-
 * faded picture on screen at its half-way opacity (dim) until the next one
 * was ready. Generated pictures and placeholder words only.
 */

const MS = 3000;

const goLive = (win: Page, presentationId: string, slideIndex: number) =>
  win.evaluate(
    ({ presentationId, slideIndex }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex }),
    { presentationId, slideIndex },
  );

/** The background pictures on screen (ready and visible), each with its own and its wrapper's opacity. */
const shownBackgrounds = (out: Page) =>
  out.locator('[data-layer="background"] [data-bg-slot]').evaluateAll((els) =>
    els
      .filter((el) => el.getAttribute('data-state') === 'ready' && (el as HTMLElement).style.opacity === '1')
      .map((el) => ({
        media: el.getAttribute('data-media-id') ?? '',
        wrapper: el.parentElement?.style.opacity ?? '',
      })),
  );

test('a background dissolve cut short by another background never leaves the picture dim', async () => {
  test.setTimeout(120_000);
  // Every picture takes 1.5 s to load, as from a slow disk: the third background is still loading
  // while the second is half-way through its dissolve.
  const { app } = await launchApp({ DRASHTI_TEST_MEDIA_DELAY_MS: '1500' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-dissolves-'));
  const words = join(dir, 'Placeholder Three Backgrounds.txt');
  writeFileSync(words, '[Verse]\nPlaceholder one\n\nPlaceholder two\n\nPlaceholder three\n');
  const colours = ['#204060', '#602040', '#406020'];
  const pictures = await Promise.all(
    colours.map((color, i) =>
      makeTestImage(win, join(dir, `Placeholder background ${i + 1}.png`), {
        width: 320,
        height: 180,
        color,
      }),
    ),
  );
  const [id = ''] = await importAndGetIds(win, [words, ...pictures]);
  const backgrounds = await win.evaluate(
    async ({ id, ms }) => {
      const d = (globalThis as PageGlobals).drashti;
      const media = await d.library.listMedia();
      const ids = [1, 2, 3].map(
        (n) => media.find((m) => m.name.startsWith(`Placeholder background ${n}`))?.id ?? '',
      );
      const opened = await d.library.slidesForEdit(id);
      if (!opened.ok) throw new Error(opened.message);
      const doc = opened.doc;
      doc.transition = { kind: 'dissolve', durationMs: ms };
      const slides = doc.groups[0]?.slides ?? [];
      if (slides.length < 3) throw new Error('slides missing');
      slides.slice(0, 3).forEach((slide, i) => {
        slide.cues = [
          {
            id: `placeholder-bg-${i}`,
            kind: 'background',
            label: '',
            mediaId: ids[i] ?? '',
            props: JSON.stringify({ media: 'image', fit: 'fill', loop: false }),
          },
        ];
      });
      const saved = await d.library.saveSlides(id, doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
      return ids;
    },
    { id, ms: MS },
  );
  await setUpScreen(win);
  const out = await outputPage(app);

  // The first background, settled.
  await goLive(win, id, 0);
  await expect.poll(async () => (await shownBackgrounds(out)).map((b) => b.media)).toEqual([backgrounds[0]]);
  await expect(out.locator('[data-layer="background"][data-fading="true"]')).toHaveCount(0, {
    timeout: MS * 3,
  });

  // The second, dissolving in over it: about a third of the way through...
  await goLive(win, id, 1);
  await expect(out.locator('[data-layer="background"][data-fading="true"]')).toHaveCount(1, {
    timeout: 15_000,
  });
  await out.waitForTimeout(MS / 3);
  // ...the third arrives, and loads for a moment and a half.
  await goLive(win, id, 2);
  await expect(out.locator(`[data-media-id="${backgrounds[2]}"][data-state="loading"]`)).toHaveCount(1);
  // Meanwhile what is on screen adds up to the whole picture (a dissolve's two pictures are added
  // together): never one left part-way through its dissolve, dim. Looked at several times.
  for (let i = 0; i < 5; i++) {
    const shown = await shownBackgrounds(out);
    const strength = shown.reduce((sum, b) => sum + Number(b.wrapper || '1'), 0);
    expect(strength, JSON.stringify(shown)).toBeCloseTo(1, 1);
    await out.waitForTimeout(200);
  }
  // Once the third is ready and its own dissolve is over, it alone is on screen, at full strength.
  await expect
    .poll(async () => (await shownBackgrounds(out)).map((b) => `${b.media} at ${b.wrapper || '1'}`), {
      timeout: 20_000,
    })
    .toEqual([`${backgrounds[2]} at 1`]);
  await app.close();
});

test('a screen that opens part-way through a dissolve shows the slide and its background whole, never fading in from black', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_TEST_MEDIA_DELAY_MS: '300' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-dissolves-'));
  const words = join(dir, 'Placeholder Joining.txt');
  writeFileSync(words, '[Verse]\nPlaceholder before\n\nPlaceholder after\n');
  const picture = await makeTestImage(win, join(dir, 'Placeholder joined background.png'), {
    width: 320,
    height: 180,
    color: '#305070',
  });
  const [id = ''] = await importAndGetIds(win, [words, picture]);
  const background = await win.evaluate(
    async ({ id, ms }) => {
      const d = (globalThis as PageGlobals).drashti;
      const media = await d.library.listMedia();
      const bg = media.find((m) => m.name.startsWith('Placeholder joined background'))?.id ?? '';
      const opened = await d.library.slidesForEdit(id);
      if (!opened.ok) throw new Error(opened.message);
      const doc = opened.doc;
      doc.transition = { kind: 'dissolve', durationMs: ms };
      const second = doc.groups[0]?.slides[1];
      if (!second) throw new Error('slides missing');
      second.cues = [
        {
          id: 'placeholder-bg',
          kind: 'background',
          label: '',
          mediaId: bg,
          props: JSON.stringify({ media: 'image', fit: 'fill', loop: false }),
        },
      ];
      const saved = await d.library.saveSlides(id, doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
      return bg;
    },
    { id, ms: MS },
  );
  await setUpScreen(win);
  const out = await outputPage(app);
  await goLive(win, id, 0);
  await expect(out.locator('[data-layer="slide"]')).toContainText('Placeholder before');
  await expect(out.locator('[data-fading="true"]')).toHaveCount(0, { timeout: MS * 3 });
  // From the next page on, the output's page notes whether anything fades, and how strong its
  // background is whenever one is on screen (a reload clears what the page knew).
  await out.addInitScript(() => {
    const watch = { fading: false, weakest: 1 };
    (globalThis as { joinWatch?: typeof watch }).joinWatch = watch;
    const look = () => {
      if (document.querySelector('[data-fading="true"]')) watch.fading = true;
      let sum = 0;
      let any = false;
      for (const el of document.querySelectorAll<HTMLElement>('[data-layer="background"] [data-bg-slot]')) {
        if (el.getAttribute('data-state') !== 'ready' || el.style.opacity !== '1') continue;
        any = true;
        const opacity = el.parentElement?.style.opacity;
        sum += opacity ? Number(opacity) : 1;
      }
      if (any) watch.weakest = Math.min(watch.weakest, sum);
    };
    new MutationObserver(look).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'data-fading', 'data-state'],
    });
  });
  // The slide that brings the background dissolves; part-way through, the screen opens again.
  await goLive(win, id, 1);
  await expect(out.locator('[data-layer="slide"][data-fading="true"]')).toHaveCount(1, { timeout: 15_000 });
  await out.waitForTimeout(MS / 5);
  await out.reload();
  await expect(out.locator(`[data-bg-slot][data-media-id="${background}"][data-state="ready"]`)).toHaveCount(
    1,
    {
      timeout: 15_000,
    },
  );
  await expect(out.locator('[data-layer="slide"]')).toContainText('Placeholder after');
  const watched = await out.evaluate(
    () => (globalThis as { joinWatch?: { fading: boolean; weakest: number } }).joinWatch,
  );
  expect(watched).toEqual({ fading: false, weakest: 1 });
  await app.close();
});
