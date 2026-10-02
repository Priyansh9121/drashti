import { z } from 'zod';
import type { Lang } from './model';
import { idSchema, langSchema } from './model-schema';

/*
 * A kirtan (PLAN.md 3): a presentation whose words come in language tracks
 * (see tracks.ts), with details to find it by. Making a presentation a
 * kirtan, or not one, only adds or removes these details: its words stay
 * where they are, on its slides.
 */

/** The categories every library starts with; the operator can add more. */
export const DEFAULT_CATEGORIES: readonly string[] = [
  'Arti',
  'Dhun',
  'Prarthana',
  'Stuti',
  'Thal',
  'Kirtan',
  'Ashtak',
  'Shlok',
  'Bal sabha',
  'Kishore sabha',
  'Yuvak sabha',
];

/** Festivals and days a kirtan is sung for, offered as suggestions (any other can be typed). */
export const OCCASION_SUGGESTIONS: readonly string[] = [
  'Diwali',
  'Annakut',
  'Janmashtami',
  'Swaminarayan Jayanti',
  'Pramukh Swami Maharaj Jayanti',
  'Guru Purnima',
  'Vasant Panchami',
  'Ram Navami',
  'Navratri',
  'Weekly sabha',
];

export interface KirtanDetails {
  category: string | null;
  /** The poet. */
  kavi: string | null;
  raag: string | null;
  /** Festivals and days it is sung for (any number). */
  occasions: string[];
  /** A recording of it in the media library (a sound or a video), or null. */
  audioMediaId: string | null;
}

export const NO_DETAILS: KirtanDetails = {
  category: null,
  kavi: null,
  raag: null,
  occasions: [],
  audioMediaId: null,
};

/** A kirtan as the library shows it: its details, and the languages its slides have words in. */
export interface KirtanInfo extends KirtanDetails {
  tracks: Lang[];
}

const detail = z.string().max(120).nullable();

/** Kirtan details as they arrive over IPC; tidy them with cleanDetails. */
export const kirtanDetailsSchema: z.ZodType<KirtanDetails> = z.object({
  category: detail,
  kavi: detail,
  raag: detail,
  occasions: z.array(z.string().max(120)).max(50),
  audioMediaId: idSchema.nullable(),
});

/** Details trimmed, with empty ones left out and each occasion once. */
export function cleanDetails(d: KirtanDetails): KirtanDetails {
  const text = (s: string | null) => {
    const t = s?.trim() ?? '';
    return t === '' ? null : t;
  };
  return {
    category: text(d.category),
    kavi: text(d.kavi),
    raag: text(d.raag),
    occasions: [...new Set(d.occasions.map((o) => o.trim()).filter((o) => o !== ''))],
    audioMediaId: d.audioMediaId,
  };
}

/** Occasions as stored (a JSON list); bad data reads as none. */
export function occasionsFrom(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === 'string') : [];
  } catch {
    return [];
  }
}

// ---- tracks in the words editor ----------------------------------------------------------

/** A slide's words by language, for the words editor's "By language" view. */
export interface TrackSlide {
  slideId: string;
  /** Its number in the presentation (1 for the first slide, hidden ones not counted). */
  number: number;
  groupName: string;
  groupColor: string | null;
  label: string;
  /** Each language's lines; a language left out has none on this slide (it is missing). */
  lines: Partial<Record<Lang, string[]>>;
  /** Words typed in a legacy font are on it: shown as they are, not in any track. */
  legacy: boolean;
}

export type TracksResult =
  | {
      ok: true;
      name: string;
      /** Null when the presentation is not a kirtan. */
      kirtan: KirtanInfo | null;
      /** Languages in the order its slides put them (then any it has none in). */
      order: Lang[];
      slides: TrackSlide[];
    }
  | { ok: false; message: string };

/** New lines for one slide in one language (none: the slide has none in it). */
export interface TrackEdit {
  slideId: string;
  lang: Lang;
  lines: string[];
}

export const trackEditsSchema = z
  .array(
    z.object({
      slideId: idSchema,
      lang: langSchema,
      lines: z.array(z.string().max(2000)).max(50),
    }),
  )
  .min(1)
  .max(10_000);

/** A change to a kirtan: the revision Undo brings back (null when nothing changed), and how many slides changed. */
export type KirtanResult =
  { ok: true; revisionId: string | null; changed: number } | { ok: false; message: string };
