import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

/*
 * Text in one form, NFC (Sessions 31–36, I18N-6), where it enters: an import, an Edit words save and a slide
 * editor save each store क़ the same whether it came as U+0958 or as U+0915 U+093C. Through the bridge, as
 * the window does. Placeholder words only.
 */

const QA = '\u0958';
const KA_NUKTA = '\u0915\u093c';
const LINE = (qa: string) => `नमूना ${qa}`;

/** A presentation's words as Edit words reads them. */
const wordsOf = (win: Page, id: string) =>
  win.evaluate(async (pid) => {
    const r = await (globalThis as PageGlobals).drashti.library.words(pid);
    if (!r.ok) throw new Error(r.message);
    return r.text;
  }, id);

test('क़ is stored one way, whether it came as U+0958 or U+0915 U+093C: an import, Edit words and the slide editor', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-nfc-'));
  const one = join(dir, 'Placeholder one.txt');
  const two = join(dir, 'Placeholder two.txt');
  writeFileSync(one, `[Verse]\n${LINE(QA)}\n`);
  writeFileSync(two, `[Verse]\n${LINE(KA_NUKTA)}\n`);
  const [first = '', second = ''] = await importAndGetIds(win, [one, two]);
  // An import.
  expect(await wordsOf(win, first)).toContain(LINE(KA_NUKTA));
  expect(await wordsOf(win, second)).toContain(LINE(KA_NUKTA));
  // An Edit words save.
  const saved = await win.evaluate(
    ({ id, text }) => (globalThis as PageGlobals).drashti.library.saveWords(id, text),
    { id: second, text: `[Verse]\n${LINE(QA)} ${QA}\n` },
  );
  expect(saved.ok).toBe(true);
  expect(await wordsOf(win, second)).toContain(`${LINE(KA_NUKTA)} ${KA_NUKTA}`);
  expect(await wordsOf(win, second)).not.toContain(QA);
  // A slide editor save.
  await win.evaluate(
    async ({ id, qa }) => {
      const d = (globalThis as PageGlobals).drashti;
      const opened = await d.library.slidesForEdit(id);
      if (!opened.ok) throw new Error(opened.message);
      const slide = opened.doc.groups[0]?.slides[0];
      const box = slide?.elements.find((e) => e.kind === 'text');
      if (!slide || box?.kind !== 'text') throw new Error('no words');
      slide.notes = `Placeholder note ${qa}`;
      box.text = `Placeholder ${qa}`;
      delete box.runs;
      const done = await d.library.saveSlides(id, opened.doc, opened.stamp);
      if (!done.ok) throw new Error(done.message);
    },
    { id: first, qa: QA },
  );
  const stored = await win.evaluate(async (id) => {
    const opened = await (globalThis as PageGlobals).drashti.library.slidesForEdit(id);
    if (!opened.ok) throw new Error(opened.message);
    const slide = opened.doc.groups[0]?.slides[0];
    const box = slide?.elements.find((e) => e.kind === 'text');
    return { notes: slide?.notes ?? '', words: box?.kind === 'text' ? box.text : '' };
  }, first);
  expect(stored).toEqual({ notes: `Placeholder note ${KA_NUKTA}`, words: `Placeholder ${KA_NUKTA}` });
  await app.close();
});
