import { mkdtemp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DeckMotion, DeckSlide } from '../../../shared/deck';
import { deckElementTargets } from '../../../shared/deck-motion';
import { deckMediaIds, deckSlideSchema, mapDeckMedia } from '../../../shared/deck-schema';
import type { ImportIssue } from '../../../shared/import';
import type { SlideElement } from '../../../shared/model';
import { tidyNotes } from '../../../shared/pictures';
import { fitElements } from '../../../shared/slide-size';
import { nameFromFile } from '../formats/text';
import { MEDIA_REF, mediaRef, type ParsedPresentation, type ParsedSlide } from '../model';
import type { PptxDeck } from '../pictures';
import { type EditablePptx, type EditablePptxSlide, readEditablePptx } from './editable-pptx';
import { moves } from './plan';
import { type PptxDeckSlide, stepsOf } from './pptx-deck';

interface NativePage {
  editable: EditablePptxSlide;
  deck: DeckSlide;
}

export interface NativePptx {
  editable: EditablePptx;
  pages: Map<number, NativePage>;
  indices: number[];
  exact: boolean;
}

function nativeMotion(source: PptxDeckSlide, page: EditablePptxSlide): DeckMotion {
  const shapeIds = new Set([
    ...page.elements.flatMap(deckElementTargets),
    ...source.media.map((media) => media.shapeId),
  ]);
  const allEffects = source.motion?.effects ?? [];
  const effects = allEffects.filter((effect) => shapeIds.has(effect.shapeId));
  const approximate =
    source.motion?.approximate === true ||
    source.transition?.native?.approximate === true ||
    effects.length !== allEffects.length;
  const stepsMs = Array.from({ length: stepsOf(source.groups) }, () => 0);
  for (const effect of effects)
    stepsMs[effect.step] = Math.max(stepsMs[effect.step] ?? 0, effect.delayMs + effect.durationMs);
  if (approximate) {
    // A click whose effect could not be targeted still occupies its source position.
    let step = 0;
    for (const group of source.groups) {
      if (group.byClick) step++;
      stepsMs[step] = Math.max(stepsMs[step] ?? 0, group.lengthMs);
    }
  }
  return { effects, stepsMs, approximate };
}

/** The existing editable reader runs in the import worker, outside the show process. */
export async function prepareNativePptx(
  source: PptxDeck,
  file: string,
  work: string,
): Promise<NativePptx | null> {
  if (!source.slides.some((slide) => !slide.hidden && (slide.animated || moves(slide)))) return null;
  let editable: EditablePptx;
  try {
    editable = await readEditablePptx(file, await mkdtemp(join(work, 'native-pptx-')));
  } catch {
    return null;
  }
  const indices = source.slides.flatMap((slide, index) => (slide.hidden ? [] : [index]));
  const pages = new Map<number, NativePage>();
  for (const page of editable.slides) {
    const slide = source.slides[page.sourceIndex];
    const deck = slide?.deck;
    if (
      !deck ||
      slide.hidden ||
      page.hidden ||
      deck.groups.length >= 10_000 ||
      (deck.motion?.effects.length ?? 0) > 10_000
    )
      continue;
    const transition = deck.transition;
    const motion = nativeMotion(deck, page);
    // A source that reports visual animation with no readable timing can keep its baked playback.
    if (slide.animated && !deck.motion) motion.approximate = true;
    const native: DeckSlide = {
      steps: [],
      media: [],
      motion,
      ...(transition?.name
        ? {
            transition: {
              name: transition.name,
              durationMs: transition.durationMs,
              ...(transition.native ? { nativeTransition: transition.native.transition } : {}),
            },
          }
        : {}),
      ...(transition?.advanceMs === null || transition?.advanceMs === undefined
        ? {}
        : { deckAdvanceMs: transition.advanceMs }),
    };
    if (deckSlideSchema.safeParse(native).success)
      pages.set(page.sourceIndex, { editable: page, deck: native });
  }
  if (pages.size === 0) return null;
  return {
    editable,
    indices,
    pages,
    exact: indices.every((index) => pages.get(index)?.deck.motion?.approximate === false),
  };
}

function nativeSlide(
  parsed: ParsedPresentation,
  candidate: NativePage,
  input: NativePptx,
  references: Map<number, string>,
): Pick<ParsedSlide, 'background' | 'deck' | 'elements'> {
  const { editable, deck } = candidate;
  const elements = editable.elements.flatMap((el): SlideElement[] => {
    if (el.kind !== 'image' && el.kind !== 'video') return [el];
    if (!el.mediaId.startsWith(MEDIA_REF)) return [];
    const i = Number(el.mediaId.slice(MEDIA_REF.length));
    const asset = input.editable.media[i];
    if (!asset) return [];
    let mediaId = references.get(i);
    if (!mediaId) {
      mediaId = mediaRef(parsed.media.length);
      references.set(i, mediaId);
      parsed.media.push(asset);
    }
    return [{ ...el, mediaId }];
  });
  return {
    background: editable.background,
    elements: fitElements(elements, input.editable, parsed),
    deck,
  };
}

function approximation(index: number): ImportIssue {
  return {
    severity: 'warning',
    code: 'deck-motion-approximated',
    message: `Slide ${index + 1} uses the closest effects Drashti can play. Check its clicks and transition before going live.`,
    fix: null,
  };
}

/** All visible pages can be drawn with their original objects. No Office or movie is needed. */
export function nativePresentation(
  fileName: string,
  source: PptxDeck,
  input: NativePptx,
): ParsedPresentation | null {
  if (input.pages.size !== input.indices.length) return null;
  const parsed: ParsedPresentation = {
    name: nameFromFile(basename(fileName)),
    ref: null,
    width: input.editable.width,
    height: input.editable.height,
    notes: '',
    groups: [],
    arrangements: [],
    selectedArrangement: null,
    media: [],
    issues: [],
  };
  const references = new Map<number, string>();
  const slides = input.indices.map((index, n): ParsedSlide => {
    const candidate = input.pages.get(index);
    if (!candidate) throw new Error('A prepared deck page is missing.');
    if (candidate.deck.motion?.approximate) parsed.issues.push(approximation(n));
    return {
      label: '',
      notes: tidyNotes(source.slides[index]?.notes ?? ''),
      enabled: true,
      cues: [],
      ...nativeSlide(parsed, candidate, input, references),
    };
  });
  parsed.groups.push({ name: '', color: null, slides });
  return parsed;
}

/** Keep video for a slide with an unsupported effect; keep the editable timing beside it for its first edit. */
export function applyNativePages(
  parsed: ParsedPresentation,
  input: NativePptx,
  indices: readonly number[],
): void {
  const references = new Map<number, string>();
  const slides = parsed.groups.flatMap((group) => group.slides);
  const original = slides.map((slide) => slide.deck);
  slides.forEach((slide, n) => {
    const index = indices[n];
    const candidate = index === undefined ? undefined : input.pages.get(index);
    if (!candidate || index === undefined) return;
    const motion = candidate.deck.motion;
    if (
      !motion ||
      (!candidate.deck.transition &&
        motion.stepsMs.length === 1 &&
        !motion.effects.length &&
        !motion.approximate)
    )
      return;
    if (motion.approximate && slide.deck?.steps.length) {
      const transition = candidate.deck.transition;
      slide.deck = {
        ...slide.deck,
        motion,
        ...(transition
          ? {
              transition: {
                ...transition,
                ...slide.deck.transition,
                nativeTransition: transition.nativeTransition,
              },
            }
          : {}),
      };
      return;
    }
    if (motion.approximate) parsed.issues.push(approximation(n));
    Object.assign(slide, nativeSlide(parsed, candidate, input, references));
  });
  // An unsupported incoming transition may begin on the previous slide's baked still.
  for (const [index, slide] of slides.entries()) {
    const next = slides[index + 1]?.deck;
    const still = original[index]?.steps.at(-1)?.lastId;
    if (slide.deck && !slide.deck.steps.length && still && next?.steps.length && next.after === still)
      slide.deck = { ...slide.deck, sourceStillId: still };
  }
}

/** Only retain assets the final slides use, including stills that an adjacent baked transition names. */
export function compactNativeAssets(parsed: ParsedPresentation): void {
  const slides = parsed.groups.flatMap((group) => group.slides);
  const indexOf = (ref: string) => (ref.startsWith(MEDIA_REF) ? Number(ref.slice(MEDIA_REF.length)) : -1);
  const used = new Set<number>();
  for (const slide of slides) {
    for (const el of slide.elements)
      if (el.kind === 'image' || el.kind === 'video') used.add(indexOf(el.mediaId));
    for (const cue of slide.cues) if (cue.media !== null) used.add(cue.media);
    if (!slide.deck) continue;
    for (const id of deckMediaIds(slide.deck)) used.add(indexOf(id));
    if (slide.deck.after) used.add(indexOf(slide.deck.after));
  }
  const indices = new Map<number, number>();
  const media = parsed.media.filter((_, index) => {
    if (!used.has(index)) return false;
    indices.set(index, indices.size);
    return true;
  });
  if (media.length === parsed.media.length) return;
  const map = (ref: string) => {
    const index = indices.get(indexOf(ref));
    return index === undefined ? ref : mediaRef(index);
  };
  for (const slide of slides) {
    slide.elements = slide.elements.map((el) =>
      el.kind === 'image' || el.kind === 'video' ? { ...el, mediaId: map(el.mediaId) } : el,
    );
    for (const cue of slide.cues) if (cue.media !== null) cue.media = indices.get(cue.media) ?? null;
    if (slide.deck) slide.deck = mapDeckMedia(slide.deck, map);
  }
  parsed.media = media;
}
