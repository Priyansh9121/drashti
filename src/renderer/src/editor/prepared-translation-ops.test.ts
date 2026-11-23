import { describe, expect, it } from 'vitest';
import type { EditDoc } from '../../../shared/slide-edit';
import type { TextElement } from '../../../shared/model';
import {
  preparedRows,
  editPreparedWords,
  approvePreparedWords,
  routePreparedWords,
} from './prepared-translation-ops';
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
              frame: { x: 100, y: 100, width: 1500, height: 120 },
              style: {
                fontFamily: null,
                fontSize: 60,
                fontWeight: 400,
                color: '#ffffff',
                align: 'center',
                verticalAlign: 'top',
                lineHeight: 1.45,
                shadow: false,
              },
            },
          ],
        },
      ],
    },
  ],
});
const first = (value: EditDoc): TextElement => {
  const el = value.groups[0]?.slides[0]?.elements[0];
  if (el?.kind !== 'text') throw new Error('No fixture text');
  return el;
};
describe('presentation prepared translation editing', () => {
  it('authors drafts without an engine, approves exact words, and clears review when edited', () => {
    const original = doc();
    const draft = editPreparedWords(original, 's', 'e', 'en', 'gu', 'Placeholder Q');
    expect(first(original).translations).toBeUndefined();
    expect(first(draft).translations?.[0]?.state).toBe('unchecked');
    expect(first(draft).translationDisplay?.choice).toBe('off');
    const checked = approvePreparedWords(draft, 's', 'e', 'en', 'gu', 'Reader Q');
    expect(first(checked).translations?.[0]).toMatchObject({ state: 'checked', reader: 'Reader Q' });
    expect(
      first(editPreparedWords(checked, 's', 'e', 'en', 'gu', 'Placeholder R')).translations?.[0],
    ).toMatchObject({ state: 'unchecked', reader: null });
    expect(() => approvePreparedWords(draft, 's', 'e', 'en', 'gu', ' ')).toThrow();
  });
  it('keeps different saved targets and applies output routes without changing original words or frame', () => {
    const original = doc();
    const gu = editPreparedWords(original, 's', 'e', 'en', 'gu', 'Placeholder Q');
    const hi = editPreparedWords(gu, 's', 'e', 'en', 'hi', 'Placeholder R');
    const routed = routePreparedWords(hi, 'gu', { stage: 'hi' }, { second: 'off' });
    expect(first(routed).translations).toHaveLength(2);
    expect(first(routed).translationDisplay).toMatchObject({
      choice: 'gu',
      groups: { stage: 'hi' },
      outputs: { second: 'off' },
    });
    expect(first(routed).frame).toEqual(first(original).frame);
    expect(first(routed).text).toBe(first(original).text);
    expect(preparedRows(routed)).toHaveLength(1);
  });
  it('refuses matching source/target, mixed languages and noneditable imported canvases', () => {
    const original = doc();
    expect(() => editPreparedWords(original, 's', 'e', 'en', 'en', 'Placeholder')).toThrow();
    first(original).runs = [
      { text: 'Box ', lang: 'en' },
      { text: 'Q.', lang: 'hi' },
    ];
    expect(() => editPreparedWords(original, 's', 'e', 'en', 'gu', 'Placeholder')).toThrow();
    expect(() => editPreparedWords(original, 'missing', 'e', 'en', 'gu', 'Placeholder')).toThrow();
  });
});
