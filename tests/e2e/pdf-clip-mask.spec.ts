import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clippedWordsPdf,
  maskedWordsPdf,
  PDF_EDITABLE_WORDS,
} from '../../src/main/documents/testing/pdf-native-effects';
import { publicSlides, sourceWord } from './deck-edit-fixtures';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';

test('clipped and masked PDF drawings stay in place after editing their page words', async () => {
  test.setTimeout(180_000);
  const folder = mkdtempSync(join(tmpdir(), 'drashti-pdf-effects-'));
  try {
    const samples = [
      {
        name: 'Placeholder clipped page',
        bytes: clippedWordsPdf(),
        kinds: ['image', 'text', 'image'],
      },
      {
        name: 'Placeholder masked page',
        bytes: maskedWordsPdf(),
        kinds: ['image', 'text'],
      },
    ].map((sample) => {
      const file = join(folder, sample.name + '.pdf');
      writeFileSync(file, sample.bytes);
      return { ...sample, file };
    });

    const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const ids = await importAndGetIds(
        win,
        samples.map((sample) => sample.file),
      );
      for (const [index, sample] of samples.entries()) {
        const id = ids[index];
        if (!id) throw new Error('The generated PDF was not imported.');
        const before = await publicSlides(win, id);
        await openLibrary(win);
        await win
          .getByTestId('presentation-list')
          .getByTestId('presentation-row')
          .filter({ hasText: sample.name })
          .click();
        await win.getByTestId('edit-slides').click();
        const { editor } = await slideEditorWindow(app);
        const words = sourceWord(editor, PDF_EDITABLE_WORDS);
        await expect(words).toBeVisible();
        expect(await publicSlides(win, id)).toEqual(before);
        await words.dblclick({ position: { x: 5, y: 5 } });
        const typing = editor.getByTestId('text-editing');
        await expect(typing).toBeFocused();
        await typing.fill('Placeholder revised words');
        await editor.getByTestId('save-slides').click();
        await slideEditorClosed(app);

        const [saved] = await publicSlides(win, id);
        const elements = saved?.slide.elements ?? [];
        expect(elements.map((element) => element.kind)).toEqual(sample.kinds);
        expect(elements.find((element) => element.kind === 'text')?.text).toBe('Placeholder revised words');
        expect(readFileSync(sample.file)).toEqual(sample.bytes);
      }
    } finally {
      await app.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
