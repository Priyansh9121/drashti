import { describe, expect, it } from 'vitest';
import {
  draftTranslation,
  checkTranslation,
  translationForSource,
  checkedText,
  StandInTranslator,
  noTranslator,
} from './prepared-translations';

describe('prepared translation review', () => {
  it('holds drafts and changed source, preserving words for review', () => {
    const draft = draftTranslation('Empty blue box.', 'en', 'gu', 'Placeholder Q7');
    expect(checkedText(draft, 'Empty blue box.')).toBeNull();
    const checked = checkTranslation(draft, 'Empty blue box.', 'Reader Q');
    expect(checkedText(checked, 'Empty blue box.')).toBe('Placeholder Q7');
    const stale = translationForSource(checked, 'Empty green box.');
    expect(stale.state).toBe('needs-recheck');
    expect(stale.text).toBe('Placeholder Q7');
    expect(checkedText(stale, 'Empty green box.')).toBeNull();
  });
  it('requires a named reader and matching source', () => {
    const draft = draftTranslation('Box Q.', 'en', 'hi', 'Placeholder R');
    expect(() => checkTranslation(draft, 'Box Q.', ' ')).toThrow();
    expect(() => checkTranslation(draft, 'Box R.', 'Reader Q')).toThrow();
  });
  it('never offers a real engine and keeps test output deterministic', async () => {
    expect(noTranslator.status).toBe('No engine installed');
    const standIn = new StandInTranslator();
    expect(await standIn.translate('Box Q.', 'en', 'gu')).toBe(await standIn.translate('Box Q.', 'en', 'gu'));
  });
  it('binds review to the exact translated words and language pair as well as the source', () => {
    const source = 'Box Q.';
    const checked = checkTranslation(
      draftTranslation(source, 'en', 'gu', 'Placeholder Q'),
      source,
      'Reader Q',
    );
    expect(checkedText({ ...checked, text: 'Changed result.' }, source)).toBeNull();
    expect(checkedText({ ...checked, sourceLanguage: 'hi' }, source)).toBeNull();
    expect(checkedText({ ...checked, targetLanguage: 'hi' }, source)).toBeNull();
    expect(checkedText({ ...checked, text: ' ' }, source)).toBeNull();
  });
});
