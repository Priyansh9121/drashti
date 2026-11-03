import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { slideCanvas } from '../../../shared/document-page';
import { masterContribution } from '../../../shared/slide-design';

export const SOURCE_CONVERSION_WARNING = {
  title: 'Edit this animated slide',
  accept: 'Make this slide editable',
  cancel: 'Keep original',
} as const;

/** Equality of content values, independent of object property insertion order. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => same(value, b[i]))
    );
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = Object.entries(b).filter(([, value]) => value !== undefined);
  return (
    left.length === right.length &&
    left.every(([key, value]) => Object.hasOwn(b, key) && same(value, (b as Record<string, unknown>)[key]))
  );
}

const content = (slide: EditSlide) => ({
  elements: slide.elements,
  background: slide.background,
  darken: slide.darken,
  cues: slide.cues,
  design: slide.design,
  pageSize: slide.pageSize,
  pageWidth: slide.documentPage?.width,
  pageHeight: slide.documentPage?.height,
  pageRotation: slide.documentPage?.rotation,
});

/** Metadata and editor aids do not turn an original page into a native derivative. */
export function sourceContentChanges(before: EditDoc, next: EditDoc): string[] {
  const previous = new Map(slidesOf(before).map((slide) => [slide.id, slide]));

  return slidesOf(next).flatMap((slide) => {
    const old = previous.get(slide.id);
    return old?.documentPage &&
      (!same(slideCanvas(old, before), slideCanvas(slide, next)) ||
        !same(masterContribution(before, old), masterContribution(next, slide)) ||
        !same(content(old), content(slide)))
      ? [slide.id]
      : [];
  });
}

/** Conversion belongs to the same document/history step as its first real change. */
export function convertSourceContent(next: EditDoc, ids: readonly string[]): EditDoc {
  if (ids.length === 0) return next;
  const changed = new Set(ids);
  return {
    ...next,
    groups: next.groups.map((group) => {
      if (
        !group.slides.some(
          (slide) => changed.has(slide.id) && slide.documentPage && !slide.documentPage.edited,
        )
      )
        return group;
      return {
        ...group,
        slides: group.slides.map((slide) => {
          if (!changed.has(slide.id) || !slide.documentPage || slide.documentPage.edited) return slide;
          const { deck: _deck, ...native } = slide;
          return { ...native, documentPage: { ...slide.documentPage, edited: true } };
        }),
      };
    }),
  };
}

export const needsSourceConversion = (slide: EditSlide): boolean =>
  !!slide.deck && !!slide.documentPage && !slide.documentPage.edited;

const identity = (slide: EditSlide): string => {
  const source = slide.documentPage;
  return source ? `${source.sha256}:${source.ext}:${source.page}` : '';
};

interface PendingConversion {
  readonly before: EditDoc;
  readonly slideIds: string[];
  readonly next?: EditDoc;
  readonly resume?: () => void;
  readonly after: (() => void)[];
}

/** Ephemeral permission only; approving the dialog never changes the document. */
export class SourceConversionGate {
  private readonly accepted = new Map<string, string>();
  pending: PendingConversion | null = null;

  request(doc: EditDoc, ids: readonly string[], resume?: () => void, next?: EditDoc): boolean {
    if (this.pending) return false;
    const byId = new Map(slidesOf(doc).map((slide) => [slide.id, slide]));
    const slideIds = [...new Set(ids)].filter((id) => {
      const slide = byId.get(id);
      return slide && needsSourceConversion(slide) && this.accepted.get(id) !== identity(slide);
    });
    if (slideIds.length === 0) return true;
    this.pending = { before: doc, slideIds, resume, next, after: [] };
    return false;
  }

  accept(doc: EditDoc | null): (() => void) | null {
    const pending = this.pending;
    this.pending = null;
    if (doc !== pending?.before) return null;
    const byId = new Map(slidesOf(doc).map((slide) => [slide.id, slide]));
    for (const id of pending.slideIds) {
      const slide = byId.get(id);
      if (slide && needsSourceConversion(slide)) this.accepted.set(id, identity(slide));
    }
    return () => {
      pending.resume?.();
      for (const after of pending.after) after();
    };
  }

  consume(ids: readonly string[]): void {
    for (const id of ids) this.accepted.delete(id);
  }

  reset(): void {
    this.pending = null;
    this.accepted.clear();
  }
}
