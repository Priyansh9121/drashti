/*
 * Part 17b: source deck words, advance conversion notice, one-slide conversion
 * and Undo, with untouched source bytes and other slides' exact baked state.
 * Warning labels are provisional constants in deck-edit-fixtures.ts; all other
 * bridge, fixture and UI helpers already exist. Generated content only.
 */
import { expect, test } from '@playwright/test';
import { editorGroup, slideEditorClosed } from './helpers';
import {
  canvasSnapshot,
  contentOnly,
  DRAFT_WARNING,
  expectWarningBeforeChange,
  firstContentIntent,
  hashFile,
  openSource,
  publicSlides,
  rawContent,
  REPLACEMENT,
  SOURCE_WORDS,
  sourcePoint,
  sourceWord,
  unchangedClicks,
  warning,
} from './deck-edit-fixtures';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('a static imported PPTX opens with its actual source words editable and keeps its source bytes unchanged', async () => {
  test.setTimeout(180_000);
  const s = await openSource(false);
  try {
    const word = sourceWord(s.editor, SOURCE_WORDS[0]);
    // FIRST BEHAVIORAL RED: current import/editor has only the page image.
    await expect(word, 'source words must be a native editable item, not baked glyphs').toBeVisible();
    await expect(s.editor.getByTestId('editor-slide')).not.toContainText(/Placeholder [0-9a-f]{8} page/u);
    await word.dblclick();
    const typing = s.editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await expect(typing).toHaveText(SOURCE_WORDS[0]);
    await typing.press(`${mod}+A`);
    await s.ed.keyboard.insertText('Placeholder amber revised');
    await expect(typing).toHaveText('Placeholder amber revised');
    // Saving while actively typing also retains the last unblurred words.
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    const saved = await publicSlides(s.win, s.id);
    expect(
      saved[0]?.slide.elements
        .filter((e) => e.kind === 'text')
        .map((e) => e.text)
        .join('\n'),
    ).toContain('Placeholder amber revised');
    expect(contentOnly(rawContent(s.userData, s.id)).slides.slice(1)).toEqual(s.before.slides.slice(1));
    expect(hashFile(s.fixture.file)).toBe(s.fixture.sha256);
  } finally {
    await s.app.close();
  }
});

test('opening an animated source exposes editable source words without converting or changing playback merely on open', async () => {
  test.setTimeout(240_000);
  const s = await openSource(true);
  try {
    for (let i = 0; i < SOURCE_WORDS.length; i++) {
      await s.editor.getByTestId('editor-slide-thumb').nth(i).click();
      // FIRST BEHAVIORAL RED: old slides show only stand-in last-frame images.
      await expect(
        sourceWord(s.editor, SOURCE_WORDS[i] ?? ''),
        'read source OOXML, not the stand-in hash page',
      ).toBeVisible();
      await expect(warning(s.ed)).toHaveCount(0);
    }
    expect(rawContent(s.userData, s.id)).toEqual(s.before);
    expect(hashFile(s.fixture.file)).toBe(s.fixture.sha256);
    await expect(s.editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(s.editor.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  } finally {
    await s.app.close();
  }
});

for (const kind of ['typing', 'drag'] as const) {
  test(`before an animated slide's first ${kind}, its warning can be cancelled without any page or history change`, async () => {
    test.setTimeout(240_000);
    const s = await openSource(true);
    try {
      await s.editor.getByTestId('editor-slide-thumb').nth(1).click();
      const beforeCanvas = await canvasSnapshot(s.editor);
      await firstContentIntent(s.ed, kind);
      // FIRST BEHAVIORAL RED: current editor has no conversion warning.
      await expectWarningBeforeChange(s.ed, s.editor, beforeCanvas);
      await warning(s.ed).getByRole('button', { name: DRAFT_WARNING.cancel, exact: true }).click();
      await expect(warning(s.ed)).toHaveCount(0);
      expect(await canvasSnapshot(s.editor)).toEqual(beforeCanvas);
      await expect(s.editor.getByTestId('text-editing')).toHaveCount(0);
      await expect(s.editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await expect(s.editor.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
      expect(rawContent(s.userData, s.id)).toEqual(s.before);
      expect(hashFile(s.fixture.file)).toBe(s.fixture.sha256);

      // Cancel has not silently acknowledged conversion for the next gesture.
      await firstContentIntent(s.ed, kind);
      await expectWarningBeforeChange(s.ed, s.editor, beforeCanvas);
      await warning(s.ed).getByRole('button', { name: DRAFT_WARNING.cancel, exact: true }).click();
      expect(rawContent(s.userData, s.id)).toEqual(s.before);
    } finally {
      await s.app.close();
    }
  });

  test(`accepting an animated slide's first ${kind} converts only that slide; other clicks and exact deck JSON survive, and Undo restores it`, async () => {
    test.setTimeout(240_000);
    const s = await openSource(true);
    try {
      await s.editor.getByTestId('editor-slide-thumb').nth(1).click();
      const beforeCanvas = await canvasSnapshot(s.editor);
      await firstContentIntent(s.ed, kind);
      // FIRST BEHAVIORAL RED: missing advance warning, not a new export/API call.
      await expectWarningBeforeChange(s.ed, s.editor, beforeCanvas);
      await warning(s.ed).getByRole('button', { name: DRAFT_WARNING.accept, exact: true }).click();
      await expect(warning(s.ed)).toHaveCount(0);
      const word = sourceWord(s.editor, SOURCE_WORDS[1]);
      await expect(word).toBeVisible();
      if (kind === 'typing') {
        // The acknowledged first intent may already have entered typing; either
        // way this changes real source words, never seeds a replacement fixture.
        if ((await s.editor.getByTestId('text-editing').count()) === 0) await word.dblclick();
        const typing = s.editor.getByTestId('text-editing');
        await expect(typing).toBeFocused();
        await typing.press(`${mod}+A`);
        await s.ed.keyboard.insertText(REPLACEMENT);
        await expect(typing).toHaveText(REPLACEMENT);
      } else {
        const beforeBox = await word.boundingBox();
        expect(beforeBox).not.toBeNull();
        const p = await sourcePoint(s.ed);
        await s.ed.mouse.move(p.x, p.y);
        await s.ed.mouse.down();
        try {
          await s.ed.mouse.move(p.x + 60 * p.scale, p.y + 30 * p.scale, { steps: 8 });
        } finally {
          await s.ed.mouse.up();
        }
        await expect.poll(async () => (await word.boundingBox())?.x ?? 0).not.toBe(beforeBox?.x ?? 0);
        await expect(warning(s.ed)).toHaveCount(0);
      }
      // Accepting/working in the editor cannot change the source or saved show
      // until Save. Capture raw deck strings, including unknown fields.
      expect(rawContent(s.userData, s.id)).toEqual(s.before);
      expect(hashFile(s.fixture.file)).toBe(s.fixture.sha256);
      await s.editor.getByTestId('save-slides').click();
      await slideEditorClosed(s.app);

      const after = rawContent(s.userData, s.id);
      expect(after.slides.map((row) => row.id)).toEqual(s.before.slides.map((row) => row.id));
      expect(after.slides[1]?.deck).toBeNull();
      for (const index of [0, 2]) {
        const old = s.before.slides[index];
        expect(old).toBeDefined();
        expect(after.slides[index]).toEqual(old);
        expect(after.slides[index]?.deck).toBe(old?.deck); // Exact stored string.
        expect(after.elements.filter((row) => row.slide_id === old?.id)).toEqual(
          s.before.elements.filter((row) => row.slide_id === old?.id),
        );
        expect(after.cues.filter((row) => row.slide_id === old?.id)).toEqual(
          s.before.cues.filter((row) => row.slide_id === old?.id),
        );
        await unchangedClicks(s.win, s.id, index);
      }
      const publicAfter = await publicSlides(s.win, s.id);
      expect(publicAfter[1]?.slide.deck).toBeUndefined();
      const oldMiddle = JSON.parse(s.before.slides[1]?.deck ?? 'null') as {
        steps?: Array<{ lastId: string }>;
      } | null;
      const oldLastId = oldMiddle?.steps?.at(-1)?.lastId;
      expect(oldLastId, 'the source middle slide had a baked final frame').toBeTruthy();
      expect(
        publicAfter[1]?.slide.elements.some((e) => e.kind === 'image' && e.mediaId === oldLastId),
        'the converted text-only source must not retain its old full-page baked picture under the native words',
      ).toBe(false);
      if (kind === 'typing')
        expect(
          publicAfter[1]?.slide.elements
            .filter((e) => e.kind === 'text')
            .map((e) => e.text)
            .join('\n'),
        ).toContain(REPLACEMENT);
      expect(hashFile(s.fixture.file)).toBe(s.fixture.sha256);

      // Existing operator Undo restores the entire pre-save derivative/baking,
      // not merely an editor flag. content_rev itself should advance, not rewind.
      const undo = s.win.getByTestId('undo-removal');
      await expect(undo).toContainText(`Edited the slides of “${s.fixture.name}”`);
      await undo.getByRole('button', { name: /Undo/u }).click();
      await expect.poll(() => contentOnly(rawContent(s.userData, s.id))).toEqual(contentOnly(s.before));
      for (const index of [0, 1, 2]) await unchangedClicks(s.win, s.id, index);
      expect(hashFile(s.fixture.file)).toBe(s.fixture.sha256);
    } finally {
      await s.app.close();
    }
  });
}

test('notes on a baked source slide save without converting it or changing another slide', async () => {
  test.setTimeout(240_000);
  const s = await openSource(true);
  try {
    await s.editor.getByTestId('editor-slide-thumb').nth(1).click();
    await editorGroup(s.ed, 'Slides');
    await s.editor.getByTestId('slide-notes').fill('Placeholder revised notes only');
    await expect(warning(s.ed)).toHaveCount(0);
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    const after = rawContent(s.userData, s.id);
    expect(after.slides.map((row) => row.deck)).toEqual(s.before.slides.map((row) => row.deck));
    expect(after.slides[1]?.notes).toBe('Placeholder revised notes only');
    expect(after.slides[0]).toEqual(s.before.slides[0]);
    expect(after.slides[2]).toEqual(s.before.slides[2]);
    expect(after.elements).toEqual(s.before.elements);
    expect(after.cues).toEqual(s.before.cues);
    expect(hashFile(s.fixture.file)).toBe(s.fixture.sha256);
  } finally {
    await s.app.close();
  }
});
