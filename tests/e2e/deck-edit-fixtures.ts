/*
 * Part 17b's generated deck fixtures: actual source PPTX bytes, imported through
 * the existing converter/baker stand-ins. No native source words are seeded.
 * Conversion-warning labels are provisional until its owned UI is implemented;
 * every product API and fixture imported here already exists.
 */
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
// Existing host-Node E2E pattern. This repo ships better-sqlite3 13.0.3
// Node-API prebuilds unchanged in Electron (electron-builder.yml:106);
// the repository README documents its Node prerequisites.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import {
  makeTestDeck,
  placeholderDeckMedia,
  type TestDeckSlide,
} from '../../src/main/import/testing/make-deck';
import type { DeckSlide } from '../../src/shared/deck';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorWindow,
  type PageGlobals,
} from './helpers';

export const SOURCE_WORDS = [
  'Placeholder amber original',
  'Placeholder cobalt original',
  'Placeholder jade original',
] as const;
export const REPLACEMENT = 'Placeholder cobalt revised';

// PROPOSED LABELS ONLY: not implemented. Match the final owned UI's accessible
// names here, keeping all warning timing/scope/Cancel assertions below intact.
export const DRAFT_WARNING = {
  title: 'Edit this animated slide',
  accept: 'Make this slide editable',
  cancel: 'Keep original',
} as const;

export const hashFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export function sourceFixture(animated: boolean): { name: string; file: string; sha256: string } {
  const name = animated ? 'Placeholder animated source edits' : 'Placeholder static source edits';
  const dir = mkdtempSync(join(tmpdir(), 'drashti-deck-edit-source-'));
  const file = join(dir, `${name}.pptx`);
  if (!animated) {
    writeFileSync(
      file,
      makeTestPptx(
        SOURCE_WORDS.map((text, i) => ({
          color: ['204060', '305020', '503020'][i] ?? '204060',
          text,
          notes: `Placeholder source notes ${String(i + 1)}`,
        })),
      ),
    );
  } else {
    const inch = 914_400;
    const slides: TestDeckSlide[] = SOURCE_WORDS.map((text, i) => ({
      key: `source-${String(i + 1)}`,
      bg: ['204060', '305020', '503020'][i] ?? '204060',
      transition: { kind: 'fade', dur: 100 },
      notes: `Placeholder source notes ${String(i + 1)}`,
      shapes: [
        {
          id: 2,
          type: 'text',
          name: 'Placeholder source words',
          x: inch,
          y: 2 * inch,
          w: 10 * inch,
          h: 1.5 * inch,
          paras: [{ text, size: 36, color: 'FFFFFF' }],
        },
        {
          id: 3,
          type: 'text',
          name: 'Placeholder click words',
          x: inch,
          y: 4.5 * inch,
          w: 10 * inch,
          h: inch,
          paras: [{ text: `Placeholder click ${String(i + 1)}`, size: 28, color: 'FFFFFF' }],
        },
      ],
      effects: [
        { kind: 'fade', target: 3, dur: 100, start: 'click' },
        { kind: 'exit-fade', target: 3, dur: 100, start: 'click' },
      ],
    }));
    // No media-bearing shape or transition references a media key, so these
    // placeholder buffers are never embedded/decoded/played by this fixture.
    writeFileSync(file, makeTestDeck(slides, placeholderDeckMedia()));
  }
  return { name, file, sha256: hashFile(file) };
}

export async function openSource(animated: boolean) {
  const fixture = sourceFixture(animated);
  const { app, userData } = await launchApp({
    DRASHTI_TEST_DECK_CONVERTER: '1',
    ...(animated ? { DRASHTI_TEST_DECK_BAKER: '1' } : {}),
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const [id = ''] = await importAndGetIds(win, [fixture.file]);
    // Existing fixture setup, never the claimed Part 17b behavioral red.
    expect(id, 'the existing generated-source import must succeed before feature assertions').not.toBe('');
    const before = rawContent(userData, id);
    expect(before.slides).toHaveLength(3);
    if (animated && before.slides.some((slide) => slide.deck === null)) {
      // Failure-only evidence from this fresh placeholder library; preserve every baking assertion below.
      const report = await win.evaluate(async () => {
        const { drashti } = window as unknown as PageGlobals;
        const runs = await drashti.library.listImportRuns();
        const run = runs[0];
        return run ? drashti.library.getImportReport(run.id) : null;
      });
      await test.info().attach('generated-deck-import-report', {
        body: Buffer.from(JSON.stringify(report, null, 2)),
        contentType: 'application/json',
      });
    }
    if (animated)
      for (const slide of before.slides) {
        expect(slide.deck, 'existing baker stand-in produced a baked source slide').not.toBeNull();
        expect((JSON.parse(slide.deck ?? 'null') as DeckSlide | null)?.steps).toHaveLength(3);
      }
    const { ed, editor } = await openEditor(app, win, fixture.name);
    return { app, win, userData, id, ed, editor, fixture, before };
  } catch (error) {
    await app.close();
    throw error;
  }
}

export async function openEditor(app: ElectronApplication, win: Page, name: string) {
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByTestId('presentation-row')
    .filter({ hasText: name })
    .click();
  await win.getByTestId('edit-slides').click();
  const opened = await slideEditorWindow(app);
  await sizeSlideEditor(app, opened.ed, { width: 1280, height: 720 });
  return opened;
}

export function sourceWord(editor: Locator, text: string): Locator {
  return editor.getByTestId('editor-slide').locator('[data-element]').filter({ hasText: text });
}

// Existing read-only host-Node DB pattern, supported by the repo's Node-API
// package contract, not an assumed Electron-specific addon rebuild. Scope is
// only launchApp's fresh generated-data folder, never the builder's/user's
// library. Raw strings protect unknown JSON; the handle closes before return.
export function rawContent(userData: string, id: string) {
  const db = new Database(join(userData, 'drashti.sqlite'), { readonly: true });
  try {
    const slides = db
      .prepare(
        `SELECT s.* FROM slides s JOIN slide_groups g ON g.id = s.group_id
         WHERE g.presentation_id = ? ORDER BY g.position, s.position`,
      )
      .all(id) as { id: string; deck: string | null; notes: string; [key: string]: unknown }[];
    const elements = db
      .prepare(
        `SELECT e.* FROM elements e JOIN slides s ON s.id = e.slide_id
         JOIN slide_groups g ON g.id = s.group_id
         WHERE g.presentation_id = ? ORDER BY g.position, s.position, e.position`,
      )
      .all(id) as { slide_id: string; [key: string]: unknown }[];
    const cues = db
      .prepare(
        `SELECT c.* FROM slide_cues c JOIN slides s ON s.id = c.slide_id
         JOIN slide_groups g ON g.id = s.group_id
         WHERE g.presentation_id = ? ORDER BY g.position, s.position, c.position`,
      )
      .all(id) as { slide_id: string; [key: string]: unknown }[];
    const revision = db.prepare('SELECT content_rev FROM presentations WHERE id = ?').get(id);
    return { slides, elements, cues, revision };
  } finally {
    db.close();
  }
}

export const contentOnly = (rows: ReturnType<typeof rawContent>) => ({
  slides: rows.slides,
  elements: rows.elements,
  cues: rows.cues,
});

export const canvasSnapshot = (editor: Locator) =>
  editor
    .getByTestId('editor-slide')
    .locator('[data-element]')
    .evaluateAll((elements) =>
      elements.map((e) => ({
        id: e.getAttribute('data-element'),
        text: e.textContent,
        style: e.getAttribute('style'),
      })),
    );

/** Known generated title frame center: x = 6 / 13⅓, y = 2¾ / 7½. */
export async function sourcePoint(ed: Page) {
  const canvas = ed.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  const scale = Number(await canvas.getAttribute('data-scale'));
  const size = await ed.evaluate(() => {
    const slide = document.querySelector<HTMLElement>('[data-testid="editor-slide"]');
    if (!slide) throw new Error('editor slide is not mounted');
    const parent = slide.parentElement;
    if (!parent) throw new Error('editor slide has no coordinate wrapper');
    return { width: parseFloat(parent.style.width), height: parseFloat(parent.style.height) };
  });
  if (!box || !Number.isFinite(scale) || !Number.isFinite(size.width) || !Number.isFinite(size.height))
    throw new Error('existing editor canvas geometry is unavailable');
  return { x: box.x + size.width * 0.45 * scale, y: box.y + size.height * (11 / 30) * scale, scale };
}

export async function firstContentIntent(ed: Page, kind: 'typing' | 'drag') {
  const p = await sourcePoint(ed);
  if (kind === 'typing') {
    await ed.mouse.click(p.x, p.y);
    await ed.keyboard.press('Enter');
  } else {
    await ed.mouse.move(p.x, p.y);
    await ed.mouse.down();
    try {
      await ed.mouse.move(p.x + 40 * p.scale, p.y + 20 * p.scale, { steps: 8 });
    } finally {
      await ed.mouse.up();
    }
  }
}

export function warning(ed: Page) {
  // Proposed accessible name only: current application has no such dialog.
  return ed.getByRole('dialog', { name: DRAFT_WARNING.title });
}

export async function expectWarningBeforeChange(ed: Page, editor: Locator, beforeCanvas: unknown) {
  const ask = warning(ed);
  await expect(
    ask,
    'editing an animated imported slide requires notice before its first content change',
  ).toBeVisible();
  await expect(ask).toContainText('Only this slide');
  await expect(ask).toContainText('animations');
  await expect(ask).toContainText('original file');
  // Neither live typing nor a drag preview may mutate under the warning.
  expect(await canvasSnapshot(editor)).toEqual(beforeCanvas);
  await expect(editor.getByTestId('text-editing')).toHaveCount(0);
}

export const publicSlides = (win: Page, id: string) =>
  win.evaluate(async (presentationId) => {
    const p = await (globalThis as PageGlobals).drashti.library.getPresentation(presentationId);
    return (p?.groups ?? []).flatMap((g) => g.slides);
  }, id);

export async function unchangedClicks(win: Page, id: string, index: number) {
  const dispatch = (
    command: { type: 'goLive'; presentationId: string; slideIndex: number } | { type: 'next' | 'back' },
  ) => win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
  const layer = () =>
    win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide,
    );
  await dispatch({ type: 'goLive', presentationId: id, slideIndex: index });
  await expect.poll(async () => (await layer())?.step).toBe(0);
  await dispatch({ type: 'next' });
  await expect.poll(async () => (await layer())?.step).toBe(1);
  await dispatch({ type: 'back' });
  await expect.poll(async () => (await layer())?.step).toBe(0);
  await dispatch({ type: 'next' });
  await dispatch({ type: 'next' });
  await expect.poll(async () => (await layer())?.step).toBe(2);
}
