import type { Lang, RenderSlide } from './model';

/** Where an imported item came from, so imports can be re-run and traced. */
export interface ImportSource {
  kind: 'pp6' | 'pp7' | 'text' | 'docx' | 'media' | 'drashti';
  /** Original file path. */
  path: string | null;
  /** Original id inside that file (for example a ProPresenter UUID). */
  ref: string | null;
  importedAt: string | null;
}

/** Removing or restoring presentations: the ids that changed. */
export type RemoveResult = { ok: true; ids: string[] } | { ok: false; message: string };

export interface PresentationSummary {
  id: string;
  name: string;
  libraryName: string;
  slideCount: number;
  width: number;
  height: number;
  /** Language tracks, when the presentation is a kirtan. */
  kirtanTracks: Lang[] | null;
  source: ImportSource | null;
}

export interface SlideInfo {
  id: string;
  /** Position in the presentation's slide order (what the engine calls slideIndex). */
  index: number;
  label: string;
  notes: string;
  slide: RenderSlide;
}

export interface GroupInfo {
  id: string;
  name: string;
  color: string | null;
  slides: SlideInfo[];
}

export interface PresentationDoc {
  id: string;
  name: string;
  width: number;
  height: number;
  groups: GroupInfo[];
  kirtan: {
    category: string | null;
    kavi: string | null;
    tracks: Lang[];
    /** Per slide id, the line in each language track. */
    lines: Record<string, Partial<Record<Lang, string>>>;
  } | null;
  source: ImportSource | null;
}
