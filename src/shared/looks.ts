import { z } from 'zod';
import type { Lang } from './model';
import { idSchema } from './model-schema';
import type { Mask } from './masks';
import type { StageLayout } from './stage-layouts';
import { groupLanguagesSchema } from './screens-schema';

/*
 * Looks (PLAN.md 2 and 4.1, Session 11): for each screen group, what its
 * screens show. One Look is live at a time, and switching it is a show
 * action: every group changes at once, from the engine state, which carries
 * the live Look's settings for every group (so outputs, the remote, the stage
 * display and output nodes need no database).
 *
 * Drashti starts on the first Look after a clean quit (so a volunteer in
 * Simple Mode, which cannot switch Looks, never starts on last week's
 * festival Look); after an unexpected stop, recovery brings back the Look
 * that was live. A Look lists only what a group changes from the defaults:
 * every layer, every language, slides as designed, no mask and the Standard
 * stage layout. A group a Look does not mention has the defaults.
 *
 * The stream group takes only its languages from a Look: its layout stays
 * the Stream panel's, and the Program keeps its own rules (shared/program.ts).
 */

/** The picture layers a Look can leave out of a group (audio has no picture). */
export type LookLayer = 'background' | 'slide' | 'props' | 'messages' | 'ticker' | 'masks';

/** Bottom to top, as the screens draw them. */
export const LOOK_LAYERS = [
  'background',
  'slide',
  'props',
  'messages',
  'ticker',
  'masks',
] as const satisfies readonly LookLayer[];

export const LOOK_LAYER_NAMES: Record<LookLayer, string> = {
  background: 'Background',
  slide: 'Slides',
  props: 'Props',
  messages: 'Messages',
  ticker: 'Ticker',
  masks: 'Masks layer',
};

/** How a group's screens draw slides: as designed, or the words as a lower third (the stream's). */
export type SlideStyle = 'designed' | 'lowerThird';
export const SLIDE_STYLES = ['designed', 'lowerThird'] as const satisfies readonly SlideStyle[];

/** One group's settings in a Look, as kept in the library and edited in Screens. */
export interface GroupLook {
  /** The layers its screens show (audience and key/fill groups; stage screens have their own view). */
  layers: LookLayer[];
  /** A kirtan's languages on its screens, in this order; null for every language in each slide's order. */
  languages: Lang[] | null;
  slides: SlideStyle;
  /** A stage group's layout (shared/stage-layouts.ts); null for the Standard stage screen. */
  stageLayoutId: string | null;
  /** The group's screens' own shape: a mask from the library always over them in this Look (shared/masks.ts). */
  maskId: string | null;
}

export const DEFAULT_GROUP_LOOK: GroupLook = {
  layers: [...LOOK_LAYERS],
  languages: null,
  slides: 'designed',
  stageLayoutId: null,
  maskId: null,
};

/** A Look as the operator window sees it: every group's settings, the defaults filled in. */
export interface LookInfo {
  id: string;
  name: string;
  groups: Record<string, GroupLook>;
}

export interface LooksView {
  /** In order: the first is the one Drashti starts with. */
  looks: LookInfo[];
  /** The live Look. */
  liveId: string;
}

export type LookResult = { ok: true; view: LooksView } | { ok: false; message: string };

/** The live Look in the engine state: every group's settings, ready to draw. */
export interface LiveGroupLook {
  layers: readonly LookLayer[];
  languages: readonly Lang[] | null;
  slides: SlideStyle;
  /** A stage group's layout, ready to draw; null for the Standard stage screen (or a layout since removed). */
  stageLayout: StageLayout | null;
  /** The group's own mask, ready to draw (over everything on its screens); null for none. */
  mask: Mask | null;
}

/** How a group draws when the live Look does not list it (and in previews with no group). */
export const DEFAULT_LIVE_GROUP_LOOK: LiveGroupLook = {
  layers: LOOK_LAYERS,
  languages: null,
  slides: 'designed',
  stageLayout: null,
  mask: null,
};

export interface LiveLook {
  /** Its id in the library ('' before the library's Looks are read). */
  id: string;
  name: string;
  /** By screen group id. A group not here (just made) draws with the defaults. */
  groups: Record<string, LiveGroupLook>;
}

/** The engine's state before the library's Looks are read: every group with the defaults. */
export const NO_LOOK: LiveLook = { id: '', name: '', groups: {} };

/** A group's settings in the live Look (the defaults when the Look does not list it). */
export function groupLookIn(
  look: LiveLook | null | undefined,
  groupId: string | null | undefined,
): LiveGroupLook {
  return (groupId ? look?.groups[groupId] : undefined) ?? DEFAULT_LIVE_GROUP_LOOK;
}

/** Whether a group's screens draw this layer in the live Look. */
export const shows = (g: LiveGroupLook, layer: LookLayer): boolean => g.layers.includes(layer);

// ---- validation (IPC input and what the library holds) ------------------------------------------

export const lookNameSchema = z.string().trim().min(1).max(60);
export const lookLayersSchema = z
  .array(z.enum(LOOK_LAYERS))
  .max(LOOK_LAYERS.length)
  .refine((list) => new Set(list).size === list.length, 'a layer is listed twice');

/** A change to one group's settings in a Look (only what is given changes). */
export const groupLookPatchSchema = z
  .object({
    layers: lookLayersSchema,
    languages: groupLanguagesSchema,
    slides: z.enum(SLIDE_STYLES),
    stageLayoutId: idSchema.nullable(),
    maskId: idSchema.nullable(),
  })
  .partial()
  .strict();
export type GroupLookPatch = z.infer<typeof groupLookPatchSchema>;

/**
 * A Look's definition as stored: per group, only what differs from the
 * defaults. Anything unreadable in it is left out (that setting is the
 * default), so a damaged row never stops the show.
 */
export const lookDefinitionSchema = z.object({
  groups: z.record(idSchema, z.unknown()).default({}),
});

/** One group's stored settings, the defaults filled in; parts that do not read are the defaults. */
export function readGroupLook(raw: unknown): GroupLook {
  const out: GroupLook = { ...DEFAULT_GROUP_LOOK, layers: [...DEFAULT_GROUP_LOOK.layers] };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const layers = lookLayersSchema.safeParse(r['layers']);
  if (layers.success) out.layers = LOOK_LAYERS.filter((l) => layers.data.includes(l));
  const languages = groupLanguagesSchema.safeParse(r['languages']);
  if (languages.success) out.languages = languages.data;
  const slides = z.enum(SLIDE_STYLES).safeParse(r['slides']);
  if (slides.success) out.slides = slides.data;
  const layout = idSchema.safeParse(r['stageLayoutId']);
  if (layout.success) out.stageLayoutId = layout.data;
  const mask = idSchema.safeParse(r['maskId']);
  if (mask.success) out.maskId = mask.data;
  return out;
}

/** What to store for a group: only what differs from the defaults (nothing at all for the defaults). */
export function storedGroupLook(g: GroupLook): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const all = LOOK_LAYERS.every((l) => g.layers.includes(l));
  if (!all) out['layers'] = LOOK_LAYERS.filter((l) => g.layers.includes(l));
  if (g.languages !== null) out['languages'] = g.languages;
  if (g.slides !== 'designed') out['slides'] = g.slides;
  if (g.stageLayoutId !== null) out['stageLayoutId'] = g.stageLayoutId;
  if (g.maskId !== null) out['maskId'] = g.maskId;
  return out;
}
