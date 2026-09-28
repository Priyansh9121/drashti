import type { ImportIssue } from '../../shared/import';
import type { SlideElement } from '../../shared/model';

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
}

/** A media file a presentation uses, as the source file names it. */
export interface ParsedMediaRef {
  /** The path (or file URL) stored in the source file. */
  originalPath: string;
  kind: 'image' | 'video' | 'audio';
}

export type ParsedPlaylistItem =
  /** A presentation, found by its path in the source (or its own id). */
  | { kind: 'presentation'; name: string; path: string | null; ref: string | null }
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
  media: ParsedMediaRef[];
  /** Things that did not come across, or came across changed. */
  issues: ImportIssue[];
}

export function slideCount(p: ParsedPresentation): number {
  return p.groups.reduce((n, g) => n + g.slides.length, 0);
}
