import { homedir } from 'node:os';
import type { MediaMarkers } from '../../../shared/markers';
import { keepMarkers, markersFrom } from '../markers';
import { basename, dirname, join } from 'node:path';
import type { ImportIssue } from '../../../shared/import';
import type {
  MediaElement,
  Outline,
  Rect,
  Shadow,
  ShapeElement,
  ShapeKind,
  SlideElement,
  TextElement,
  Transition,
  VerticalAlign,
} from '../../../shared/model';
import { CUT, MAX_AUTO_ADVANCE_MS, MAX_TRANSITION_MS } from '../../../shared/model';
import { mainLang, withDetectedLangs } from '../../../shared/text-runs';
import type {
  ParsedArrangement,
  ParsedCue,
  ParsedGroup,
  ParsedMediaRef,
  ParsedPlaylist,
  ParsedPlaylistDoc,
  ParsedPlaylistItem,
  ParsedPresentation,
  ParsedProps,
  ParsedSlide,
} from '../model';
import { mediaRef } from '../model';
import { type Descriptor, decodeMessage, type Message } from '../protobuf';
import { LegacyFontUse } from '../legacy-fonts';
import { readRtf } from '../rtf/rtf';
import { mediaKindOf } from '../scan';
import descriptorJson from './pp7-descriptor.json';
import { TEMPLATES_LIBRARY } from './pp6';
import { nameFromFile } from './text';

/*
 * ProPresenter 7 files: Protocol Buffers, read with the vendored community
 * definitions (third_party/ProPresenter7-Proto, MIT; see its README):
 *   .pro                    rv.data.Presentation
 *   Playlists/<name>        rv.data.PlaylistDocument (library, media and audio bins)
 *   Themes/<name>/Theme     rv.data.Template.Document
 *   .probundle, .proplaylist  ZIP archives of these and their media (the
 *                           playlist inside a .proplaylist is its "data" file)
 * Checked against ProPresenter 18.4 files on the dev Mac. Fields the
 * definitions do not know are kept by the decoder and counted in the report.
 */

const descriptor = descriptorJson as Descriptor;

export type Pp7Kind = 'presentation' | 'playlist' | 'template' | 'props';

export type Pp7Parsed =
  | { kind: 'presentation'; presentation: ParsedPresentation }
  | { kind: 'playlist'; playlist: ParsedPlaylistDoc }
  | { kind: 'props'; props: ParsedProps };

// ---- small readers over decoded messages -------------------------------------------

const msg = (v: unknown): Message | undefined =>
  v && typeof v === 'object' && !(v instanceof Uint8Array) ? (v as Message) : undefined;
const list = (v: unknown): Message[] =>
  Array.isArray(v) ? (v as unknown[]).map(msg).filter((m): m is Message => m !== undefined) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const uuid = (v: unknown): string | null => str(msg(v)?.['string']) || null;
const bytesOf = (v: unknown): Uint8Array | null => (v instanceof Uint8Array ? v : null);

/** An rv.data.Color (floats 0-1) as #rrggbb, or #rrggbbaa when not opaque; null when transparent. */
export function pp7Color(v: unknown): string | null {
  const c = msg(v);
  if (!c) return null;
  const a = num(c['alpha'], 0);
  if (a <= 0) return null;
  const hex = (n: unknown) =>
    Math.round(Math.min(1, Math.max(0, num(n))) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(c['red'])}${hex(c['green'])}${hex(c['blue'])}${a < 1 ? hex(a) : ''}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An rv.data.Color with its alpha multiplied by `opacity`; null when it cannot be seen. */
function colorWithOpacity(v: unknown, opacity: number): string | null {
  const c = msg(v);
  if (!c) return null;
  return pp7Color({ ...c, alpha: num(c['alpha'], 0) * opacity });
}

/**
 * An rv.data.Graphics.Shadow as a shadow in points: it falls `offset` away
 * at `angle` degrees (counted the mathematical way, so 315 is down and to
 * the right), blurred by `radius`. Null when it is off or cannot be seen.
 */
export function pp7Shadow(v: unknown): Shadow | null {
  const sh = msg(v);
  if (sh?.['enable'] !== true) return null;
  // Left out means fully there (proto3 leaves out zeros, and an invisible shadow is never switched on).
  const opacity = sh['opacity'] === undefined ? 1 : num(sh['opacity'], 1);
  const color = colorWithOpacity(sh['color'] ?? { red: 0, green: 0, blue: 0, alpha: 1 }, opacity);
  if (!color) return null;
  const angle = (num(sh['angle']) * Math.PI) / 180;
  const offset = num(sh['offset']);
  return {
    color,
    blur: round2(Math.max(0, num(sh['radius']))),
    x: round2(offset * Math.cos(angle)) || 0,
    y: round2(-offset * Math.sin(angle)) || 0,
  };
}

function rect(v: unknown): Rect | null {
  const r = msg(v);
  if (!r) return null;
  const origin = msg(r['origin']);
  const size = msg(r['size']);
  return {
    x: num(origin?.['x']),
    y: num(origin?.['y']),
    width: Math.max(0, num(size?.['width'])),
    height: Math.max(0, num(size?.['height'])),
  };
}

/** Where a relative URL's root is on this computer (the operator's own folders). */
const ROOTS: Record<number, string> = {
  1: '/',
  2: '',
  3: 'Documents',
  4: 'Downloads',
  5: 'Music',
  6: 'Pictures',
  7: 'Movies',
  11: 'Desktop',
  8: join('Library', 'Application Support'),
};

/** The path an rv.data.URL names: its absolute string, or its root and relative path. */
export function urlPath(v: unknown): string | null {
  const u = msg(v);
  if (!u) return null;
  const absolute = str(u['absolute_string']);
  if (absolute) return absolute;
  const local = msg(u['local']);
  const relative = str(local?.['path']) || str(u['relative_path']);
  if (!relative) return null;
  const root = ROOTS[num(local?.['root'])];
  if (root === undefined) return relative;
  return root === '/' ? join('/', relative) : join(homedir(), root, relative);
}

const VERTICAL: Record<number, VerticalAlign> = { 0: 'top', 1: 'middle', 2: 'bottom' };
const FIT: Record<number, MediaElement['fit']> = { 0: 'fit', 1: 'fill', 2: 'stretch' };

/** Counts each kind of thing that did not come across, for one report line each. */
class Losses {
  private readonly counts = new Map<
    string,
    { n: number; severity: ImportIssue['severity']; one: string; many: string }
  >();

  add(key: string, one: string, many: string, severity: ImportIssue['severity'] = 'warning'): void {
    const c = this.counts.get(key);
    if (c) c.n++;
    else this.counts.set(key, { n: 1, severity, one, many });
  }

  issues(): ImportIssue[] {
    return [...this.counts.entries()].map(([code, c]) => ({
      severity: c.severity,
      code,
      message: c.n === 1 ? c.one : c.many.replace('{n}', String(c.n)),
      fix: null,
    }));
  }
}

interface Context {
  media: ParsedMediaRef[];
  mediaIndex: Map<string, number>;
  losses: Losses;
  /** Legacy (non-Unicode) Gujarati and Hindi fonts in the text. */
  legacy: LegacyFontUse;
  width: number;
  height: number;
  /** Slides (by their place in the file) that go back to the first slide by themselves. */
  loopsBack: number[];
}

const newContext = (size: { width: number; height: number }): Context => ({
  media: [],
  mediaIndex: new Map(),
  losses: new Losses(),
  legacy: new LegacyFontUse(),
  loopsBack: [],
  ...size,
});

function addMedia(ctx: Context, media: Message | undefined, fallback: ParsedMediaRef['kind']): number | null {
  const path = urlPath(media?.['url']);
  if (!path) return null;
  const known = ctx.mediaIndex.get(path);
  if (known !== undefined) return known;
  const kind = media?.['image']
    ? 'image'
    : media?.['video']
      ? 'video'
      : media?.['audio']
        ? 'audio'
        : (mediaKindOf(path) ?? fallback);
  ctx.media.push({ originalPath: path, kind });
  ctx.mediaIndex.set(path, ctx.media.length - 1);
  return ctx.media.length - 1;
}

/** A media cue's markers and its file's in and out points (seconds), unconfirmed (import/markers.ts). */
function pp7Markers(
  action: Message,
  element: Message | undefined,
  kind: 'video' | 'audio',
): MediaMarkers | null {
  const transport = msg(msg(element?.[kind])?.['transport']);
  const markers = (Array.isArray(action['markers']) ? action['markers'] : [])
    .map((m) => msg(m as never))
    .filter((m): m is Message => m !== undefined)
    .map((m) => ({ name: str(m['name']), seconds: num(m['time']) }));
  return markersFrom(
    num(transport?.['in_point']),
    num(transport?.['out_point']),
    num(transport?.['end_point']),
    markers,
  );
}

const scaleOf = (media: Message | undefined): MediaElement['fit'] => {
  const drawing = msg(msg(media?.['image'])?.['drawing']) ?? msg(msg(media?.['video'])?.['drawing']);
  return FIT[num(drawing?.['scale_behavior'])] ?? 'fit';
};

/** What a slide element becomes, turned as the file has it (degrees clockwise). */
function elementsOf(ctx: Context, wrapper: Message, id: string): SlideElement[] {
  const e = msg(wrapper['element']);
  if (!e) return [];
  if (e['hidden'] === true) {
    ctx.losses.add(
      'hidden-element',
      'A hidden slide element was left out.',
      '{n} hidden slide elements were left out.',
      'info',
    );
    return [];
  }
  const rotation = round2(num(e['rotation']) % 360);
  return elementsUnturned(ctx, e, id).map((el) => {
    const turned = round2(((el.rotation ?? 0) + rotation) % 360);
    return turned ? { ...el, rotation: turned } : el;
  });
}

/** The element's outline (its stroke), or null. */
function outlineOf(ctx: Context, e: Message): Outline | null {
  const stroke = msg(e['stroke']);
  if (stroke?.['enable'] !== true) return null;
  const width = num(stroke['width'], 1);
  const color = pp7Color(stroke['color']) ?? null;
  if (!color || width <= 0) return null;
  if (num(stroke['style']) !== 0)
    ctx.losses.add(
      'dashed-outline',
      'A dashed outline shows as a solid line.',
      '{n} dashed outlines show as solid lines.',
      'info',
    );
  return { color, width: round2(width) };
}

/**
 * The element's shape: a rectangle (rounded: roundness is a share of its
 * shorter side), an ellipse, or a path of two points, which is a line (its
 * frame and turn are worked out from the points, kept within the bounds as
 * shares of them). Null for shapes Drashti cannot draw yet.
 */
function shapeOf(
  e: Message,
  frame: Rect,
): { kind: ShapeKind; cornerRadius: number; frame: Rect; rotation: number } | null {
  const path = msg(e['path']);
  const shape = msg(path?.['shape']);
  const type = num(shape?.['type']);
  const points = list(path?.['points']);
  const square = (kind: ShapeKind, cornerRadius = 0) => ({ kind, cornerRadius, frame, rotation: 0 });
  if (type === 2) return square('ellipse');
  if (type === 11) {
    const roundness = num(msg(shape?.['rounded_rectangle'])?.['roundness']);
    return square('rectangle', round2(Math.max(0, roundness) * Math.min(frame.width, frame.height)));
  }
  if (type === 1 || (type === 0 && points.length <= 4)) return square('rectangle');
  if (type === 8 && points.length === 2 && path?.['closed'] !== true) {
    const [a, b] = points.map((p) => {
      const pt = msg(p['point']);
      return { x: frame.x + num(pt?.['x']) * frame.width, y: frame.y + num(pt?.['y']) * frame.height };
    });
    if (!a || !b) return null;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const thickness = 20;
    return {
      kind: 'line',
      cornerRadius: 0,
      frame: {
        x: round2((a.x + b.x) / 2 - length / 2),
        y: round2((a.y + b.y) / 2 - thickness / 2),
        width: round2(length),
        height: thickness,
      },
      rotation: round2((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI),
    };
  }
  return null;
}

/** A slide element (an rv.data.Graphics.Element) as Drashti's elements, not yet turned. */
function elementsUnturned(ctx: Context, e: Message, id: string): SlideElement[] {
  const frame = rect(e['bounds']) ?? { x: 0, y: 0, width: ctx.width, height: ctx.height };
  const opacity = Math.min(1, Math.max(0, num(e['opacity'], 1)));
  const fill = msg(e['fill']);
  const fillOn = fill?.['enable'] === true;
  const out: SlideElement[] = [];
  const text = msg(e['text']);
  const rtfBytes = bytesOf(text?.['rtf_data']);
  const outline = outlineOf(ctx, e);
  // Media placed on the slide (an image or video as the element's fill).
  const fillMedia = msg(fill?.['media']);
  if (fillOn && fillMedia && !rtfBytes) {
    const index = addMedia(ctx, fillMedia, 'image');
    if (index !== null) {
      const media: MediaElement = {
        id,
        kind: fillMedia['video'] ? 'video' : 'image',
        frame,
        mediaId: mediaRef(index),
        fit: scaleOf(fillMedia),
      };
      if (opacity < 1) media.opacity = opacity;
      out.push(media);
      if (outline)
        ctx.losses.add(
          'media-outline',
          'An outline round a picture or video is not shown.',
          '{n} outlines round pictures or videos are not shown.',
          'info',
        );
    }
    return out;
  }
  if (fillOn && fill['gradient'])
    ctx.losses.add(
      'gradient-fill',
      'A gradient fill is not shown.',
      '{n} gradient fills are not shown.',
      'info',
    );
  const fillColor = fillOn ? pp7Color(fill['color']) : null;
  // What is drawn behind the words (or the shape itself): its fill and outline, in its shape.
  if (fillColor || outline) {
    const kind = shapeOf(e, frame);
    if (!kind) {
      ctx.losses.add(
        'custom-shape',
        'A shape Drashti cannot draw yet (a triangle, a star, an arrow or a custom shape) was left out.',
        '{n} shapes Drashti cannot draw yet (triangles, stars, arrows or custom shapes) were left out.',
      );
    } else {
      const shape: ShapeElement = {
        id: rtfBytes ? `${id}-fill` : id,
        kind: 'shape',
        frame: kind.frame,
        fill: kind.kind === 'line' ? null : fillColor,
        cornerRadius: kind.cornerRadius,
        opacity,
      };
      if (kind.kind !== 'rectangle') shape.shape = kind.kind;
      if (kind.rotation) shape.rotation = kind.rotation;
      if (outline) shape.outline = outline;
      out.push(shape);
      if (!rtfBytes && msg(e['shadow'])?.['enable'] === true)
        ctx.losses.add(
          'shape-shadow',
          'A shape’s shadow is not shown.',
          '{n} shapes’ shadows are not shown.',
          'info',
        );
    }
  }
  if (!rtfBytes) return out;
  const rtf = readRtf(rtfBytes);
  const runs = withDetectedLangs(ctx.legacy.apply(rtf.runs));
  for (const feature of rtf.unsupported) {
    ctx.losses.add(
      `rtf-${feature.replace(/\s+/gu, '-')}`,
      `Text formatting "${feature}" is not shown yet.`,
      `Text formatting "${feature}" (in {n} text boxes) is not shown yet.`,
    );
  }
  const el: TextElement = {
    id,
    kind: 'text',
    frame,
    text: rtf.text,
    lang: mainLang(runs),
    style: {
      fontFamily: null,
      fontSize: rtf.runs.find((r) => r.size !== undefined)?.size ?? 72,
      fontWeight: 400,
      color: rtf.runs.find((r) => r.color !== undefined)?.color ?? '#ffffff',
      align: rtf.align ?? 'center',
      verticalAlign: VERTICAL[num(text?.['vertical_alignment'])] ?? 'middle',
      lineHeight: rtf.lineHeight ?? 1.2,
      // The text's own shadow, else the element's (which falls behind the words).
      shadow: pp7Shadow(text?.['shadow']) ?? pp7Shadow(e['shadow']) ?? false,
    },
  };
  if (runs.length > 0) el.runs = runs;
  const scale = num(text?.['scale_behavior']);
  if (scale === 2 || scale === 4) el.style.shrinkToFit = true;
  if (scale === 3 || scale === 4)
    ctx.losses.add(
      'grow-text',
      'Text that grows to fill its box shows at its set size when it is short.',
      '{n} text boxes whose words grow to fill them show at their set size when the words are short.',
      'info',
    );
  if (scale === 1)
    ctx.losses.add(
      'grow-to-fit',
      'A text box that grows to fit its words shows at its set size.',
      '{n} text boxes that grow to fit their words show at their set size.',
      'info',
    );
  out.push(el);
  return out;
}

/**
 * An rv.data.Transition: a dissolve for its duration (other effects, such as
 * pushes and wipes, dissolve too and are counted), or a cut when it is
 * called a cut or takes no time. Null when there is none.
 */
function transitionOf(ctx: Context, v: unknown): Transition | null {
  const t = msg(v);
  if (!t) return null;
  const ms = Math.round(num(t['duration']) * 1000);
  const effect = msg(t['effect']);
  const name = `${str(effect?.['name'])} ${str(effect?.['render_id'])}`.trim().toLowerCase();
  if (ms <= 0 || /\bcut\b/u.test(name)) return CUT;
  if (name !== '' && !/dissolve|fade|cross/u.test(name))
    ctx.losses.add(
      'transition-kind',
      'A slide transition of another kind (a push, a wipe...) plays as a dissolve.',
      '{n} slide transitions of other kinds (pushes, wipes...) play as a dissolve.',
      'info',
    );
  return { kind: 'dissolve', durationMs: Math.min(MAX_TRANSITION_MS, ms) };
}

/**
 * A cue's auto-advance: after `completion_time` seconds it goes on to the
 * next slide (or back to the first, which is a loop on the last slide).
 * Other ways of moving on (after a video ends, to a chosen slide) are counted.
 */
function autoAdvanceOf(ctx: Context, cue: Message, index: number): number | null {
  const target = num(cue['completion_target_type']);
  if (target === 0) return null;
  const seconds = num(cue['completion_time']);
  if ((target === 1 || target === 4) && num(cue['completion_action_type']) === 3 && seconds > 0) {
    if (target === 4) ctx.loopsBack.push(index);
    return Math.min(MAX_AUTO_ADVANCE_MS, Math.max(100, Math.round(seconds * 1000)));
  }
  ctx.losses.add(
    'auto-advance-other',
    'A slide that moves on by itself in another way (after a video ends, or to a chosen slide) waits for the operator.',
    '{n} slides that move on by themselves in other ways (after a video ends, or to a chosen slide) wait for the operator.',
  );
  return null;
}

/** A cue's actions other than its slide: background media, audio, clears, messages... */
function cuesOf(ctx: Context, actions: Message[]): ParsedCue[] {
  const cues: ParsedCue[] = [];
  for (const a of actions) {
    if (msg(msg(a['slide'])?.['presentation'])) continue;
    const label = str(a['name']);
    const media = msg(a['media']);
    if (media) {
      const element = msg(media['element']);
      if (media['audio'] || element?.['audio']) {
        // Volume on the file's audio properties; looping on the cue (1 loops; 2 and 3, a count or a time, loop until cleared).
        const volume = num(msg(msg(element?.['audio'])?.['audio'])?.['volume'], 1);
        const behavior = num(msg(media['audio'])?.['playback_behavior']);
        if (behavior === 2 || behavior === 3) {
          ctx.losses.add(
            'audio-loop-count',
            'An audio cue that loops a set number of times, or for a set time, loops until it is cleared.',
            '{n} audio cues that loop a set number of times, or for a set time, loop until they are cleared.',
            'info',
          );
        }
        const audioIndex = addMedia(ctx, element, 'audio');
        keepMarkers(
          audioIndex === null ? undefined : ctx.media[audioIndex],
          pp7Markers(media, element, 'audio'),
        );
        cues.push({
          kind: 'audio',
          label,
          media: audioIndex,
          props: { volume: Math.min(1, Math.max(0, volume)), loop: behavior >= 1 && behavior <= 3 },
        });
        continue;
      }
      const kind: 'image' | 'video' = media['video'] || element?.['video'] ? 'video' : 'image';
      const index = addMedia(ctx, element, kind);
      if (kind === 'video')
        keepMarkers(index === null ? undefined : ctx.media[index], pp7Markers(media, element, 'video'));
      const loop = num(msg(media['video'])?.['playback_behavior']) === 1;
      // Layer 0 is the background layer (PLAN.md 4.3: a background cue, not slide content).
      if (num(media['layer_type']) === 0) {
        cues.push({
          kind: 'background',
          label,
          media: index,
          props: { media: kind, fit: scaleOf(element), loop },
        });
      } else {
        cues.push({
          kind: 'media',
          label,
          media: index,
          props: { media: kind, layer: 'foreground', fit: scaleOf(element), loop },
        });
      }
      continue;
    }
    if (a['clear'])
      cues.push({
        kind: 'clear',
        label,
        media: null,
        props: { target: num(msg(a['clear'])?.['target_layer']) },
      });
    else if (a['message']) cues.push({ kind: 'message', label, media: null, props: {} });
    else if (a['timer']) cues.push({ kind: 'timer', label, media: null, props: {} });
    else
      cues.push({
        kind: 'other',
        label: label || `action ${num(a['type'])}`,
        media: null,
        props: { type: num(a['type']) },
      });
  }
  for (const cue of cues) {
    if (cue.kind === 'background' || cue.kind === 'audio') continue;
    ctx.losses.add(
      'slide-cues',
      'A slide cue (a clear, a message, a timer...) came across but does not run yet.',
      '{n} slide cues (clears, messages, timers...) came across but do not run yet.',
      'info',
    );
  }
  return cues;
}

function slideOf(ctx: Context, cue: Message, index: number, usesEnabled: boolean): ParsedSlide {
  const actions = list(cue['actions']);
  const slideAction = actions.find((a) => msg(msg(a['slide'])?.['presentation']));
  const presentationSlide = msg(msg(slideAction?.['slide'])?.['presentation']);
  const base = msg(presentationSlide?.['base_slide']);
  const elements = list(base?.['elements']).flatMap((w, i) => elementsOf(ctx, w, `s${index}-e${i}`));
  const notesRtf = bytesOf(msg(presentationSlide?.['notes'])?.['rtf_data']);
  if (cue['hot_key'])
    ctx.losses.add(
      'hot-key',
      'A slide hot key is not imported.',
      '{n} slide hot keys are not imported.',
      'info',
    );
  return {
    label: str(cue['name']),
    notes: notesRtf ? readRtf(notesRtf).text : '',
    background: base?.['draws_background_color'] === true ? pp7Color(base['background_color']) : null,
    // Only files that mark enabled cues can mark disabled ones (proto3 leaves false out).
    enabled: usesEnabled ? cue['isEnabled'] === true : true,
    elements,
    cues: cuesOf(ctx, actions),
    transition: transitionOf(ctx, presentationSlide?.['transition']),
    autoAdvanceMs: autoAdvanceOf(ctx, cue, index),
  };
}

/** Whether the last slide goes back to the first (a loop); one doing so earlier cannot, and is counted. */
function loopOf(ctx: Context, slideCount: number): boolean {
  if (ctx.loopsBack.some((i) => i !== slideCount - 1))
    ctx.losses.add(
      'timer-to-first',
      'A slide that went back to the first slide by itself goes on to the next one.',
      '{n} slides that went back to the first slide by themselves go on to the next one.',
    );
  return ctx.loopsBack.includes(slideCount - 1);
}

function sizeOf(slides: (Message | undefined)[]): { width: number; height: number } {
  for (const s of slides) {
    const size = msg(s?.['size']);
    const width = num(size?.['width']);
    const height = num(size?.['height']);
    if (width >= 16 && height >= 16) return { width: Math.round(width), height: Math.round(height) };
  }
  return { width: 1920, height: 1080 };
}

function unknownIssue(unknown: number): ImportIssue[] {
  return unknown > 0
    ? [
        {
          severity: 'info',
          code: 'unknown-fields',
          message: `${unknown === 1 ? 'One field' : `${String(unknown)} fields`} in this file ${unknown === 1 ? 'is' : 'are'} from a format version the importer does not know; ${unknown === 1 ? 'it was' : 'they were'} not imported.`,
          fix: null,
        },
      ]
    : [];
}

function presentationOf(bytes: Uint8Array, filePath: string): ParsedPresentation {
  const stats = { unknown: 0 };
  const p = decodeMessage(bytes, 'rv.data.Presentation', descriptor, stats);
  const cues = list(p['cues']);
  const byId = new Map<string, Message>();
  for (const c of cues) {
    const id = uuid(c['uuid']);
    if (id) byId.set(id, c);
  }
  const baseSlides = cues.map((c) =>
    msg(
      msg(
        msg(list(c['actions']).find((a) => msg(msg(a['slide'])?.['presentation']))?.['slide'])?.[
          'presentation'
        ],
      )?.['base_slide'],
    ),
  );
  const ctx = newContext(sizeOf(baseSlides));
  const usesEnabled = cues.some((c) => c['isEnabled'] === true);
  let index = 0;
  const used = new Set<string>();
  const groups: ParsedGroup[] = [];
  const groupIds = new Map<string, number>();
  for (const cg of list(p['cue_groups'])) {
    const group = msg(cg['group']);
    const slides: ParsedSlide[] = [];
    for (const idm of list(cg['cue_identifiers'])) {
      const id = str(idm['string']);
      const cue = byId.get(id);
      if (!cue) continue;
      used.add(id);
      slides.push(slideOf(ctx, cue, index++, usesEnabled));
    }
    groups.push({
      name: str(group?.['name']),
      color: pp7Color(group?.['color'])?.slice(0, 7) ?? null,
      slides,
    });
    const gid = uuid(group?.['uuid']);
    if (gid) groupIds.set(gid, groups.length - 1);
  }
  // Cues no group names still come across, in a group with no name.
  const loose = cues.filter((c) => !used.has(uuid(c['uuid']) ?? ''));
  if (loose.length > 0)
    groups.push({ name: '', color: null, slides: loose.map((c) => slideOf(ctx, c, index++, usesEnabled)) });
  const arrangements: ParsedArrangement[] = list(p['arrangements']).map((a) => ({
    name: str(a['name']) || 'Arrangement',
    groups: list(a['group_identifiers'])
      .map((g) => groupIds.get(str(g['string'])))
      .filter((i): i is number => i !== undefined),
    ref: uuid(a['uuid']),
  }));
  // The arrangement the presentation was set to play in.
  const selectedRef = uuid(p['selected_arrangement']);
  const selected = selectedRef ? arrangements.findIndex((x) => x.ref === selectedRef) : -1;
  const ccli = msg(p['ccli']);
  const ccliParts = [
    ['SongTitle', str(ccli?.['song_title'])],
    ['Author', str(ccli?.['author'])],
    ['ArtistCredits', str(ccli?.['artist_credits'])],
    ['Publisher', str(ccli?.['publisher'])],
    ['CopyrightYear', num(ccli?.['copyright_year']) ? String(num(ccli?.['copyright_year'])) : ''],
    ['SongNumber', num(ccli?.['song_number']) ? String(num(ccli?.['song_number'])) : ''],
  ].filter(([, v]) => v !== '');
  let notes = str(p['notes']);
  if (ccliParts.length > 0)
    notes = `${notes}${notes ? '\n\n' : ''}CCLI: ${ccliParts.map(([k, v]) => `${k} ${v}`).join('; ')}`;
  if (msg(p['timeline'])) {
    ctx.losses.add(
      'timeline',
      'The presentation timeline is not imported.',
      'The presentation timeline is not imported.',
      'info',
    );
  }
  const transition = transitionOf(ctx, p['transition']);
  const loop = loopOf(ctx, index);
  const author = str(ccli?.['author']).trim();
  const artist = str(ccli?.['artist_credits']).trim();
  return {
    name: str(p['name']) || nameFromFile(filePath),
    ref: uuid(p['uuid']),
    kavi: author ? { name: author, from: 'author' } : artist ? { name: artist, from: 'artist' } : null,
    width: ctx.width,
    height: ctx.height,
    notes,
    groups,
    arrangements,
    selectedArrangement: selected >= 0 ? selected : null,
    transition,
    loop,
    media: ctx.media,
    issues: [...ctx.losses.issues(), ...ctx.legacy.issues(), ...unknownIssue(stats.unknown)],
  };
}

function templateOf(bytes: Uint8Array, filePath: string): ParsedPresentation {
  const stats = { unknown: 0 };
  const d = decodeMessage(bytes, 'rv.data.Template.Document', descriptor, stats);
  const slides = list(d['slides']);
  const ctx = newContext(sizeOf(slides.map((s) => msg(s['base_slide']))));
  const parsed: ParsedSlide[] = slides.map((s, i) => {
    const base = msg(s['base_slide']);
    return {
      label: str(s['name']),
      notes: '',
      background: base?.['draws_background_color'] === true ? pp7Color(base['background_color']) : null,
      enabled: true,
      elements: list(base?.['elements']).flatMap((w, n) => elementsOf(ctx, w, `s${i}-e${n}`)),
      cues: cuesOf(ctx, list(s['actions'])),
    };
  });
  // A theme lives in its own folder: Themes/<name>/Theme.
  const name = basename(filePath) === 'Theme' ? basename(dirname(filePath)) : nameFromFile(filePath);
  return {
    name,
    library: TEMPLATES_LIBRARY,
    ref: null,
    width: ctx.width,
    height: ctx.height,
    notes: '',
    groups: [{ name: 'Template', color: null, slides: parsed }],
    arrangements: [],
    selectedArrangement: null,
    media: ctx.media,
    issues: [
      {
        severity: 'info',
        code: 'template',
        message:
          'A theme: kept in the Templates library, apart from the presentations (Drashti themes come later).',
        fix: null,
      },
      ...ctx.losses.issues(),
      ...ctx.legacy.issues(),
      ...unknownIssue(stats.unknown),
    ],
  };
}

function playlistOf(ctx: Context, p: Message): ParsedPlaylist {
  const children = list(msg(p['playlists'])?.['playlists']).map((c) => playlistOf(ctx, c));
  const items: ParsedPlaylistItem[] = [];
  for (const item of list(msg(p['items'])?.['items'])) {
    const name = str(item['name']);
    const header = msg(item['header']);
    const presentation = msg(item['presentation']);
    const cue = msg(item['cue']);
    if (header) items.push({ kind: 'header', name, color: pp7Color(header['color'])?.slice(0, 7) ?? null });
    else if (presentation) {
      const path = urlPath(presentation['document_path']);
      items.push({
        kind: 'presentation',
        name: name || (path ? nameFromFile(path) : 'Presentation'),
        path,
        ref: null,
        arrangementRef: uuid(presentation['arrangement']),
      });
    } else if (cue) {
      const media = list(cue['actions'])
        .map((a) => msg(a['media']))
        .find(Boolean);
      const element = msg(media?.['element']);
      const index = addMedia(ctx, element, media?.['audio'] ? 'audio' : 'video');
      items.push(
        index === null
          ? { kind: 'placeholder', name: name || 'Cue', hint: 'A cue without media.' }
          : { kind: 'media', name: name || 'Media', media: index },
      );
    } else {
      ctx.losses.add(
        'playlist-item',
        'A playlist item (placeholder or planning link) came across as a placeholder.',
        '{n} playlist items (placeholders or planning links) came across as placeholders.',
        'info',
      );
      items.push({
        kind: 'placeholder',
        name: name || 'Item',
        hint: item['planning_center'] ? 'Planning Center item' : null,
      });
    }
  }
  // Type 2 is a folder of playlists.
  const isFolder = num(p['type']) === 2 || (children.length > 0 && items.length === 0);
  return { name: str(p['name']), isFolder, ref: uuid(p['uuid']), items, children };
}

function playlistDocOf(bytes: Uint8Array, filePath: string): ParsedPlaylistDoc {
  const stats = { unknown: 0 };
  const d = decodeMessage(bytes, 'rv.data.PlaylistDocument', descriptor, stats);
  const ctx = newContext({ width: 0, height: 0 });
  const root = msg(d['root_node']);
  const top = root ? playlistOf(ctx, root) : null;
  // The root is not shown in the app: its children are the top level.
  const playlists = top ? [...top.children] : [];
  if (top && top.items.length > 0) playlists.unshift({ ...top, children: [], name: nameFromFile(filePath) });
  return {
    name: nameFromFile(filePath),
    playlists,
    media: ctx.media,
    issues: [...ctx.losses.issues(), ...unknownIssue(stats.unknown)],
  };
}

/** Props (Configuration/Props): each cue shows one prop slide, drawn over whatever slide is live. */
function propsDocOf(bytes: Uint8Array): ParsedProps {
  const stats = { unknown: 0 };
  const d = decodeMessage(bytes, 'rv.data.PropDocument', descriptor, stats);
  const cues = list(d['cues']);
  const baseOf = (cue: Message) =>
    msg(
      msg(msg(list(cue['actions']).find((a) => msg(msg(a['slide'])?.['prop']))?.['slide'])?.['prop'])?.[
        'base_slide'
      ],
    );
  const ctx = newContext(sizeOf(cues.map(baseOf)));
  const props = cues.flatMap((cue, i) => {
    const base = baseOf(cue);
    if (!base) return [];
    const elements = list(base['elements']).flatMap((w, n) => elementsOf(ctx, w, `p${i}-e${n}`));
    return [{ name: str(cue['name']).trim() || `Prop ${i + 1}`, ref: uuid(cue['uuid']), elements }];
  });
  return {
    width: ctx.width,
    height: ctx.height,
    props,
    media: ctx.media,
    issues: [...ctx.losses.issues(), ...ctx.legacy.issues(), ...unknownIssue(stats.unknown)],
  };
}

/** Parse a PP7 file of a known kind. Throws ProtobufError when the bytes are not that kind of file. */
export function parsePp7(bytes: Uint8Array, filePath: string, kind: Pp7Kind): Pp7Parsed {
  if (kind === 'playlist') return { kind: 'playlist', playlist: playlistDocOf(bytes, filePath) };
  if (kind === 'props') return { kind: 'props', props: propsDocOf(bytes) };
  return {
    kind: 'presentation',
    presentation: kind === 'template' ? templateOf(bytes, filePath) : presentationOf(bytes, filePath),
  };
}

/** What a PP7 file is, from its name and folder; null when it is not one the importer reads. */
export function pp7KindOf(path: string): Pp7Kind | null {
  const name = basename(path);
  if (/\.pro$/iu.test(name)) return 'presentation';
  if (name === 'Theme') return 'template';
  if (name === 'Props' && basename(dirname(path)) === 'Configuration') return 'props';
  if (!name.includes('.') && basename(dirname(path)) === 'Playlists') return 'playlist';
  return null;
}
