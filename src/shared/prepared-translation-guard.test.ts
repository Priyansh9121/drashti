import { describe, expect, it } from 'vitest';
import { translationsUnchanged } from './prepared-translation-guard';
import { checkTranslation, draftTranslation } from './prepared-translations';
import type { EditDoc } from './slide-edit';
import type { TextElement } from './model';
const translation = checkTranslation(
  draftTranslation('Box Q.', 'en', 'gu', 'Placeholder R.'),
  'Box Q.',
  'Reader Q',
);
const doc = (): EditDoc => ({
  presentationId: 'p',
  name: 'Placeholder',
  width: 1920,
  height: 1080,
  transition: null,
  loop: false,
  groups: [
    {
      id: 'g',
      name: 'One',
      color: null,
      slides: [
        {
          id: 's',
          label: '',
          notes: '',
          background: null,
          darken: null,
          enabled: true,
          transition: null,
          autoAdvanceMs: null,
          macroId: null,
          cues: [],
          elements: [
            {
              id: 'e',
              kind: 'text',
              text: 'Box Q.',
              lang: 'en',
              frame: { x: 0, y: 0, width: 500, height: 100 },
              style: {
                fontFamily: null,
                fontSize: 48,
                fontWeight: 400,
                color: '#ffffff',
                align: 'center',
                verticalAlign: 'top',
                lineHeight: 1.45,
                shadow: false,
              },
              translations: [structuredClone(translation)],
            },
          ],
        },
      ],
    },
  ],
});
const el = (d: EditDoc) => required(required(d.groups[0]).slides[0]).elements[0] as TextElement;
describe('Simple Mode translation bounds', () => {
  it('allows source edits with unchanged attachments, and removal, but no approval, authoring or routes', () => {
    const before = doc();
    const after = doc();
    el(after).text = 'Box changed.';
    expect(translationsUnchanged(before, after)).toBe(true);
    required(required(el(after).translations)[0]).reader = 'Another reader';
    expect(translationsUnchanged(before, after)).toBe(false);
    el(after).translations = [];
    expect(translationsUnchanged(before, after)).toBe(false);
    const removed = doc();
    required(required(removed.groups[0]).slides[0]).elements = [];
    expect(translationsUnchanged(before, removed)).toBe(true);
    const added = doc();
    el(added).id = 'new';
    expect(translationsUnchanged(before, added)).toBe(false);
  });
  it('does not accept a checked attachment moved to a different slide identity', () => {
    const before = doc();
    const after = doc();
    required(required(after.groups[0]).slides[0]).id = 'different';
    expect(translationsUnchanged(before, after)).toBe(false);
  });
});

function required<T>(value: T): NonNullable<T> {
  if (value == null) throw new Error('Missing test fixture value');
  return value;
}
