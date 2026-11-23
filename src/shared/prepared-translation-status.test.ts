import { describe, expect, it } from 'vitest';
import type { RenderSlide } from './model';
import { translationProblems } from './prepared-translation-status';
import { checkTranslation, draftTranslation } from './prepared-translations';
const slide = (): RenderSlide => ({
  id: 's',
  width: 1920,
  height: 1080,
  background: null,
  elements: [
    {
      id: 'e',
      kind: 'text',
      text: 'Box Q.',
      lang: 'en',
      frame: { x: 100, y: 100, width: 1500, height: 100 },
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
      translations: [
        checkTranslation(draftTranslation('Box Q.', 'en', 'gu', 'Placeholder Q7'), 'Box Q.', 'Reader Q'),
      ],
      translationDisplay: {
        choice: 'gu',
        groups: { stage: 'hi' },
        outputs: { second: 'off' },
        area: { x: 100, y: 220, width: 1500, height: 150 },
        fontSize: 48,
      },
    },
  ],
});
describe('operator translation status', () => {
  it('names a missing checked target, stays quiet for explicit Off and checked fitting words', () => {
    expect(translationProblems(slide(), { groupId: 'stage' })).toEqual(['No checked Hindi translation.']);
    expect(translationProblems(slide(), { outputId: 'second' })).toEqual([]);
    expect(translationProblems(slide(), {})).toEqual([]);
  });
  it('reports why a reserved area is held without exposing translated words or reader names', () => {
    const problems = translationProblems(slide(), { blockedBelow: 200 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('translation');
    expect(problems.join(' ')).not.toContain('Reader Q');
    expect(problems.join(' ')).not.toContain('Placeholder Q7');
  });
});
