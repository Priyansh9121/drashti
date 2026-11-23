import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bundleLibrary, must } from '../import/testing/kirtan-bundle-fixture';
import { runImport } from '../import/pipeline';
import { checkTranslation, checkedText, draftTranslation } from '../../shared/prepared-translations';
import { editDocOf } from './slides';

describe('prepared translation sharing', () => {
  it('carries drafts, exact checks and reserved output choices through export/import and ID remapping', async () => {
    const source = await bundleLibrary();
    const target = await bundleLibrary();
    target.db.prepare('DELETE FROM presentations').run();
    target.db.prepare('DELETE FROM media').run();
    const rows = must(source.repo.content(source.id));
    const row = must(rows.elements[0]);
    const props = JSON.parse(row.props) as Record<string, unknown>;
    const words = 'The blue box is empty.';
    const checked = checkTranslation(
      draftTranslation(words, 'en', 'gu', 'Placeholder Q7'),
      words,
      'Reader Q',
    );
    props['text'] = words;
    props['lang'] = 'en';
    delete props['runs'];
    props['translations'] = [checked, draftTranslation(words, 'en', 'hi', 'Placeholder unchecked R8')];
    props['translationDisplay'] = {
      choice: 'gu',
      groups: { 'placeholder-stage': 'hi' },
      outputs: { 'placeholder-second': 'off' },
      area: { x: 100, y: 500, width: 1500, height: 150 },
      fontSize: 48,
    };
    source.repo.setContent({ ...rows, elements: [{ ...row, props: JSON.stringify(props) }] });
    await source.exportBundle(false);
    const result = await runImport({
      db: target.db,
      media: target.media,
      runId: randomUUID(),
      paths: [source.output],
      options: {},
      tempDir: target.dir,
      freeBytes: () => 1024 ** 4,
    });
    expect(result.totals.failed).toBe(0);
    const id = target.db.prepare('SELECT id FROM presentations').pluck().get() as string;
    expect(id).not.toBe(source.id);
    const received = must(target.repo.content(id));
    expect(received.elements[0]?.id).not.toBe(row.id);
    const el = editDocOf(received, 'Placeholder').doc.groups[0]?.slides[0]?.elements[0];
    if (el?.kind !== 'text') throw new Error('Missing imported source words');
    expect(el.translations).toEqual(props['translations']);
    expect(el.translationDisplay).toEqual(props['translationDisplay']);
    const gu = must(el.translations?.find((value) => value.targetLanguage === 'gu'));
    const hi = must(el.translations?.find((value) => value.targetLanguage === 'hi'));
    expect(checkedText(gu, el.text)).toBe('Placeholder Q7');
    expect(checkedText(hi, el.text)).toBeNull();
  });
});
