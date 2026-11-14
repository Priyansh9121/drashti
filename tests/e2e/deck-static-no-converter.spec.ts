import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { dropFiles, launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { importItem } from './import-details';

const cases: { title: string; env: Record<string, string>; editable: boolean }[] = [
  {
    title: 'a still PowerPoint deck opens as editable slides without a picture converter',
    env: { DRASHTI_TEST_NO_CONVERTER: '1' },
    editable: true,
  },
  {
    title: 'a still PowerPoint deck uses its picture converter even when movies cannot be made',
    env: { DRASHTI_TEST_DECK_CONVERTER: '1' },
    editable: false,
  },
];

for (const { title, env, editable } of cases) {
  test(title, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'drashti-static-deck-'));
    try {
      const name = 'Placeholder still deck';
      const file = join(dir, `${name}.pptx`);
      await writeFile(
        file,
        makeTestPptx([
          // Typed in an old Hindi font (Q58-8): it comes in all the same, a notice naming the font.
          {
            text: 'Placeholder first slide',
            color: '204060',
            notes: 'Placeholder first notes',
            font: 'Kruti Dev 010',
          },
          { text: 'Placeholder hidden slide', color: '604020', hidden: true },
          { text: 'Placeholder last slide', color: '305030', notes: 'Placeholder last notes' },
        ]),
      );
      const { app } = await launchApp(env);
      try {
        const win = await operatorPage(app);
        await operatorReady(win);
        await openLibrary(win);
        await dropFiles(win, win.getByTestId('library-drop'), [file]);
        await expect.poll(() => importItem(win, file)).toMatchObject({ outcome: 'imported' });
        await expect(win.getByTestId('import-notice').filter({ hasText: 'old font' })).toContainText(
          `“${name}” · This presentation uses the old font “Kruti Dev 010”: install it on this computer and on each node`,
        );

        const slides = await win.evaluate(async (deckName) => {
          const d = (globalThis as PageGlobals).drashti;
          const found = (await d.library.listPresentations()).find((p) => p.name === deckName);
          const doc = found ? await d.library.getPresentation(found.id) : null;
          return (doc?.groups ?? []).flatMap((group) =>
            group.slides.map(({ notes, slide }) => ({
              notes,
              words: slide.elements.flatMap((e) => (e.kind === 'text' ? [e.text] : [])),
              motion: slide.deck?.motion ?? null,
            })),
          );
        }, name);
        expect(slides).toEqual([
          {
            notes: 'Placeholder first notes',
            words: editable ? ['Placeholder first slide'] : [],
            motion: null,
          },
          {
            notes: 'Placeholder last notes',
            words: editable ? ['Placeholder last slide'] : [],
            motion: null,
          },
        ]);
      } finally {
        await app.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
