import type { RenderSlide } from './model';
import { checkedText } from './prepared-translations';
import {
  checkedTranslationView,
  translationChoiceFor,
  translationDestinationProblem,
  translationSource,
  translationSourceSupported,
  type TranslationDestination,
} from './prepared-translation-view';
const names = { gu: 'Gujarati', hi: 'Hindi', en: 'English' } as const;

/** Plain local status only: never put source/result text or reader names into a notice or log. */
export function translationProblems(slide: RenderSlide, destination: TranslationDestination): string[] {
  const problems = new Set<string>();
  const shown = checkedTranslationView(slide, destination);
  for (const el of slide.elements) {
    if (el.kind !== 'text' || el.hidden || el.opacity === 0) continue;
    const choice = translationChoiceFor(el.translationDisplay, destination.groupId, destination.outputId);
    if (choice === 'off') continue;
    const value = el.translations?.find((item) => item.targetLanguage === choice);
    const text =
      value && translationSourceSupported(el, value.sourceLanguage)
        ? checkedText(value, translationSource(el))
        : null;
    if (!value || !text) {
      problems.add(`No checked ${names[choice]} translation.`);
      continue;
    }
    const problem = translationDestinationProblem(slide, el, text, destination);
    if (problem) problems.add(problem);
    else if (!shown.elements.some((item) => item.id === `${el.id}:translation:${choice}`))
      problems.add('Translation areas overlap.');
  }
  return [...problems];
}
