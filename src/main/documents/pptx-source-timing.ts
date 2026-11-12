import { EDITABLE_SOURCE_LIMITS } from '../../shared/editable-source';
import type { DeckSlide } from '../../shared/deck';
import { type EditablePptx, readEditablePptx } from '../import/deck/editable-pptx';
import { prepareNativePptx } from '../import/deck/native-deck-import';
import { readPptxDeck } from '../import/pictures';

/*
 * W6's review N4 (Session 57). A PowerPoint deck slide imported before alpha.17 plays the clips of PowerPoint's movie
 * and has no clicks of its own (`deck.motion`), so an edit used to drop them. When Edit slides prepares such a slide
 * from the .pptx Drashti kept, the document reader (pptx-reader-worker.ts, never Main) also reads the slide's clicks
 * and transition, exactly as alpha.17's import reads them: import/deck/native-deck-import.ts's `prepareNativePptx`,
 * called as it is. Main checks what comes back and keeps it beside the slide's clips
 * (shared/deck-source-timing.ts), so the edit keeps the clicks as it does for a slide imported by alpha.17.
 */

export interface EditableWithTiming {
  editable: EditablePptx;
  /** Each asked page's clicks and transition, as alpha.17's import reads them, by the deck's own index. */
  decks: Map<number, DeckSlide>;
  sourceVideoShapeIds: Map<number, string[]>;
}

/**
 * The deck's editable copy (read once, as `readEditablePptx` makes it), with the clicks and transition of the pages in
 * `timingPages` where the file has them. With no page to time, or a deck whose timing doesn't read, the copy alone.
 */
export async function readEditableWithTiming(
  file: string,
  outDir: string,
  timingPages: readonly number[],
): Promise<EditableWithTiming> {
  if (timingPages.length > 0) {
    const timed = await readPptxDeck(file)
      .then(async (source) => {
        const native = await prepareNativePptx(source, file, outDir);
        if (!native) return null;
        const decks = new Map<number, DeckSlide>();
        const sourceVideoShapeIds = new Map<number, string[]>();
        for (const index of timingPages) {
          const page = native.pages.get(index);
          if (!page || page.needsStill) continue;
          decks.set(index, page.deck);
          const videos = source.slides[index]?.deck?.media ?? [];
          const ids = [
            ...new Set(videos.filter((media) => media.kind === 'video').map((media) => media.shapeId)),
          ];
          if (ids.length > 0 && ids.length <= EDITABLE_SOURCE_LIMITS.pageElements)
            sourceVideoShapeIds.set(index, ids);
        }
        return { editable: native.editable, decks, sourceVideoShapeIds };
      })
      .catch(() => null);
    if (timed) return timed;
  }
  return { editable: await readEditablePptx(file, outDir), decks: new Map(), sourceVideoShapeIds: new Map() };
}
