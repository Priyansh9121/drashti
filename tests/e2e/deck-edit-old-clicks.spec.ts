/*
 * W6's review N4 (Session 57): a PowerPoint deck slide imported before alpha.17 keeps its clicks when Edit slides
 * changes it. The generated animated deck is imported as the other deck-edit tests import it (the baker stand-in),
 * then this test's own stopped library is changed to hold each slide as alpha.16 stored it: its clips, with no
 * clicks of its own. Edit slides reads them from the PowerPoint file Drashti kept with the deck. Generated content
 * only.
 */
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import type { DeckSlide } from '../../src/shared/deck';
import { launchApp, operatorPage, operatorReady, slideEditorClosed } from './helpers';
import {
  canvasSnapshot,
  contentOnly,
  DRAFT_WARNING,
  expectWarningBeforeChange,
  firstContentIntent,
  hashFile,
  openEditor,
  openSource,
  publicSlides,
  rawContent,
  REPLACEMENT,
  SOURCE_WORDS,
  sourceWord,
  unchangedClicks,
  warning,
} from './deck-edit-fixtures';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('a deck slide imported before alpha.17 keeps its clicks through an edit, read from the kept PowerPoint file', async () => {
  test.setTimeout(360_000);
  const s = await openSource(true);
  await s.app.close();
  // Only this test's stopped generated library changes, to hold the deck as alpha.16 stored it.
  const db = new Database(join(s.userData, 'drashti.sqlite'));
  try {
    for (const row of s.before.slides) {
      const deck = JSON.parse(row.deck ?? 'null') as DeckSlide | null;
      if (!deck?.motion) throw new Error('The generated import has no clicks of its own to take away.');
      const { motion: _motion, ...clips } = deck;
      const transition = clips.transition && {
        name: clips.transition.name,
        durationMs: clips.transition.durationMs,
        ...(clips.transition.soundId ? { soundId: clips.transition.soundId } : {}),
      };
      db.prepare('UPDATE slides SET deck = ? WHERE id = ?').run(
        JSON.stringify({ ...clips, ...(transition ? { transition } : {}) }),
        row.id,
      );
    }
    db.prepare('UPDATE presentations SET content_rev = content_rev + 1 WHERE id = ?').run(s.id);
  } finally {
    db.close();
  }
  const before = rawContent(s.userData, s.id);
  for (const row of before.slides) {
    const deck = JSON.parse(row.deck ?? 'null') as DeckSlide | null;
    expect(deck?.steps).toHaveLength(3);
    expect(deck?.motion).toBeUndefined();
  }

  const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' }, s.userData);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const { ed, editor } = await openEditor(app, win, s.fixture.name);
    await editor.getByTestId('editor-slide-thumb').nth(1).click();
    const word = sourceWord(editor, SOURCE_WORDS[1]);
    await expect(word).toBeVisible();
    const beforeCanvas = await canvasSnapshot(editor);
    await firstContentIntent(ed, 'typing');
    // Its clicks, read from the kept file as alpha.17's import reads them, are the closest effects here (a paragraph
    // build): the question names them, as for a slide alpha.17 imported. Before N4 it said the clicks would go.
    await expectWarningBeforeChange(ed, editor, beforeCanvas);
    await warning(ed).getByRole('button', { name: DRAFT_WARNING.accept, exact: true }).click();
    await expect(warning(ed)).toHaveCount(0);
    if ((await editor.getByTestId('text-editing').count()) === 0) await word.dblclick();
    const typing = editor.getByTestId('text-editing');
    await expect(typing).toBeFocused();
    await typing.press(`${mod}+A`);
    await ed.keyboard.insertText(REPLACEMENT);
    await expect(typing).toHaveText(REPLACEMENT);
    expect(contentOnly(rawContent(s.userData, s.id))).toEqual(contentOnly(before));
    await editor.getByTestId('save-slides').click();
    await slideEditorClosed(app);

    const after = rawContent(s.userData, s.id);
    for (const index of [0, 2]) {
      expect(after.slides[index]).toEqual(before.slides[index]);
      await unchangedClicks(win, s.id, index);
    }
    const saved = await publicSlides(win, s.id);
    expect(saved[1]?.slide.deck).toMatchObject({
      steps: [],
      motion: { approximate: true, stepsMs: [0, 100, 100] },
    });
    expect(
      saved[1]?.slide.elements
        .filter((e) => e.kind === 'text')
        .map((e) => e.text)
        .join('\n'),
    ).toContain(REPLACEMENT);
    // Its clicks step through as they did before the edit.
    await unchangedClicks(win, s.id, 1);
    expect(hashFile(s.fixture.file)).toBe(s.fixture.sha256);
  } finally {
    await app.close();
  }
});
