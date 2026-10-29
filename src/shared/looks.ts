import { z } from 'zod';
import { IDLE_WHENS, type IdleWhen } from './idle';
import type { Lang } from './model';
import { idSchema } from './model-schema';
import type { ScreenRole } from './screens';
import { groupLanguagesSchema } from './screens-schema';

/*
 * Session 55 (Part 12): Looks are gone from the window, the menus, the keys, the phone and the API. What the screens
 * draw is each group's languages, set in Screens and kept in the library's first Look, and what its role gives it
 * (roleLook below): a key and fill pair the words as a lower third and messages, every other group everything, slides
 * as designed, Calm. Every Look the library keeps, and every setting in them, stays as it was, unread (main/db/looks.ts
 * reads and writes them as before): what follows says how they were, and how they are still stored.
 *
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
 * every layer, every language, slides as designed and no mask. A group a Look
 * does not mention has the defaults. Since Session 55 a Look no longer chooses
 * a stage group's layout: one layout is chosen for every stage screen
 * (shared/stage-layouts.ts); a Look kept with one still reads, and the live
 * Look's was read once, at the first start after the update, as the one chosen.
 *
 * The stream group takes its languages and its Movement from a Look: its
 * layout stays the Stream panel's, and the Program keeps its own rules
 * (shared/program.ts).
 *
 * Movement (Session 27, docs/design.md section 40): how a group's screens
 * move between slides. Calm, the default, fades in place; Bold may move, wipe
 * and zoom the words, while pictures and backgrounds only ever dissolve. A
 * transition's length is the slide's, whatever the Movement.
 */

/** The picture layers a Look can leave out of a group (audio has no picture; the box since Session 50). */
export type LookLayer = 'background' | 'slide' | 'props' | 'pip' | 'messages' | 'ticker' | 'masks';

/** Bottom to top, as the screens draw them. */
export const LOOK_LAYERS = [
  'background',
  'slide',
  'props',
  'pip',
  'messages',
  'ticker',
  'masks',
] as const satisfies readonly LookLayer[];

/**
 * Layers that came after Looks were first kept (Session 50: the picture-in-picture box). A group's stored
 * `layers` lists only the earlier ones it shows (as an older Drashti reads it), and a later layer it leaves out
 * is kept apart, in `leftOut`: so a group saved before a layer came shows it, and only a Look saved with it
 * left out hides it (Session 51: unless the group's role leaves it out, LATER_OFF_FOR below).
 */
const LATER_LOOK_LAYERS = ['pip'] as const satisfies readonly LookLayer[];
type LaterLookLayer = (typeof LATER_LOOK_LAYERS)[number];
const isLater = (layer: LookLayer): layer is LaterLookLayer =>
  (LATER_LOOK_LAYERS as readonly LookLayer[]).includes(layer);
/** The layers a group's stored `layers` lists (those it shows): the earlier ones. */
const EARLIER_LOOK_LAYERS = LOOK_LAYERS.filter((l) => !isLater(l));

/**
 * Later layers a group of a role leaves out until a Look turns them on (Session 51): a key and fill pair keys its
 * graphics over a video switcher's picture, so it leaves the box out, in Looks kept before and since alike. A
 * group's stored `turnedOn` lists those a Look turns on; its role decides the rest, as it is now.
 */
const LATER_OFF_FOR: Partial<Record<ScreenRole, readonly LaterLookLayer[]>> = { keyfill: ['pip'] };
const offFor = (role: ScreenRole, layer: LaterLookLayer): boolean =>
  LATER_OFF_FOR[role]?.includes(layer) === true;
/** The layers a group of this role shows when its Look says nothing of them. */
const defaultLayers = (role: ScreenRole): LookLayer[] =>
  LOOK_LAYERS.filter((l) => !isLater(l) || !offFor(role, l));

/** How a group's screens draw slides: as designed, or the words as a lower third (the stream's). */
export type SlideStyle = 'designed' | 'lowerThird';
export const SLIDE_STYLES = ['designed', 'lowerThird'] as const satisfies readonly SlideStyle[];

/** How a group's screens move (Session 27): Calm fades in place; Bold may move the words. */
export type Movement = 'calm' | 'bold';
export const MOVEMENTS = ['calm', 'bold'] as const satisfies readonly Movement[];

/** One group's settings in a Look, as kept in the library and edited in Screens. */
export interface GroupLook {
  /** The layers its screens show (audience and key/fill groups; stage screens have their own view). */
  layers: LookLayer[];
  /** A kirtan's languages on its screens, in this order; null for every language in each slide's order. */
  languages: Lang[] | null;
  slides: SlideStyle;
  /**
   * A stage group's layout as a Look chose it before Session 55 (null for the Standard stage screen): read, and kept
   * as it was, but no longer chosen nor drawn. The live Look's first stage group's became the one layout chosen for
   * every stage screen, once, at the first start after the update (main/stage/stage-layout-service.ts).
   */
  stageLayoutId: string | null;
  /** The group's screens' own shape: a mask from the library over them in this Look (kept, unread, since Session 55). */
  maskId: string | null;
  /** When nothing is up on its screens: nothing, or the idle rotation once started, or always (shared/idle.ts). */
  idle: IdleWhen;
  /** How its screens move between slides (Session 27): Calm, the default, or Bold. */
  movement: Movement;
}

export const DEFAULT_GROUP_LOOK: GroupLook = {
  layers: [...LOOK_LAYERS],
  languages: null,
  slides: 'designed',
  stageLayoutId: null,
  maskId: null,
  idle: 'off',
  movement: 'calm',
};

/** A Look as the library keeps it: every group's settings, the defaults filled in. */
export interface LookInfo {
  id: string;
  name: string;
  groups: Record<string, GroupLook>;
}

/** The picture layers a group's screens draw (Session 55: by its role; the props and masks layers are gone). */
export type GroupLayer = 'background' | 'slide' | 'pip' | 'messages' | 'ticker';
/** Bottom to top, as the screens draw them. */
export const GROUP_LAYERS = [
  'background',
  'slide',
  'pip',
  'messages',
  'ticker',
] as const satisfies readonly GroupLayer[];

/** A screen group's settings in the engine state, ready to draw. */
export interface LiveGroupLook {
  layers: readonly GroupLayer[];
  languages: readonly Lang[] | null;
  slides: SlideStyle;
  /** How its screens move between slides: Calm (every group since Session 55), or Bold. */
  movement: Movement;
}

/** How a group draws when the engine state does not list it (and in previews with no group). */
export const DEFAULT_LIVE_GROUP_LOOK: LiveGroupLook = {
  layers: GROUP_LAYERS,
  languages: null,
  slides: 'designed',
  movement: 'calm',
};

/**
 * What a group of this role draws, in these languages (Session 55, Part 12): a key and fill pair keys its graphics
 * over a video switcher's picture, so it draws the words as a lower third and the messages alone (no background, no
 * picture-in-picture box, no ticker), as a group made a key and fill pair always started in every Look (Session 23);
 * every other group draws everything, its slides as designed. Every group moves Calm.
 */
export function roleLook(role: ScreenRole, languages: readonly Lang[] | null): LiveGroupLook {
  const shown = languages ? [...languages] : null;
  return role === 'keyfill'
    ? { layers: ['slide', 'messages'], languages: shown, slides: 'lowerThird', movement: 'calm' }
    : { ...DEFAULT_LIVE_GROUP_LOOK, languages: shown };
}

export interface LiveLook {
  /** The library's first Look's id, which keeps the groups' languages ('' before the library is read). */
  id: string;
  name: string;
  /** By screen group id. A group not here (just made) draws with the defaults. */
  groups: Record<string, LiveGroupLook>;
}

/** The engine's state before the library is read: every group with the defaults. */
export const NO_LOOK: LiveLook = { id: '', name: '', groups: {} };

/** A group's settings in the engine state (the defaults when it does not list it). */
export function groupLookIn(
  look: LiveLook | null | undefined,
  groupId: string | null | undefined,
): LiveGroupLook {
  return (groupId ? look?.groups[groupId] : undefined) ?? DEFAULT_LIVE_GROUP_LOOK;
}

/** Whether a group's screens draw this layer. */
export const shows = (g: LiveGroupLook, layer: GroupLayer): boolean => g.layers.includes(layer);

// ---- validation (what the library holds) ------------------------------------------

export const lookLayersSchema = z
  .array(z.enum(LOOK_LAYERS))
  .max(LOOK_LAYERS.length)
  .refine((list) => new Set(list).size === list.length, 'a layer is listed twice');
/** A group's stored later layers it leaves out, or a Look turns on (see LATER_LOOK_LAYERS and LATER_OFF_FOR). */
const laterLayersSchema = z
  .array(z.enum(LATER_LOOK_LAYERS))
  .max(LATER_LOOK_LAYERS.length)
  .refine((list) => new Set(list).size === list.length, 'a layer is listed twice');

/**
 * A Look's definition as stored: per group, only what differs from the
 * defaults. Anything unreadable in it is left out (that setting is the
 * default), so a damaged row never stops the show.
 */
export const lookDefinitionSchema = z.object({
  groups: z.record(idSchema, z.unknown()).default({}),
});

/**
 * One group's stored settings, the defaults filled in (a later layer's by the group's `role`, Session 51); parts
 * that do not read are the defaults.
 */
export function readGroupLook(raw: unknown, role: ScreenRole = 'audience'): GroupLook {
  const out: GroupLook = { ...DEFAULT_GROUP_LOOK, layers: defaultLayers(role) };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  // The earlier layers as listed (every one when there is no list); a later one unless kept as left out, and
  // where its role leaves it out, only when kept as turned on.
  const layers = lookLayersSchema.safeParse(r['layers']);
  const leftOut = laterLayersSchema.safeParse(r['leftOut']);
  const turnedOn = laterLayersSchema.safeParse(r['turnedOn']);
  const off: readonly LookLayer[] = leftOut.success ? leftOut.data : [];
  const on: readonly LookLayer[] = turnedOn.success ? turnedOn.data : [];
  out.layers = LOOK_LAYERS.filter((l) =>
    isLater(l)
      ? !off.includes(l) && (!offFor(role, l) || on.includes(l))
      : !layers.success || layers.data.includes(l),
  );
  const languages = groupLanguagesSchema.safeParse(r['languages']);
  if (languages.success) out.languages = languages.data;
  const slides = z.enum(SLIDE_STYLES).safeParse(r['slides']);
  if (slides.success) out.slides = slides.data;
  const layout = idSchema.safeParse(r['stageLayoutId']);
  if (layout.success) out.stageLayoutId = layout.data;
  const mask = idSchema.safeParse(r['maskId']);
  if (mask.success) out.maskId = mask.data;
  const idle = z.enum(IDLE_WHENS).safeParse(r['idle']);
  if (idle.success) out.idle = idle.data;
  const movement = z.enum(MOVEMENTS).safeParse(r['movement']);
  if (movement.success) out.movement = movement.data;
  return out;
}

/**
 * What to store for a group: only what differs from the defaults (nothing at all for the defaults), a later
 * layer's by the group's `role` (Session 51).
 */
export function storedGroupLook(g: GroupLook, role: ScreenRole = 'audience'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const shown = EARLIER_LOOK_LAYERS.filter((l) => g.layers.includes(l));
  if (shown.length < EARLIER_LOOK_LAYERS.length) out['layers'] = shown;
  const leftOut = LATER_LOOK_LAYERS.filter((l) => !g.layers.includes(l) && !offFor(role, l));
  if (leftOut.length > 0) out['leftOut'] = leftOut;
  const turnedOn = LATER_LOOK_LAYERS.filter((l) => g.layers.includes(l) && offFor(role, l));
  if (turnedOn.length > 0) out['turnedOn'] = turnedOn;
  if (g.languages !== null) out['languages'] = g.languages;
  if (g.slides !== 'designed') out['slides'] = g.slides;
  if (g.stageLayoutId !== null) out['stageLayoutId'] = g.stageLayoutId;
  if (g.maskId !== null) out['maskId'] = g.maskId;
  if (g.idle !== 'off') out['idle'] = g.idle;
  if (g.movement !== 'calm') out['movement'] = g.movement;
  return out;
}
