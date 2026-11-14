import { useSyncExternalStore } from 'react';
import { deckStep } from '../../../shared/deck-show';
import type { UpNext } from '../../../shared/engine/state';
import type { PointedClip } from '../../../shared/point-ahead';

/*
 * A deck slide's first clip loaded ahead (Session 57, item 6; C3, Session 58: Q57-26): the slide Next shows (by
 * Next, from its start), and the slide the operator points at in the operator window (a click on its row is a jump,
 * from past the deck's own transition). The Preloader loads both beside what else comes next, on the hall's screens
 * and (Session 58, Q57-35: one loader there, not two) the stream's page, which had held the slide going away on both
 * while the hall's screens were on time (C3). At most two clips a page; each let go of as Next or the pointer moves on.
 */

/**
 * The clip of a deck's step Next plays (Session 57, item 6): a slide's first (`first`), loaded and decoded in an
 * element its step takes as the slide comes in (DeckStep.tsx's DeckClipAhead), so it plays from the press; or the
 * slide up's next click's, which its step keeps loaded itself, so it is not loaded twice. Null for anything else (a
 * clip with no motion is never played).
 */
export function deckClip(next: UpNext | null): { mediaId: string; first: boolean } | null {
  if (next?.kind !== 'slide') return null;
  const index = next.step ?? 0;
  const step = deckStep(next.slide.deck, index);
  if (!step || step.clipMs <= 0) return null;
  return { mediaId: step.clipId, first: index === 0 };
}

/** The deck slide's first clip the operator points at, as this page last heard it (null: none). */
let pointedNow: PointedClip | null = null;
const pointedListeners = new Set<() => void>();
let hearing = false;

/** Hear the main process's pointing once a page, from the first who asks: kept for the page's whole life. */
function hearPointing(): void {
  if (hearing) return;
  hearing = true;
  window.drashti.output.onPointed((clip) => {
    pointedNow = clip;
    for (const listener of pointedListeners) listener();
  });
}

function subscribePointed(listener: () => void): () => void {
  hearPointing();
  pointedListeners.add(listener);
  return () => {
    pointedListeners.delete(listener);
  };
}

/**
 * The deck slide's first clip the operator points at in the operator window, as the main process says (on a node, as
 * Main's says); null: none, or this computer is short of memory. Heard by the page, not the box that loads it, so a
 * box drawn again (a Preloader remounted, the stream's page starting to draw) still has what was said before.
 */
export function usePointedClip(): PointedClip | null {
  return useSyncExternalStore(subscribePointed, () => pointedNow);
}

/** The pointed clip unless it is Next's own, from the same frame (loaded once). */
export function pointedBeside(
  pointed: PointedClip | null,
  next: { mediaId: string; first: boolean } | null,
): PointedClip | null {
  return pointed && !(next?.first && next.mediaId === pointed.mediaId && pointed.fromMs === 0)
    ? pointed
    : null;
}
