import type { ArrangementInfo, GroupInfo, SlideInfo } from './library';

/*
 * The order slides play in (PLAN.md 4.3): a presentation's arrangement lists
 * its groups in order, repeats included, so a chorus sung three times comes
 * up three times. Without an arrangement every group plays once, in order.
 * The engine, the slide grid and the stage screen all use these functions,
 * so a position means the same slide everywhere.
 */

export interface OrderedSlide {
  /** Position in the order: what the engine calls slideIndex. */
  position: number;
  group: { id: string; name: string; color: string | null };
  /** Which time this group comes up in the order (0 the first), to tell a repeated chorus apart. */
  occurrence: number;
  slide: SlideInfo;
}

/** The arrangement with this id, or null for all slides in order (also when it is not one of these). */
export function findArrangement(
  arrangements: readonly ArrangementInfo[],
  arrangementId: string | null,
): ArrangementInfo | null {
  return arrangementId === null ? null : (arrangements.find((a) => a.id === arrangementId) ?? null);
}

/**
 * The slides in playing order. An arrangement plays its groups as it lists
 * them (groups it names that no longer exist are skipped); one that leaves
 * no slides at all plays every slide instead, so a presentation can always
 * go live.
 */
export function orderSlides(
  groups: readonly GroupInfo[],
  arrangement: ArrangementInfo | null,
): OrderedSlide[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const sequence = arrangement
    ? arrangement.groupIds.flatMap((id) => {
        const g = byId.get(id);
        return g ? [g] : [];
      })
    : groups;
  const played = sequence.some((g) => g.slides.length > 0) ? sequence : groups;
  const out: OrderedSlide[] = [];
  const seen = new Map<string, number>();
  for (const g of played) {
    const occurrence = seen.get(g.id) ?? 0;
    seen.set(g.id, occurrence + 1);
    for (const slide of g.slides) {
      out.push({
        position: out.length,
        group: { id: g.id, name: g.name, color: g.color },
        occurrence,
        slide,
      });
    }
  }
  return out;
}

/**
 * Where the slide at `position` in the old order is in a new one: its
 * occurrence nearest to the old position, or, if the new order leaves it
 * out, the old position (kept within the new order's length).
 */
export function remapPosition(
  oldOrder: readonly { slide: { id: string } }[],
  newOrder: readonly { slide: { id: string } }[],
  position: number,
): number {
  const slideId = oldOrder[position]?.slide.id;
  let best = -1;
  if (slideId !== undefined) {
    newOrder.forEach((entry, i) => {
      if (entry.slide.id === slideId && (best < 0 || Math.abs(i - position) < Math.abs(best - position)))
        best = i;
    });
  }
  if (best >= 0) return best;
  return Math.max(0, Math.min(position, newOrder.length - 1));
}

/**
 * The order to play for an arrangement id (null: every slide): the
 * arrangement, unless the presentation has no such arrangement or it leaves
 * no slides, then every slide in order. Says which one it is.
 */
export function playOrder(
  doc: { groups: readonly GroupInfo[]; arrangements: readonly ArrangementInfo[] },
  arrangementId: string | null,
): { arrangementId: string | null; slides: OrderedSlide[] } {
  const arrangement = findArrangement(doc.arrangements, arrangementId);
  const groupsWithSlides = new Set(doc.groups.filter((g) => g.slides.length > 0).map((g) => g.id));
  const used = arrangement?.groupIds.some((id) => groupsWithSlides.has(id)) ? arrangement : null;
  return { arrangementId: used?.id ?? null, slides: orderSlides(doc.groups, used) };
}
