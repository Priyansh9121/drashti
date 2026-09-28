import type { ImportIssue } from '../../shared/import';
import type { SlideElement } from '../../shared/model';

/*
 * The intermediate model every importer produces. Parsers fill it from a
 * file's bytes without touching the database; the writer then stores one
 * presentation per transaction. Element ids here are local to the slide.
 */

export interface ParsedSlide {
  label: string;
  notes: string;
  /** Solid background colour, or null. */
  background: string | null;
  enabled: boolean;
  elements: SlideElement[];
  /** Index into ParsedPresentation.media: the slide's background media cue. */
  media: number | null;
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

export interface ParsedPresentation {
  name: string;
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
