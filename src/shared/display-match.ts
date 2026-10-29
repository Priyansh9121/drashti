import type { DisplayInfo, DisplayKey } from './screens';

export interface MatchCandidate {
  screenId: string;
  key: DisplayKey;
}

const sameSize = (k: DisplayKey, d: DisplayInfo) =>
  k.pixelWidth === d.pixelWidth && k.pixelHeight === d.pixelHeight;
const samePlace = (k: DisplayKey, d: DisplayInfo) => k.x === d.key.x && k.y === d.key.y;
const sameLabel = (k: DisplayKey, d: DisplayInfo) => k.label !== '' && k.label === d.label;
/** Both know the display's own identity (Session 55), and it is the same display. */
const sameHardware = (k: DisplayKey, d: DisplayInfo) =>
  typeof k.hardwareId === 'string' && k.hardwareId !== '' && k.hardwareId === d.key.hardwareId;
/**
 * Both know the display's own identity, and they are two different displays (Session 55): never matched by
 * anything else, however alike they are (two projectors of one model, on each other's ports).
 */
const otherHardware = (k: DisplayKey, d: DisplayInfo) =>
  typeof k.hardwareId === 'string' &&
  k.hardwareId !== '' &&
  typeof d.key.hardwareId === 'string' &&
  d.key.hardwareId !== '' &&
  k.hardwareId !== d.key.hardwareId;

/**
 * Find the display each saved screen belongs to. Passes go from strongest
 * to weakest evidence, and a display is never given to two screens:
 *   0. the same display by its own identity, its maker, model and serial number (Session 55), wherever it is
 *      plugged in and whatever its id is now;
 *   1. same display id and pixel size;
 *   2. same label and pixel size (id changed, e.g. after a reboot on Windows);
 *   3. same position and pixel size (unlabelled displays);
 *   4. same label (the monitor is back but its resolution changed).
 * Passes 1 to 4 are for a display whose identity is not known on one side (it gives no serial number, it has not
 * been read yet, or the key was saved before Session 55): two whose identities are both known and differ are
 * never matched. A screen with no match maps to null: its display is missing.
 */
export function matchDisplays(
  candidates: readonly MatchCandidate[],
  displays: readonly DisplayInfo[],
): Map<string, number | null> {
  const result = new Map<string, number | null>(candidates.map((c) => [c.screenId, null]));
  const taken = new Set<number>();
  const passes: ((k: DisplayKey, d: DisplayInfo) => boolean)[] = [
    sameHardware,
    (k, d) => k.id === d.id && sameSize(k, d),
    (k, d) => sameLabel(k, d) && sameSize(k, d),
    (k, d) => samePlace(k, d) && sameSize(k, d),
    (k, d) => sameLabel(k, d),
  ];
  for (const pass of passes) {
    for (const c of candidates) {
      if (result.get(c.screenId) !== null) continue;
      const hits = displays.filter(
        (d) => !taken.has(d.id) && (pass === sameHardware || !otherHardware(c.key, d)) && pass(c.key, d),
      );
      // In the weaker passes an ambiguous match is no match: never guess between two displays.
      const strong = pass === passes[0] || pass === passes[1];
      const pick = strong ? hits[0] : hits.length === 1 ? hits[0] : undefined;
      if (pick) {
        result.set(c.screenId, pick.id);
        taken.add(pick.id);
      }
    }
  }
  return result;
}

/**
 * A display's key as it is to be saved for a screen matched to it: the display's own, keeping the identity saved
 * before when the display's is not known now (not read yet, or the reading failed), so a moment without it never
 * loses it (Session 55).
 */
export function keyToSave(saved: DisplayKey, display: DisplayInfo): DisplayKey {
  const hardwareId = display.key.hardwareId ?? saved.hardwareId;
  return hardwareId === undefined ? { ...display.key } : { ...display.key, hardwareId };
}

/** Whether two keys are the same in every field (a key saved before Session 55 has no identity: null). */
export function sameKey(a: DisplayKey, b: DisplayKey): boolean {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.pixelWidth === b.pixelWidth &&
    a.pixelHeight === b.pixelHeight &&
    a.x === b.x &&
    a.y === b.y &&
    a.internal === b.internal &&
    (a.hardwareId ?? null) === (b.hardwareId ?? null)
  );
}

/** Human description, e.g. "DELL U2720Q · 3840 × 2160 · 60 Hz". */
export function describeDisplay(d: DisplayInfo): string {
  const hz = Math.round(d.refreshHz * 100) / 100;
  return `${d.label || `Display ${d.id}`} · ${d.pixelWidth} × ${d.pixelHeight} · ${hz} Hz`;
}
