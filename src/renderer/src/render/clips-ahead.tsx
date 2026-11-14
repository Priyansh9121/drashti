import { useEffect, useMemo, useState } from 'react';
import { deckStep } from '../../../shared/deck-show';
import type { UpNext } from '../../../shared/engine/state';
import type { PointedClip } from '../../../shared/point-ahead';
import { DeckClipAhead } from './DeckStep';

/*
 * A deck slide's first clip loaded ahead (Session 57, item 6; C3, Session 58: Q57-26): the slide Next shows (by
 * Next, from its start), and the slide the operator points at in the operator window (a click on its row is a jump,
 * from past the deck's own transition). The outputs' Preloader loads both beside what else comes next; the stream's
 * page loads these two alone (C3, Session 58: it held the slide going away on both while the hall's screens were on
 * time). At most two clips a page; each let go of as Next or the pointer moves on.
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

/**
 * The deck slide's first clip the operator points at in the operator window, as the main process says (on a node, as
 * Main's says); null: none, or this computer is short of memory.
 */
export function usePointedClip(): PointedClip | null {
  const [clip, setClip] = useState<PointedClip | null>(null);
  useEffect(() => window.drashti.output.onPointed(setClip), []);
  return clip;
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

/**
 * The stream's page's deck clips loaded ahead (C3, Session 58): Next's slide's first clip and the pointed slide's, in a
 * box of a pixel out of sight (never in the picture it captures).
 */
export function DeckClipsAhead({ next }: { next: UpNext | null }) {
  const clip = useMemo(() => deckClip(next), [next]);
  const pointed = pointedBeside(usePointedClip(), clip);
  return (
    <div
      data-testid="deck-clips-ahead"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
      }}
    >
      {clip?.first && <DeckClipAhead key={`deck:${clip.mediaId}`} mediaId={clip.mediaId} />}
      {pointed && (
        <DeckClipAhead
          key={`pointed:${pointed.mediaId}@${String(pointed.fromMs)}`}
          mediaId={pointed.mediaId}
          fromMs={pointed.fromMs}
          role="pointed"
        />
      )}
    </div>
  );
}
