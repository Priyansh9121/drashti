import type { MediaBackground } from './engine/state';
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
  kirtan: {
    category: string | null;
    kavi: string | null;
    tracks: Lang[];
    /** Per slide id, the line in each language track. */
    lines: Record<string, Partial<Record<Lang, string>>>;
  } | null;
  source: ImportSource | null;
}
