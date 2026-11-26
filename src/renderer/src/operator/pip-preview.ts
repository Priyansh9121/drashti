import type { BackgroundLayer, EngineState, PipPlace, SlideLayer } from '../../../shared/engine/state';
import { nothingUpBehindBox } from '../../../shared/engine/state';
import type { GroupLayer, LiveGroupLook } from '../../../shared/looks';
import { PIP_CORNER_NAMES, PIP_SIZE_NAMES } from '../../../shared/pip';
import type { Size } from '../../../shared/scaling';
import { namedBackground } from '../render/named-background';
import { nothingUpShows } from '../render/NothingUp';
import { type PipRect, pipRect } from '../render/pip';

/*
 * Picture in Picture's preview (QA24-PIPPREVIEW-1, the owner, 26 Nov 2026: "in picture in picture, add a preview to see
 * how it looks"), worked out as pure functions: the box where the screens put it, with their border and corners
 * (render/PipLayerView.tsx PipBox draws the same), what is behind it (the picture the screens show now, as the first
 * audience group shows it), and what it shows in words. The preview (PipPreview.tsx) draws only stills of it: a
 * picture, a video's still frame, the slide; a video input, another app's window and a stream link are named, never
 * opened, so the preview adds no camera, capture or playing video to the show's computer.
 */

/** What the preview's box holds: the dialog's choice, the box up's own, or nothing yet (the section, no box up). */
export type PreviewSource =
  | { kind: 'slides' }
  | { kind: 'media'; mediaId: string; media: 'image' | 'video'; name: string }
  | { kind: 'input'; name: string }
  | { kind: 'window'; name: string }
  | { kind: 'none' };

/** The box on a screen of this canvas, as the screens draw it (canvas pixels). */
export interface PreviewFrame {
  rect: PipRect;
  /** Its rounded corners' radius: 0 with square corners. */
  radius: number;
  /** Its thin border's width: 0 with none. */
  line: number;
}

/** Where the box sits and how it looks on a screen of this canvas: the screens' own (PipBox). */
export function previewFrame(place: PipPlace, canvas: Size): PreviewFrame {
  const rect = pipRect(place, canvas);
  return {
    rect,
    radius: place.rounded ? Math.round(rect.height * 0.05) : 0,
    line: place.border ? Math.max(2, Math.round(canvas.height * 0.003)) : 0,
  };
}

/** What is behind the box, as the screens show it now (the box's own picture aside). */
export interface PreviewBehind {
  /** The background, where the group shows it. */
  background: BackgroundLayer | null;
  /** The slide on the main picture: none while the slides go in the box. */
  slide: SlideLayer | null;
  /** The slide in the box, when it holds the slides (null with no slide up). */
  boxSlide: SlideLayer | null;
  /** With neither a background nor a slide up: the wallpaper chosen, else black (null: something is up). */
  nothing: 'wallpaper' | 'black' | null;
  /** Black-out or the Wallpaper over the screens now: the box shows once it is off. */
  covered: 'blackout' | 'wallpaper' | null;
  /** The box up now is swapped (the preview draws it as it goes up, not swapped). */
  swapped: boolean;
  /** The state it comes from (the wallpaper's pictures and their looks). */
  state: EngineState | null;
}

/** The preview draws the box as it goes up: not swapped (the words say when the one up is). */
const AS_IT_GOES_UP = { swapped: false } as const;

/** The picture the screens show now, behind a box that holds the slides (`holdsSlides`) or anything else. */
export function previewBehind(
  state: EngineState | null,
  look: Pick<LiveGroupLook, 'layers'>,
  holdsSlides: boolean,
): PreviewBehind {
  const shown = (layer: GroupLayer) => look.layers.includes(layer);
  const background = state && shown('background') ? state.layers.background : null;
  const slideUp = state && shown('slide') ? state.layers.slide : null;
  const slide = holdsSlides ? null : slideUp;
  // Neither a background nor a slide up (render/Scene.tsx's nothing-up): behind a box as it goes up, unswapped, what
  // the screens show with nothing up (QA24-WALLBLACK-2, the owner's A: the chosen wallpaper, else black), by the
  // screens' own rule for the box. A slide up in the box counts as something up there, so the main picture is black
  // behind it, as the screens draw it.
  let nothing: PreviewBehind['nothing'] = null;
  if (background === null && slideUp === null && nothingUpBehindBox(AS_IT_GOES_UP))
    nothing = state ? nothingUpShows(state) : 'black';
  return {
    background,
    slide,
    boxSlide: holdsSlides ? slideUp : null,
    nothing,
    covered: state?.blackout ? 'blackout' : state?.wallpaper ? 'wallpaper' : null,
    swapped: state?.layers.pip?.swapped ?? false,
    state,
  };
}

/** Who says it: the dialog's preview, the section's with no box up (the next box), or with one up (the box now). */
export type PreviewLead = 'preview' | 'next' | 'now';

const LEADS: Record<PreviewLead, string> = { preview: 'Preview', next: 'The next box', now: 'The box now' };

function where(place: PipPlace): string {
  if (place.corner) return `in the ${PIP_CORNER_NAMES[place.corner].toLowerCase()}`;
  const pct = (n: number) => String(Math.round(n * 100));
  return `where it was dragged (${pct(place.x)}% across, ${pct(place.y)}% down)`;
}

function looks(place: PipPlace): string {
  if (place.border && place.rounded) return 'with a thin border and rounded corners';
  if (place.border) return 'with a thin border and square corners';
  if (place.rounded) return 'with no border and rounded corners';
  return 'with no border and square corners';
}

function holding(source: PreviewSource, behind: PreviewBehind): string | null {
  switch (source.kind) {
    case 'slides':
      return behind.boxSlide ? 'holding the slides' : 'holding the slides (no slide is up now)';
    case 'media':
      return `holding “${source.name}”`;
    case 'input':
      return `holding the video input “${source.name}”`;
    case 'window':
      return `holding the window “${source.name}”`;
    case 'none':
      return null;
  }
}

function backgroundWords(background: BackgroundLayer): string {
  switch (background.kind) {
    case 'color':
      return 'a colour';
    case 'media':
      return background.media === 'video' ? 'a video' : 'a picture';
    case 'input':
      return `the video input “${background.name}”`;
    case 'window':
      return `the window “${background.name}”`;
    case 'link':
      return `the stream link “${background.name}”`;
  }
}

function behindWords(behind: PreviewBehind): string {
  const parts = [
    ...(behind.background ? [backgroundWords(behind.background)] : []),
    ...(behind.slide ? ['a slide'] : []),
  ];
  if (parts.length === 0) parts.push(behind.nothing === 'wallpaper' ? 'the wallpaper' : 'black');
  return `over what the screens show now (${parts.join(' and ')})`;
}

/** Whether it names something live instead of showing it (a video input, a window or a stream link). */
export const namesLive = (source: PreviewSource, behind: PreviewBehind): boolean =>
  source.kind === 'input' || source.kind === 'window' || namedBackground(behind.background) !== null;

/** What the preview shows, in words: its text for everyone (the picture itself is for the eyes). */
export function previewWords(
  lead: PreviewLead,
  place: PipPlace,
  source: PreviewSource,
  behind: PreviewBehind,
): string {
  const held = holding(source, behind);
  const first = [where(place), PIP_SIZE_NAMES[place.size].label, looks(place), ...(held ? [held] : [])];
  const sentences = [`${LEADS[lead]}: ${first.join(', ')}, ${behindWords(behind)}.`];
  if (namesLive(source, behind))
    sentences.push('The preview opens no camera, window or stream link: they show here by name.');
  if (behind.covered === 'blackout')
    sentences.push('Black-out is on now: the screens show the box once it is off.');
  if (behind.covered === 'wallpaper')
    sentences.push('The Wallpaper is on now: the screens show the box once it is off.');
  if (lead === 'now' && behind.swapped) sentences.push('It is swapped on the screens now.');
  return sentences.join(' ');
}
