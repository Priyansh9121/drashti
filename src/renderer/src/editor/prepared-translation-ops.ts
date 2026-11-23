import type { TextElement } from '../../../shared/model';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import {
  checkTranslation,
  draftTranslation,
  editTranslation,
  type TranslationLanguage,
} from '../../../shared/prepared-translations';
import {
  translationSource,
  translationSourceSupported,
  type TranslationChoice,
  type TranslationDisplay,
} from '../../../shared/prepared-translation-view';
import { slideCanvas } from '../../../shared/document-page';
import { mapSlide } from './ops';

export function preparedRows(doc: EditDoc): { slide: EditSlide; element: TextElement }[] {
  return slidesOf(doc)
    .filter((slide) => !slide.deck && !slide.documentPage)
    .flatMap((slide) =>
      slide.elements.flatMap((element) =>
        element.kind === 'text' && !element.hidden ? [{ slide, element }] : [],
      ),
    );
}
export function defaultTranslationDisplay(el: TextElement, height: number): TranslationDisplay {
  const fontSize = (48 * height) / 1080;
  return {
    choice: 'off',
    groups: {},
    outputs: {},
    area: {
      x: el.frame.x,
      y: el.frame.y + el.frame.height + (12 * height) / 1080,
      width: el.frame.width,
      height: fontSize * 2.9,
    },
    fontSize,
  };
}
function change(
  doc: EditDoc,
  slideId: string,
  elementId: string,
  fn: (el: TextElement) => TextElement,
): EditDoc {
  const row = preparedRows(doc).find(
    ({ slide, element }) => slide.id === slideId && element.id === elementId,
  );
  if (!row) throw new Error('Choose an editable text box on a slide.');
  return mapSlide(doc, slideId, (slide) => ({
    ...slide,
    elements: slide.elements.map((el) => (el.id === elementId && el.kind === 'text' ? fn(el) : el)),
  }));
}
export function editPreparedWords(
  doc: EditDoc,
  slideId: string,
  elementId: string,
  from: TranslationLanguage,
  to: TranslationLanguage,
  text: string,
): EditDoc {
  return change(doc, slideId, elementId, (el) => {
    if (from === to || !translationSourceSupported(el, from))
      throw new Error(
        'Choose the source language of this whole text box and a different target. Split mixed-language words into separate boxes first.',
      );
    const old = el.translations?.find((value) => value.targetLanguage === to);
    const value =
      old?.sourceLanguage === from
        ? editTranslation(old, translationSource(el), text)
        : draftTranslation(translationSource(el), from, to, text);
    return {
      ...el,
      translations: [...(el.translations ?? []).filter((item) => item.targetLanguage !== to), value],
      translationDisplay: {
        ...(el.translationDisplay ??
          defaultTranslationDisplay(
            el,
            slideCanvas(preparedRows(doc).find((row) => row.slide.id === slideId)?.slide, doc).height,
          )),
        sourceLanguage: from,
      },
    };
  });
}
export function approvePreparedWords(
  doc: EditDoc,
  slideId: string,
  elementId: string,
  from: TranslationLanguage,
  to: TranslationLanguage,
  reader: string,
): EditDoc {
  return change(doc, slideId, elementId, (el) => {
    if (from === to || !translationSourceSupported(el, from))
      throw new Error('Check one source language at a time.');
    const value = el.translations?.find((item) => item.targetLanguage === to && item.sourceLanguage === from);
    if (!value) throw new Error('Write the translation before checking it.');
    // A named, explicit review may approve retained words against the new source, never automatically.
    const checked = checkTranslation(
      editTranslation(value, translationSource(el), value.text),
      translationSource(el),
      reader,
    );
    return {
      ...el,
      translations: el.translations?.map((item) => (item.targetLanguage === to ? checked : item)),
    };
  });
}
export function routePreparedWords(
  doc: EditDoc,
  choice: TranslationChoice,
  groups: Record<string, TranslationChoice>,
  outputs: Record<string, TranslationChoice>,
  sourceLanguage?: TranslationLanguage,
): EditDoc {
  let next = doc;
  for (const { slide, element } of preparedRows(doc))
    next = change(next, slide.id, element.id, (el) => ({
      ...el,
      translationDisplay: {
        ...(el.translationDisplay ?? defaultTranslationDisplay(el, slideCanvas(slide, doc).height)),
        ...(sourceLanguage && translationSourceSupported(el, sourceLanguage) ? { sourceLanguage } : {}),
        choice,
        groups: { ...groups },
        outputs: { ...outputs },
      },
    }));
  return next;
}
export function placePreparedWords(
  doc: EditDoc,
  slideId: string,
  elementId: string,
  display: TranslationDisplay,
): EditDoc {
  return change(doc, slideId, elementId, (el) => ({ ...el, translationDisplay: display }));
}
