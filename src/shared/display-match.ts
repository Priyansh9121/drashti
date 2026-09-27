import type { DisplayInfo, DisplayKey } from './screens';

export interface MatchCandidate {
  screenId: string;
  key: DisplayKey;
}

const sameSize = (k: DisplayKey, d: DisplayInfo) =>
  k.pixelWidth === d.pixelWidth && k.pixelHeight === d.pixelHeight;
const samePlace = (k: DisplayKey, d: DisplayInfo) => k.x === d.key.x && k.y === d.key.y;
const sameLabel = (k: DisplayKey, d: DisplayInfo) => k.label !== '' && k.label === d.label;

/**
 * Find the display each saved screen belongs to. Passes go from strongest
 * to weakest evidence, and a display is never given to two screens:
 *   1. same display id and pixel size;
 *   2. same label and pixel size (id changed, e.g. after a reboot on Windows);
 *   3. same position and pixel size (unlabelled displays);
 *   4. same label (the monitor is back but its resolution changed).
 * A screen with no match maps to null: its display is missing.
 */
export function matchDisplays(
  candidates: readonly MatchCandidate[],
  displays: readonly DisplayInfo[],
): Map<string, number | null> {
  const result = new Map<string, number | null>(candidates.map((c) => [c.screenId, null]));
  const taken = new Set<number>();
  const passes: ((k: DisplayKey, d: DisplayInfo) => boolean)[] = [
    (k, d) => k.id === d.id && sameSize(k, d),
    (k, d) => sameLabel(k, d) && sameSize(k, d),
    (k, d) => samePlace(k, d) && sameSize(k, d),
    (k, d) => sameLabel(k, d),
  ];
  for (const pass of passes) {
    for (const c of candidates) {
      if (result.get(c.screenId) !== null) continue;
      const hits = displays.filter((d) => !taken.has(d.id) && pass(c.key, d));
      // In the weaker passes an ambiguous match is no match: never guess between two displays.
      const pick = pass === passes[0] ? hits[0] : hits.length === 1 ? hits[0] : undefined;
      if (pick) {
        result.set(c.screenId, pick.id);
        taken.add(pick.id);
      }
    }
  }
  return result;
}

/** Human description, e.g. "DELL U2720Q · 3840 × 2160 · 60 Hz". */
export function describeDisplay(d: DisplayInfo): string {
  const hz = Math.round(d.refreshHz * 100) / 100;
  return `${d.label || `Display ${d.id}`} · ${d.pixelWidth} × ${d.pixelHeight} · ${hz} Hz`;
}
