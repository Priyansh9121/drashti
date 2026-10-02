import { z } from 'zod';
import type { Lang, Rect, SlideElement, TextRun, TextStyle, Transition } from './model';
import {
  autoAdvanceSchema,
  hexColorSchema,
  idSchema,
  slideElementSchema,
  transitionSchema,
} from './model-schema';

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
  /** Its settings as stored (JSON): fit and loop for a background, volume and loop for a sound. */
  props: string;
}

export interface EditSlide {
  id: string;
  label: string;
  notes: string;
  /** A colour behind everything on the slide, or null. */
  background: string | null;
  /** Hidden slides are kept, but skipped in the show. */
  enabled: boolean;
  /** Its own transition, or null for the presentation's. */
  transition: Transition | null;
  autoAdvanceMs: number | null;
  /** Bottom to top. */
  elements: SlideElement[];
  cues: EditCue[];
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

// ---- checks for a save arriving over IPC ----------------------------------------------

const MAX_SLIDES = 2_000;

const cueSchema: z.ZodType<EditCue> = z.object({
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
});

const slideSchema: z.ZodType<EditSlide> = z.object({
  id: idSchema,
  label: z.string().max(200),
  notes: z.string().max(20_000),
  background: hexColorSchema.nullable(),
  enabled: z.boolean(),
  transition: transitionSchema.nullable(),
  autoAdvanceMs: autoAdvanceSchema.nullable(),
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
