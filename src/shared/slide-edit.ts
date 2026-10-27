import { z } from 'zod';
import type { Darken, Lang, Rect, SlideElement, TextRun, TextStyle, Transition } from './model';
import {
  autoAdvanceSchema,
  darkenSchema,
  hexColorSchema,
  idSchema,
  slideElementSchema,
  transitionSchema,
} from './model-schema';
import { VIDEO_INPUT_NAME_MAX } from './video-inputs';
import type { DeckSlide } from './deck';
import { deckSlideSchema } from './deck-schema';

/*
 * The slide editor's document (PLAN.md 5.2, Session 7): a presentation's
 * groups and slides with everything on them, as the editor changes it. The
 * main process makes it from what is stored and puts the edited one back,
 * keeping every row the editor did not change exactly as it was.
 */

/**
 * Something a slide does when it goes live besides its picture. The editor
 * changes background and sound cues; the others (clears, messages...) are
 * carried along as they are.
 */
export interface EditCue {
  id: string;
  kind: 'background' | 'audio' | 'media' | 'clear' | 'message' | 'timer' | 'other';
  label: string;
  /** The media library item it plays, if any. */
  mediaId: string | null;
  /**
   * Its settings as stored (JSON): fit and loop for a background, volume and loop for a sound; for a video input as
   * the background (Session 51), no file and the input's own name: {"input": "Input 1"} (cueInputName).
   */
  props: string;
}

/** A cue's settings, or none when they do not read as an object. */
function settingsOf(props: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(props);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The video input a slide's background cue names (Session 51), by the input's own name: a background cue with no
 * file and the name in its settings. Each computer puts up its own input of that name (shared/video-inputs.ts
 * inputNamed). Null for any other cue, and for a background whose file was removed for good (no name in it).
 */
export function cueInputName(cue: { kind: string; mediaId: string | null; props: string }): string | null {
  if (cue.kind !== 'background' || cue.mediaId !== null) return null;
  const input = settingsOf(cue.props)['input'];
  return typeof input === 'string' && input.trim() !== '' ? input.trim() : null;
}

export interface EditSlide {
  id: string;
  label: string;
  notes: string;
  /** A colour behind everything on the slide, or null. */
  background: string | null;
  /** Darkening behind the words (Sessions 31–36, SLD-3), or null for none. */
  darken: Darken | null;
  /** Hidden slides are kept, but skipped in the show. */
  enabled: boolean;
  /** Its own transition, or null for the presentation's. */
  transition: Transition | null;
  autoAdvanceMs: number | null;
  /** A macro it runs when it goes up (its cue); null for none. */
  macroId: string | null;
  /** Bottom to top. */
  elements: SlideElement[];
  cues: EditCue[];
  /**
   * A slide made from a PowerPoint or Keynote deck with its animations (Session 54, C2): its steps, its own transition
   * and media, as its import stored them, and Drashti's own transitions on it and its clicks, which the editor sets
   * (only those are saved from here). Left out for any other slide.
   */
  deck?: DeckSlide;
}

export interface EditGroup {
  id: string;
  name: string;
  color: string | null;
  slides: EditSlide[];
}

export interface EditDoc {
  presentationId: string;
  name: string;
  /** The slides' size (fixed: slides are laid out on it). */
  width: number;
  height: number;
  /** The transition for slides without their own, or null for Drashti's default. */
  transition: Transition | null;
  loop: boolean;
  groups: EditGroup[];
}

/** How a line in a language looks: a run's style without its words. */
export type RunLook = Omit<TextRun, 'text' | 'lang' | 'legacy'>;

/** How new text looks in this presentation: its theme's text box, styles and background. */
export interface SlideLook {
  frame: Rect;
  style: TextStyle;
  /** Per language, how its lines look (font, size, weight, colour). */
  langs: Partial<Record<Lang, RunLook>>;
  /** The colour behind the text, or null. */
  background: string | null;
  /** Darkening behind the words a theme gives new slides (Sessions 31–36, SLD-3); left out or null for none. */
  darken?: Darken | null;
}

export type EditSlidesResult =
  | {
      ok: true;
      doc: EditDoc;
      /** When the presentation was last changed: a save checks nothing else changed it meanwhile. */
      stamp: string;
      /** How new text looks: the presentation's theme. */
      look: SlideLook;
      /** Elements that could not be read: kept as they are, but not shown here. */
      unreadable: number;
    }
  | { ok: false; message: string };

export type SaveSlidesResult =
  | { ok: true; revisionId: string }
  /** `changedElsewhere`: the presentation changed since the editor opened it; saving again with force overwrites that. */
  | { ok: false; message: string; changedElsewhere?: boolean };

/** A slide as the editor has it, for "Make a theme from this slide". */
export interface ThemeSlide {
  width: number;
  height: number;
  background: string | null;
  elements: SlideElement[];
  cues: EditCue[];
}

// ---- checks for a save arriving over IPC ----------------------------------------------

const MAX_SLIDES = 2_000;

const cueSchema: z.ZodType<EditCue> = z
  .object({
    id: idSchema,
    kind: z.enum(['background', 'audio', 'media', 'clear', 'message', 'timer', 'other']),
    label: z.string().max(500),
    mediaId: idSchema.nullable(),
    props: z
      .string()
      .max(20_000)
      .refine((text) => {
        try {
          const parsed: unknown = JSON.parse(text);
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        } catch {
          return false;
        }
      }, 'cue settings must be a JSON object'),
  })
  .refine((cue) => {
    // A video input named as the background (Session 51): a name an input can have, on a background with no file.
    const input = settingsOf(cue.props)['input'];
    if (input === undefined) return true;
    return (
      cue.kind === 'background' &&
      cue.mediaId === null &&
      typeof input === 'string' &&
      input.trim() !== '' &&
      input.length <= VIDEO_INPUT_NAME_MAX
    );
  }, 'a video input as the background needs its name, and no file');

const slideSchema: z.ZodType<EditSlide> = z.object({
  id: idSchema,
  label: z.string().max(200),
  notes: z.string().max(20_000),
  background: hexColorSchema.nullable(),
  // Documents saved before darkening have none.
  darken: darkenSchema.nullable().default(null),
  enabled: z.boolean(),
  transition: transitionSchema.nullable(),
  autoAdvanceMs: autoAdvanceSchema.nullable(),
  // Documents saved before macro cues have none.
  macroId: idSchema.nullable().default(null),
  elements: z.array(slideElementSchema).max(500),
  cues: z.array(cueSchema).max(100),
  // A deck's slide (Session 54, C2); documents saved before have none.
  deck: deckSlideSchema.optional(),
});

export const themeSlideSchema: z.ZodType<ThemeSlide> = z.object({
  width: z.number().int().min(16).max(16384),
  height: z.number().int().min(16).max(16384),
  background: hexColorSchema.nullable(),
  elements: z.array(slideElementSchema).max(500),
  cues: z.array(cueSchema).max(100),
});

export const editDocSchema: z.ZodType<EditDoc> = z
  .object({
    presentationId: idSchema,
    name: z.string().max(200),
    width: z.number().int().min(16).max(16384),
    height: z.number().int().min(16).max(16384),
    transition: transitionSchema.nullable(),
    loop: z.boolean(),
    groups: z
      .array(
        z.object({
          id: idSchema,
          name: z.string().max(200),
          color: hexColorSchema.nullable(),
          slides: z.array(slideSchema).max(MAX_SLIDES),
        }),
      )
      .max(500),
  })
  .refine((d) => d.groups.reduce((n, g) => n + g.slides.length, 0) <= MAX_SLIDES, 'too many slides')
  .refine((d) => {
    // Every id once: groups, slides, elements and cues.
    const ids = d.groups.flatMap((g) => [
      g.id,
      ...g.slides.flatMap((s) => [s.id, ...s.elements.map((e) => e.id), ...s.cues.map((c) => c.id)]),
    ]);
    return new Set(ids).size === ids.length;
  }, 'an id is used twice');

/** Every slide in the editor's order (groups in order, then their slides). */
export function slidesOf(doc: EditDoc): EditSlide[] {
  return doc.groups.flatMap((g) => g.slides);
}

/** The group a slide is in. */
export function groupOf(doc: EditDoc, slideId: string): EditGroup | undefined {
  return doc.groups.find((g) => g.slides.some((s) => s.id === slideId));
}

/** Text that only reads right in a legacy font: its box can be moved and resized, not edited. */
export function legacyFontOf(el: SlideElement): string | null {
  if (el.kind !== 'text') return null;
  const run = el.runs?.find((r) => r.legacy);
  return run ? (run.font ?? 'a legacy font') : null;
}
