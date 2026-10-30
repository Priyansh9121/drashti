import { z } from 'zod';
import { idSchema } from './model-schema';
import { cutText } from './text';

/*
 * The quick bar (Session 55, Part 8, the owner's idea F): up to 8 pinned items, one press each, just above the bar of
 * clears, with keys (Alt+1 to Alt+8; Option+1 to Option+8 on a Mac). Hidden when empty. A pin is one of:
 * - a slide's row ("<name>_N"), from a playlist (it goes up from its row there, so Next goes on from it) or from the
 *   library's chosen presentation;
 * - a playlist's row of a picture, a video, a sound, a video input or a presentation (it goes up as a click on the row
 *   puts it up);
 * - a picture, a video or a sound from Media (up on its own, as the background or the sound);
 * - a message from Messages (shown on the screens, as its Show does).
 * Kept in the library's settings (`quickBar`, no migration): a pin says what it is by its ids, with the name it had
 * when it was pinned, and is looked up as it is pressed (a slide by its id, wherever it is now in its order).
 */

/** At most this many pins: Alt+1 to Alt+8. */
export const QUICK_BAR_MAX = 8;

/** A pin's name, as the bar shows it (cut, never refused). */
const LABEL_MAX = 120;

const label = z.string().min(1).max(LABEL_MAX);

/** What a playlist's row pinned holds, for its icon. */
export const QUICK_ROW_KINDS = ['picture', 'video', 'sound', 'input', 'presentation'] as const;
export type QuickRowKind = (typeof QUICK_ROW_KINDS)[number];

export type QuickPin =
  | {
      kind: 'slide';
      presentationId: string;
      slideId: string;
      /** The playlist row it was pinned from; null for the library's chosen presentation. */
      playlistId: string | null;
      itemId: string | null;
      label: string;
    }
  | { kind: 'item'; playlistId: string; itemId: string; label: string; what?: QuickRowKind }
  | { kind: 'media'; mediaId: string; media: 'image' | 'video' | 'audio'; label: string }
  | { kind: 'message'; templateId: string; label: string };

export const quickPinSchema: z.ZodType<QuickPin> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('slide'),
    presentationId: idSchema,
    slideId: idSchema,
    playlistId: idSchema.nullable(),
    itemId: idSchema.nullable(),
    label,
  }),
  z.object({
    kind: z.literal('item'),
    playlistId: idSchema,
    itemId: idSchema,
    label,
    what: z.enum(QUICK_ROW_KINDS).optional(),
  }),
  z.object({
    kind: z.literal('media'),
    mediaId: idSchema,
    media: z.enum(['image', 'video', 'audio']),
    label,
  }),
  z.object({ kind: z.literal('message'), templateId: idSchema, label }),
]);

/** A change of the whole bar, as the main process takes it: at most 8, each once. */
export const quickPinsSchema = z
  .array(quickPinSchema)
  .max(QUICK_BAR_MAX)
  .refine((pins) => new Set(pins.map(pinKey)).size === pins.length, 'A pin is on the quick bar twice.');

export type QuickBarResult = { ok: true; pins: QuickPin[] } | { ok: false; message: string };

/** What a pin is, as one string: the same thing pinned twice has the same key. */
export function pinKey(pin: QuickPin): string {
  switch (pin.kind) {
    case 'slide':
      return `slide:${pin.presentationId}:${pin.slideId}:${pin.itemId ?? '-'}`;
    case 'item':
      return `item:${pin.itemId}`;
    case 'media':
      return `media:${pin.mediaId}`;
    case 'message':
      return `message:${pin.templateId}`;
  }
}

/**
 * The pins as kept in the library's settings, read forgivingly: a pin that can't be read is left out (never the whole
 * bar), a name too long is cut, the same thing twice is kept once, and at most 8.
 */
export function readQuickBar(saved: unknown): QuickPin[] {
  if (!Array.isArray(saved)) return [];
  const out: QuickPin[] = [];
  const seen = new Set<string>();
  for (const raw of saved as unknown[]) {
    const label: unknown =
      typeof raw === 'object' && raw !== null ? (raw as { label?: unknown }).label : undefined;
    const cut =
      typeof label === 'string' && typeof raw === 'object'
        ? { ...raw, label: cutText(label, LABEL_MAX) }
        : raw;
    const read = quickPinSchema.safeParse(cut);
    if (!read.success) continue;
    const key = pinKey(read.data);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(read.data);
    if (out.length === QUICK_BAR_MAX) break;
  }
  return out;
}

/** The bar with a pin added at its end (once); a full bar stays as it is and says so. */
export function withPin(pins: readonly QuickPin[], pin: QuickPin): { pins: QuickPin[]; full: boolean } {
  if (pins.some((p) => pinKey(p) === pinKey(pin))) return { pins: [...pins], full: false };
  if (pins.length >= QUICK_BAR_MAX) return { pins: [...pins], full: true };
  return { pins: [...pins, pin], full: false };
}

/** The bar without one pin. */
export function withoutPin(pins: readonly QuickPin[], key: string): QuickPin[] {
  return pins.filter((p) => pinKey(p) !== key);
}

/** The bar with one pin moved a place left (-1) or right (1); at an end it stays. */
export function movedPin(pins: readonly QuickPin[], key: string, by: -1 | 1): QuickPin[] {
  const at = pins.findIndex((p) => pinKey(p) === key);
  const to = at + by;
  if (at < 0 || to < 0 || to >= pins.length) return [...pins];
  const out = [...pins];
  const [moved] = out.splice(at, 1);
  if (moved) out.splice(to, 0, moved);
  return out;
}
