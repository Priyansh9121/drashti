import type { ImportIssue } from '../../shared/import';
import type { SlideElement, Transition } from '../../shared/model';
import type { MediaMarkers } from '../../shared/markers';

/*
 * The intermediate model every importer produces. Parsers fill it from a
 * file's bytes without touching the database; the writer then stores one
 * presentation per transaction. Element ids here are local to the slide.
 */

/**
 * Until the pipeline has found and stored the media, image and video
 * elements point at ParsedPresentation.media by index: mediaId is
 * `media-ref:<index>`.
 */
export const MEDIA_REF = 'media-ref:';
export const mediaRef = (index: number): string => `${MEDIA_REF}${index}`;

/**
 * Something that happens when the slide goes live. A 'background' cue puts an
 * image or video on the background layer (props: media, fit, loop); others
 * play audio, a video, clear a layer, show a message...
 */
export interface ParsedCue {
  kind: 'background' | 'audio' | 'media' | 'clear' | 'message' | 'timer' | 'other';
  label: string;
  /** Index into the presentation's media, when the cue plays a file. */
  media: number | null;
  props: Record<string, unknown>;
}

export interface ParsedSlide {
  label: string;
  notes: string;
  /** Solid background colour, or null. */
  background: string | null;
  enabled: boolean;
  elements: SlideElement[];
  cues: ParsedCue[];
  /** Its own transition, when the file gives one. */
  transition?: Transition | null;
  /** Moves on by itself after this long, when the file says so. */
  autoAdvanceMs?: number | null;
}

export interface ParsedGroup {
  name: string;
  color: string | null;
  slides: ParsedSlide[];
}

export interface ParsedArrangement {
  name: string;
  /** Indexes into ParsedPresentation.groups, in playing order (repeats allowed). */
  groups: number[];
  /** Its id in the source file, so a playlist item that names it can be matched. */
  ref: string | null;
}

/** A media file a presentation uses, as the source file names it. */
export interface ParsedMediaRef {
  /** The path (or file URL) stored in the source file. */
  originalPath: string;
  kind: 'image' | 'video' | 'audio';
  /** Its start and end points and markers, as the file gives them (Session 14; unconfirmed). */
  markers?: MediaMarkers;
  /**
   * Where the library says it came from, when that is not `originalPath`: a page drawn from a
   * document is found at a temporary path, and came from the document's page (Session 15).
   */
  sourcePath?: string;
}

export type ParsedPlaylistItem =
  /**
   * A presentation, found by its path in the source (or its own id), and
   * the arrangement the item plays it in (its id in the source), if it names one.
   */
  | {
      kind: 'presentation';
      name: string;
      path: string | null;
      ref: string | null;
      arrangementRef: string | null;
    }
  | { kind: 'media'; name: string; media: number }
  | { kind: 'header'; name: string; color: string | null }
  | { kind: 'placeholder'; name: string; hint: string | null };

export interface ParsedPlaylist {
  name: string;
  isFolder: boolean;
  ref: string | null;
  items: ParsedPlaylistItem[];
  children: ParsedPlaylist[];
}

export interface ParsedPlaylistDoc {
  name: string;
  playlists: ParsedPlaylist[];
  media: ParsedMediaRef[];
  issues: ImportIssue[];
}

export interface ParsedPresentation {
  name: string;
  /**
   * The library it belongs in, when not the usual one: templates go to
   * "Templates", apart from the presentations and kirtans.
   */
  library?: string;
  /** The presentation's own id inside the source file (a ProPresenter UUID), if it has one. */
  ref: string | null;
  width: number;
  height: number;
  notes: string;
  groups: ParsedGroup[];
  arrangements: ParsedArrangement[];
  /** The arrangement it plays in (an index into `arrangements`), or null for every slide in order. */
  selectedArrangement: number | null;
  /** The transition for slides without their own, when the file gives one. */
  transition?: Transition | null;
  /** Auto-advance goes from the last slide back to the first. */
  loop?: boolean;
  media: ParsedMediaRef[];
  /** The poet, when the file names an author or artist: it makes the presentation a kirtan. */
  kavi?: { name: string; from: 'author' | 'artist' } | null;
  /** Things that did not come across, or came across changed. */
  issues: ImportIssue[];
}

/** A prop as the source file has it: a logo or a fixed line, drawn over whatever slide is live. */
export interface ParsedProp {
  name: string;
  /** Its id in the source file. */
  ref: string | null;
  /** Placed on a canvas of the props' size; media as MEDIA_REF references into `media`. */
  elements: ParsedSlide['elements'];
}

/** The props in a props file (ProPresenter 6 Props.pro6, ProPresenter 7 Configuration/Props). */
export interface ParsedProps {
  width: number;
  height: number;
  props: ParsedProp[];
  media: ParsedMediaRef[];
  issues: ImportIssue[];
}

/** A ProPresenter 6 Props.pro6 is a presentation document: each slide is a prop, named by its label. */
export function propsFromPresentation(p: ParsedPresentation): ParsedProps {
  const slides = p.groups.flatMap((g) => g.slides);
  return {
    width: p.width,
    height: p.height,
    props: slides.map((s, i) => ({
      name: s.label.trim() || `Prop ${i + 1}`,
      ref: null,
      elements: s.elements,
    })),
    media: p.media,
    issues: p.issues.filter((issue) => issue.severity !== 'info'),
  };
}

export function slideCount(p: ParsedPresentation): number {
  return p.groups.reduce((n, g) => n + g.slides.length, 0);
}
