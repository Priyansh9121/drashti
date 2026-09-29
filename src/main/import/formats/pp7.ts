import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ImportIssue } from '../../../shared/import';
import type {
  MediaElement,
  Rect,
  ShapeElement,
  SlideElement,
  TextElement,
  VerticalAlign,
} from '../../../shared/model';
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

export type Pp7Kind = 'presentation' | 'playlist' | 'template';

export type Pp7Parsed =
  | { kind: 'presentation'; presentation: ParsedPresentation }
  | { kind: 'playlist'; playlist: ParsedPlaylistDoc };

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
}

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

const scaleOf = (media: Message | undefined): MediaElement['fit'] => {
  const drawing = msg(msg(media?.['image'])?.['drawing']) ?? msg(msg(media?.['video'])?.['drawing']);
  return FIT[num(drawing?.['scale_behavior'])] ?? 'fit';
};

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
  const frame = rect(e['bounds']) ?? { x: 0, y: 0, width: ctx.width, height: ctx.height };
  if (num(e['rotation']) % 360 !== 0) {
    ctx.losses.add('rotation', 'A rotated element shows unrotated.', '{n} rotated elements show unrotated.');
  }
  const opacity = Math.min(1, Math.max(0, num(e['opacity'], 1)));
  const fill = msg(e['fill']);
  const fillOn = fill?.['enable'] === true;
  const out: SlideElement[] = [];
  const text = msg(e['text']);
  const rtfBytes = bytesOf(text?.['rtf_data']);
  if (msg(e['stroke'])?.['enable'] === true) {
    ctx.losses.add(
      'outline',
      'An element outline is not shown yet.',
      '{n} element outlines are not shown yet.',
    );
  }
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
    }
    return out;
  }
  const fillColor = fillOn ? pp7Color(fill['color']) : null;
  if (fillColor) {
    const shape: ShapeElement = {
      id: rtfBytes ? `${id}-fill` : id,
      kind: 'shape',
      frame,
      fill: fillColor,
      cornerRadius: 0,
      opacity,
    };
    out.push(shape);
  }
  const points = list(msg(e['path'])?.['points']);
  if (!rtfBytes && points.length > 4) {
    ctx.losses.add('custom-shape', 'A custom shape is not imported.', '{n} custom shapes are not imported.');
    return [];
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
      shadow: msg(text?.['shadow'])?.['enable'] === true || msg(e['shadow'])?.['enable'] === true,
    },
  };
  if (runs.length > 0) el.runs = runs;
  out.push(el);
  return out;
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
        cues.push({
          kind: 'audio',
          label,
          media: addMedia(ctx, element, 'audio'),
          props: { volume: Math.min(1, Math.max(0, volume)), loop: behavior >= 1 && behavior <= 3 },
        });
        continue;
      }
      const kind: 'image' | 'video' = media['video'] || element?.['video'] ? 'video' : 'image';
      const index = addMedia(ctx, element, kind);
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
  if (presentationSlide?.['transition']) {
    ctx.losses.add(
      'transition',
      'A slide transition is not imported yet.',
      '{n} slide transitions are not imported yet.',
      'info',
    );
  }
  return {
    label: str(cue['name']),
    notes: notesRtf ? readRtf(notesRtf).text : '',
    background: base?.['draws_background_color'] === true ? pp7Color(base['background_color']) : null,
    // Only files that mark enabled cues can mark disabled ones (proto3 leaves false out).
    enabled: usesEnabled ? cue['isEnabled'] === true : true,
    elements,
    cues: cuesOf(ctx, actions),
  };
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
          message: `${unknown} field(s) in this file are from a format version the importer does not know; they were not imported.`,
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
  const ctx: Context = {
    media: [],
    mediaIndex: new Map(),
    losses: new Losses(),
    legacy: new LegacyFontUse(),
    ...sizeOf(baseSlides),
  };
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
  }));
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
  return {
    name: str(p['name']) || nameFromFile(filePath),
    ref: uuid(p['uuid']),
    width: ctx.width,
    height: ctx.height,
    notes,
    groups,
    arrangements,
    media: ctx.media,
    issues: [...ctx.losses.issues(), ...ctx.legacy.issues(), ...unknownIssue(stats.unknown)],
  };
}

function templateOf(bytes: Uint8Array, filePath: string): ParsedPresentation {
  const stats = { unknown: 0 };
  const d = decodeMessage(bytes, 'rv.data.Template.Document', descriptor, stats);
  const slides = list(d['slides']);
  const ctx: Context = {
    media: [],
    mediaIndex: new Map(),
    losses: new Losses(),
    legacy: new LegacyFontUse(),
    ...sizeOf(slides.map((s) => msg(s['base_slide']))),
  };
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
  const ctx: Context = {
    media: [],
    mediaIndex: new Map(),
    losses: new Losses(),
    legacy: new LegacyFontUse(),
    width: 0,
    height: 0,
  };
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

/** Parse a PP7 file of a known kind. Throws ProtobufError when the bytes are not that kind of file. */
export function parsePp7(bytes: Uint8Array, filePath: string, kind: Pp7Kind): Pp7Parsed {
  if (kind === 'playlist') return { kind: 'playlist', playlist: playlistDocOf(bytes, filePath) };
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
  if (!name.includes('.') && basename(dirname(path)) === 'Playlists') return 'playlist';
  return null;
}
