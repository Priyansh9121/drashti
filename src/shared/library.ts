import type { MediaBackground } from './engine/state';
import type { KirtanInfo } from './kirtans';
import type { Lang, RenderSlide, Transition } from './model';
import type { PassageKey } from './shastra';

/** Where an imported item came from, so imports can be re-run and traced. */
export interface ImportSource {
  kind: 'pp6' | 'pp7' | 'text' | 'docx' | 'media' | 'drashti' | 'pictures';
  /** Original file path. */
  path: string | null;
  /** Original id inside that file (for example a ProPresenter UUID). */
  ref: string | null;
  importedAt: string | null;
}

/**
 * What changed in the library, so each list reloads only for its own kind:
 * presentations (added, edited, removed, imported: an import can bring props
 * too), or the props, message templates or themes.
 */
export type LibraryChange = 'presentations' | 'props' | 'messages' | 'themes' | 'shastra';

/** Removing or restoring presentations: the ids that changed. */
export type RemoveResult = { ok: true; ids: string[] } | { ok: false; message: string };

/** A presentation as the library list shows it: kept small, the list can hold thousands. */
export interface PresentationSummary {
  id: string;
  name: string;
  libraryName: string;
  slideCount: number;
  width: number;
  height: number;
  /** Language tracks, when the presentation is a kirtan. */
  kirtanTracks: Lang[] | null;
  /** A kirtan's details, to filter the library by; null for other presentations. */
  kirtan: ListedKirtan | null;
}

/** The kirtan details the library list carries. */
export interface ListedKirtan {
  category: string | null;
  kavi: string | null;
  raag: string | null;
  occasions: string[];
}

/**
 * A presentation as the main process sends it for the library list: the
 * kirtan details are the JSON kept on the presentation (migration 15),
 * read in the operator window (summariesOf) so the main process never
 * parses or rebuilds them for thousands of rows.
 */
export type PresentationListing = Omit<PresentationSummary, 'kirtan'> & { kirtan: string | null };

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** A kirtan's listed details from their JSON; null when there are none or they don't read. */
export function listedKirtan(json: string | null): ListedKirtan | null {
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { category?: unknown; kavi?: unknown; raag?: unknown; occasions?: unknown };
  return {
    category: text(r.category),
    kavi: text(r.kavi),
    raag: text(r.raag),
    occasions: Array.isArray(r.occasions)
      ? r.occasions.filter((o): o is string => typeof o === 'string')
      : [],
  };
}

/** The library list as the operator window uses it, with each kirtan's details read. */
export function summariesOf(listing: PresentationListing[]): PresentationSummary[] {
  return listing.map((p) => ({ ...p, kirtan: listedKirtan(p.kirtan) }));
}

/**
 * A slide's background image or video (PLAN.md 4.3): when the slide goes
 * live it goes on the background layer, and stays there on later slides
 * without a background of their own.
 */
export interface BackgroundCue {
  kind: 'background';
  label: string;
  /** The media file's name, for the operator. */
  name: string;
  /** The file was not found at import; it shows once it is relinked. */
  missing: boolean;
  /** What the file is, when Drashti cannot play it (ProRes, HEIC...); null when it plays or is not known. */
  unplayable: string | null;
  background: MediaBackground;
}

/** A slide's sound: when the slide goes live it plays on the audio layer. */
export interface AudioCue {
  kind: 'audio';
  label: string;
  /** The media file's name, for the operator. */
  name: string;
  /** The file was not found at import; it plays once it is relinked. */
  missing: boolean;
  /** What the file is, when Drashti cannot play it; null when it plays or is not known. */
  unplayable: string | null;
  mediaId: string;
  /** 0 to 1. */
  volume: number;
  loop: boolean;
}

/** What a slide does on the other layers when it goes live. Cues Drashti does not run yet stay in the library. */
export type SlideCue = BackgroundCue | AudioCue;

export interface SlideInfo {
  id: string;
  /** Position in the presentation's slide order (what the engine calls slideIndex). */
  index: number;
  label: string;
  notes: string;
  slide: RenderSlide;
  cues: SlideCue[];
  /** How it comes onto the screens; null for the presentation's default. */
  transition: Transition | null;
  /** How long it stays up before the next slide comes on by itself; null to wait for the operator. */
  autoAdvanceMs: number | null;
  /** A macro it runs when it goes up (its cue); null for none. */
  macroId: string | null;
}

export interface GroupInfo {
  id: string;
  name: string;
  color: string | null;
  slides: SlideInfo[];
}

/** A named order of a presentation's groups (repeats allowed): verse, chorus, verse, chorus... */
export interface ArrangementInfo {
  id: string;
  name: string;
  groupIds: string[];
}

export interface PresentationDoc {
  id: string;
  name: string;
  width: number;
  height: number;
  groups: GroupInfo[];
  arrangements: ArrangementInfo[];
  /** The order it plays in when nothing says otherwise: an arrangement, or null for all slides in order. */
  selectedArrangementId: string | null;
  /** The transition for slides without their own; null for the app's default. */
  transition: Transition | null;
  /** Auto-advance goes from the last slide back to the first (otherwise it stops there). */
  loop: boolean;
  /** Its kirtan details and languages, or null when it is not a kirtan. */
  kirtan: KirtanInfo | null;
  source: ImportSource | null;
  /**
   * A Shastra passage shown as slides (Session 12): made from the text, so
   * its words and slides are not edited here. Left out for a presentation.
   */
  passage?: { textId: string; reference: string; key: PassageKey } | null;
}

/** A presentation's words as plain text (the lyrics format), for the words editor. */
export type WordsResult =
  | {
      ok: true;
      text: string;
      /** Fonts of text typed in legacy fonts: such a presentation cannot be edited as plain text yet. */
      legacyFonts: string[];
    }
  | { ok: false; message: string };

/** Saving edited words: how the slides changed, and the revision Undo brings back. */
export type SaveWordsResult =
  | { ok: true; revisionId: string; kept: number; changed: number; added: number; removed: number }
  | { ok: false; message: string };

export type NewFromWordsResult = { ok: true; id: string } | { ok: false; message: string };

/** Undo of a change to a presentation's content (words, theme): the earlier copy written back. */
export type RevisionResult = { ok: true; presentationId: string } | { ok: false; message: string };
