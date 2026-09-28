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
import { fileNameOf, pathFromReference } from '../media-resolver';
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
import { LegacyFontUse } from '../legacy-fonts';
import { readRtf } from '../rtf/rtf';
import { mediaKindOf } from '../scan';
import { arrayField, field, parseXml, type XmlNode } from '../xml';
import { nameFromFile } from './text';

/*
 * ProPresenter 6 files (XML, confirmed against PP6 6.5 files on the dev Mac):
 *   .pro6          RVPresentationDocument: groups of slides, arrangements
 *   .pro6Template  RVTemplateDocument: slides without groups
 *   .pro6pl        RVPlaylistDocument: folders and playlists of documents,
 *                  headers and media
 * Bundles (.pro6x, .pro6plx) are ZIP archives of these plus their media; the
 * pipeline unpacks them. Slide text is RTF, base64-encoded in the XML.
 * Anything that does not come across is counted and reported.
 */

/** Templates (and themes) go in their own library, apart from the presentations. */
export const TEMPLATES_LIBRARY = 'Templates';

export type Pp6Parsed =
  | { kind: 'presentation'; presentation: ParsedPresentation }
  | { kind: 'playlist'; playlist: ParsedPlaylistDoc }
  | { kind: 'other'; root: string };

/** "r g b a" (0-1 each) as #rrggbb, or #rrggbbaa when not opaque; null when transparent or unreadable. */
export function pp6Color(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.trim().split(/\s+/u).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  if (a <= 0) return null;
  const hex = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 1 ? hex(a) : ''}`;
}

/** "{x y z width height}" (RVRect3D) as a rectangle. */
export function pp6Rect(value: string | undefined): Rect | null {
  const nums = (value ?? '').replace(/[{}]/gu, ' ').trim().split(/\s+/u).map(Number);
  if (nums.length < 5 || nums.some((n) => !Number.isFinite(n))) return null;
  const [x = 0, y = 0, , width = 0, height = 0] = nums;
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

const VERTICAL: Record<string, VerticalAlign> = { '0': 'top', '1': 'middle', '2': 'bottom' };
const FIT: Record<string, MediaElement['fit']> = { '0': 'fit', '1': 'fill', '2': 'stretch' };

/** Notes are plain text, or base64 RTF in some versions. */
function notesText(value: string | undefined): string {
  if (!value) return '';
  if (value.startsWith('e1xydGYx')) return readRtf(Buffer.from(value, 'base64')).text;
  return value;
}

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

const RTF_FEATURE_CODES: Record<string, string> = {
  underline: 'rtf-underline',
  strikethrough: 'rtf-strikethrough',
  'text outline': 'text-outline',
  'text shadow': 'rtf-shadow',
  'embossed text': 'rtf-emboss',
  'engraved text': 'rtf-engrave',
  'all capitals': 'all-caps',
  'small capitals': 'rtf-small-caps',
  'superscript or subscript': 'rtf-superscript',
  'text background colour': 'rtf-background',
  'stretched text': 'rtf-stretch',
  'justified alignment': 'rtf-justified',
};

interface Context {
  width: number;
  height: number;
  media: ParsedMediaRef[];
  mediaIndex: Map<string, number>;
  losses: Losses;
  /** Legacy (non-Unicode) Gujarati and Hindi fonts in the text. */
  legacy: LegacyFontUse;
}

function addMedia(ctx: Context, source: string | undefined, fallback: ParsedMediaRef['kind']): number | null {
  if (!source) return null;
  const known = ctx.mediaIndex.get(source);
  if (known !== undefined) return known;
  const kind = mediaKindOf(pathFromReference(source)) ?? fallback;
  ctx.media.push({ originalPath: source, kind });
  ctx.mediaIndex.set(source, ctx.media.length - 1);
  return ctx.media.length - 1;
}

function mediaElement(
  ctx: Context,
  node: XmlNode,
  id: string,
  frame: Rect,
  kind: 'image' | 'video',
): MediaElement | null {
  const index = addMedia(ctx, node.attrs['source'], kind);
  if (index === null) return null;
  const el: MediaElement = {
    id,
    kind,
    frame,
    mediaId: mediaRef(index),
    fit: FIT[node.attrs['scaleBehavior'] ?? ''] ?? 'fit',
  };
  if (kind === 'video' && node.attrs['playbackBehavior'] === '1') el.loop = true;
  const opacity = num(node.attrs['opacity'], 1);
  if (opacity < 1) el.opacity = Math.max(0, opacity);
  return el;
}

function textElement(ctx: Context, node: XmlNode, id: string, frame: Rect): SlideElement[] {
  const out: SlideElement[] = [];
  const a = node.attrs;
  if (a['drawingFill'] === 'true') {
    const fill = pp6Color(a['fillColor']);
    if (fill) {
      const shape: ShapeElement = {
        id: `${id}-fill`,
        kind: 'shape',
        frame,
        fill,
        cornerRadius: Math.max(0, num(a['bezelRadius'], 0)),
        opacity: Math.min(1, Math.max(0, num(a['opacity'], 1))),
      };
      out.push(shape);
    }
  }
  const rtfNode = node.children.find((c) => c.attrs['rvXMLIvarName'] === 'RTFData');
  const plainNode = node.children.find((c) => c.attrs['rvXMLIvarName'] === 'PlainText');
  let text = '';
  let runs: TextElement['runs'];
  let align: TextElement['style']['align'] = 'center';
  let lineHeight = 1.2;
  let size = 72;
  let color = '#ffffff';
  if (rtfNode && rtfNode.text.trim() !== '') {
    const rtf = readRtf(Buffer.from(rtfNode.text.trim(), 'base64'));
    runs = withDetectedLangs(ctx.legacy.apply(rtf.runs));
    text = rtf.text;
    align = rtf.align ?? align;
    lineHeight = rtf.lineHeight ?? lineHeight;
    size = rtf.runs.find((r) => r.size !== undefined)?.size ?? size;
    color = rtf.runs.find((r) => r.color !== undefined)?.color ?? color;
    for (const feature of rtf.unsupported) {
      ctx.losses.add(
        RTF_FEATURE_CODES[feature] ?? 'rtf-other',
        `Text formatting "${feature}" is not shown yet.`,
        `Text formatting "${feature}" (in {n} text boxes) is not shown yet.`,
      );
    }
  } else if (plainNode && plainNode.text.trim() !== '') {
    text = Buffer.from(plainNode.text.trim(), 'base64').toString('utf8');
  }
  if (a['drawingStroke'] === 'true') {
    ctx.losses.add(
      'text-outline',
      'A text box outline is not shown yet.',
      '{n} text box outlines are not shown yet.',
    );
  }
  if (a['useAllCaps'] === 'true') {
    ctx.losses.add(
      'all-caps',
      'A text box shown in all capitals shows as typed.',
      '{n} text boxes shown in all capitals show as typed.',
    );
  }
  if (a['revealType'] !== undefined && a['revealType'] !== '0') {
    ctx.losses.add(
      'text-reveal',
      'Text revealed a line at a time shows all at once.',
      '{n} text boxes revealed a line at a time show all at once.',
    );
  }
  const el: TextElement = {
    id,
    kind: 'text',
    frame,
    text,
    lang: runs ? mainLang(runs) : null,
    style: {
      fontFamily: null,
      fontSize: size,
      fontWeight: 400,
      color,
      align,
      verticalAlign: VERTICAL[a['verticalAlignment'] ?? ''] ?? 'middle',
      lineHeight,
      shadow: a['drawingShadow'] === 'true',
    },
  };
  if (runs && runs.length > 0) el.runs = runs;
  out.push(el);
  return out;
}

function elementsOf(ctx: Context, node: XmlNode, id: string): SlideElement[] {
  const frame = pp6Rect(field(node, 'position')?.text) ?? {
    x: 0,
    y: 0,
    width: ctx.width,
    height: ctx.height,
  };
  if (num(node.attrs['rotation'], 0) % 360 !== 0) {
    ctx.losses.add('rotation', 'A rotated element shows unrotated.', '{n} rotated elements show unrotated.');
  }
  switch (node.name) {
    case 'RVTextElement':
      return textElement(ctx, node, id, frame);
    case 'RVImageElement':
    case 'RVVideoElement': {
      const el = mediaElement(ctx, node, id, frame, node.name === 'RVImageElement' ? 'image' : 'video');
      return el ? [el] : [];
    }
    case 'RVShapeElement':
    case 'RVBezierPathElement': {
      const fill = node.attrs['drawingFill'] === 'true' ? pp6Color(node.attrs['fillColor']) : null;
      const custom = node.name === 'RVBezierPathElement' && node.attrs['isRectangle'] !== 'true';
      if (custom)
        ctx.losses.add(
          'custom-shape',
          'A custom shape is not imported.',
          '{n} custom shapes are not imported.',
        );
      if (node.attrs['drawingStroke'] === 'true') {
        ctx.losses.add(
          'shape-outline',
          'A shape outline is not shown yet.',
          '{n} shape outlines are not shown yet.',
        );
      }
      if (!fill || custom) return [];
      return [
        {
          id,
          kind: 'shape',
          frame,
          fill,
          cornerRadius: Math.max(0, num(node.attrs['bezelRadius'], 0)),
          opacity: Math.min(1, Math.max(0, num(node.attrs['opacity'], 1))),
        },
      ];
    }
    default:
      ctx.losses.add(
        `element-${node.name}`,
        `A slide element of type ${node.name} is not imported.`,
        `{n} slide elements of type ${node.name} are not imported.`,
      );
      return [];
  }
}

function cueOf(ctx: Context, node: XmlNode): ParsedCue {
  const label = node.attrs['displayName'] ?? '';
  const element = node.children.find((c) => c.attrs['rvXMLIvarName'] === 'element');
  switch (node.name) {
    case 'RVAudioCue':
      return {
        kind: 'audio',
        label,
        media: addMedia(ctx, element?.attrs['source'], 'audio'),
        props: { volume: num(element?.attrs['volume'], 1), loop: element?.attrs['loopBehavior'] === '1' },
      };
    case 'RVMediaCue':
      return { kind: 'media', label, media: addMedia(ctx, element?.attrs['source'], 'video'), props: {} };
    case 'RVClearCue':
      return { kind: 'clear', label, media: null, props: { action: node.attrs['actionType'] ?? '' } };
    case 'RVMessageCue':
      return { kind: 'message', label, media: null, props: {} };
    case 'RVTimerCue':
    case 'RVClockCue':
      return { kind: 'timer', label, media: null, props: {} };
    default:
      return { kind: 'other', label: label || node.name, media: null, props: { type: node.name } };
  }
}

function slideOf(ctx: Context, node: XmlNode, docBackground: string | null, index: number): ParsedSlide {
  const a = node.attrs;
  const elements: SlideElement[] = [];
  const cues: ParsedCue[] = [];
  // The slide's background image or video goes to the background layer, as a cue (PLAN.md 4.3):
  // it stays up on later slides without a background of their own, and Clear background leaves the text.
  const background = field(node, 'backgroundMediaCue');
  const backgroundElement = background?.children.find((c) => c.attrs['rvXMLIvarName'] === 'element');
  if (
    backgroundElement &&
    (backgroundElement.name === 'RVImageElement' || backgroundElement.name === 'RVVideoElement')
  ) {
    const media = backgroundElement.name === 'RVImageElement' ? 'image' : 'video';
    const ref = addMedia(ctx, backgroundElement.attrs['source'], media);
    if (ref !== null) {
      cues.push({
        kind: 'background',
        label: background?.attrs['displayName'] ?? backgroundElement.attrs['displayName'] ?? '',
        media: ref,
        props: {
          media,
          fit: FIT[backgroundElement.attrs['scaleBehavior'] ?? ''] ?? 'fit',
          loop: media === 'video' && backgroundElement.attrs['playbackBehavior'] === '1',
        },
      });
      ctx.losses.add(
        'background-media',
        'A slide background (image or video) came across as a background cue; it shows once media playback is built.',
        '{n} slide backgrounds (images and videos) came across as background cues; they show once media playback is built.',
        'info',
      );
    }
  }
  arrayField(node, 'displayElements').forEach((child, i) => {
    elements.push(...elementsOf(ctx, child, `s${index}-e${i}`));
  });
  const otherCues = arrayField(node, 'cues').map((c) => cueOf(ctx, c));
  cues.push(...otherCues);
  if (otherCues.length > 0) {
    ctx.losses.add(
      'slide-cues',
      'A slide cue (audio, a clear, a message...) came across but does not run yet.',
      '{n} slide cues (audio, clears, messages...) came across but do not run yet.',
      'info',
    );
  }
  const transitionType = node.children.find((c) => c.name === 'RVTransition')?.attrs['transitionType'];
  if (transitionType !== undefined && transitionType !== '-1') {
    ctx.losses.add(
      'transition',
      'A slide transition is not imported yet.',
      '{n} slide transitions are not imported yet.',
      'info',
    );
  }
  if (a['hotKey'])
    ctx.losses.add(
      'hot-key',
      'A slide hot key is not imported.',
      '{n} slide hot keys are not imported.',
      'info',
    );
  return {
    label: a['label'] ?? '',
    notes: notesText(a['notes']),
    background: a['drawingBackgroundColor'] === 'true' ? pp6Color(a['backgroundColor']) : docBackground,
    enabled: a['enabled'] !== 'false',
    elements,
    cues,
  };
}

function presentationOf(root: XmlNode, filePath: string): ParsedPresentation {
  const a = root.attrs;
  const ctx: Context = {
    width: num(a['width'], 1024) || 1024,
    height: num(a['height'], 768) || 768,
    media: [],
    mediaIndex: new Map(),
    losses: new Losses(),
    legacy: new LegacyFontUse(),
  };
  const docBackground = a['drawingBackgroundColor'] === 'true' ? pp6Color(a['backgroundColor']) : null;
  let slideIndex = 0;
  const groups: ParsedGroup[] = [];
  const groupIds = new Map<string, number>();
  if (root.name === 'RVTemplateDocument') {
    const slides = arrayField(root, 'slides').filter((n) => n.name === 'RVDisplaySlide');
    groups.push({
      name: 'Template',
      color: null,
      slides: slides.map((s) => slideOf(ctx, s, docBackground, slideIndex++)),
    });
  } else {
    for (const g of arrayField(root, 'groups')) {
      if (g.name !== 'RVSlideGrouping') continue;
      const slides = arrayField(g, 'slides').filter((n) => n.name === 'RVDisplaySlide');
      groups.push({
        name: g.attrs['name'] ?? '',
        color: pp6Color(g.attrs['color'])?.slice(0, 7) ?? null,
        slides: slides.map((s) => slideOf(ctx, s, docBackground, slideIndex++)),
      });
      if (g.attrs['uuid']) groupIds.set(g.attrs['uuid'], groups.length - 1);
    }
  }
  const arrangements: ParsedArrangement[] = arrayField(root, 'arrangements')
    .filter((n) => n.name === 'RVSongArrangement')
    .map((n) => ({
      name: n.attrs['name'] ?? 'Arrangement',
      groups: arrayField(n, 'groupIDs')
        .map((id) => groupIds.get(id.text.trim()))
        .filter((i): i is number => i !== undefined),
    }));
  const issues: ImportIssue[] = [];
  if (root.name === 'RVTemplateDocument') {
    issues.push({
      severity: 'info',
      code: 'template',
      message:
        'A template: kept in the Templates library, apart from the presentations (Drashti themes come later).',
      fix: null,
    });
  }
  const ccli = [
    'CCLISongTitle',
    'CCLIAuthor',
    'CCLIArtistCredits',
    'CCLIPublisher',
    'CCLICopyrightYear',
    'CCLISongNumber',
  ]
    .map((k) => [k.replace('CCLI', ''), a[k]] as const)
    .filter(([, v]) => v !== undefined && v !== '');
  let notes = notesText(a['notes']);
  if (ccli.length > 0)
    notes = `${notes}${notes ? '\n\n' : ''}CCLI: ${ccli.map(([k, v]) => `${k} ${v ?? ''}`).join('; ')}`;
  issues.push(...ctx.losses.issues(), ...ctx.legacy.issues());
  return {
    name: nameFromFile(filePath),
    ...(root.name === 'RVTemplateDocument' ? { library: TEMPLATES_LIBRARY } : {}),
    ref: a['uuid'] ?? null,
    width: ctx.width,
    height: ctx.height,
    notes,
    groups,
    arrangements,
    media: ctx.media,
    issues,
  };
}

function playlistOf(ctx: Context, node: XmlNode, losses: Losses): ParsedPlaylist {
  const children: ParsedPlaylist[] = [];
  const items: ParsedPlaylistItem[] = [];
  for (const child of arrayField(node, 'children')) {
    const a = child.attrs;
    const name = a['displayName'] ?? '';
    switch (child.name) {
      case 'RVPlaylistNode':
        children.push(playlistOf(ctx, child, losses));
        break;
      case 'RVDocumentCue': {
        const path = a['filePath'] ? pathFromReference(a['filePath']) : null;
        items.push({
          kind: 'presentation',
          name: name || (path ? nameFromFile(path) : 'Presentation'),
          path,
          ref: null,
        });
        break;
      }
      case 'RVHeaderCue':
        items.push({ kind: 'header', name, color: pp6Color(a['color'])?.slice(0, 7) ?? null });
        break;
      case 'RVMediaCue':
      case 'RVAudioCue': {
        const element = child.children.find((c) => c.attrs['rvXMLIvarName'] === 'element');
        const index = addMedia(
          ctx,
          element?.attrs['source'],
          child.name === 'RVAudioCue' ? 'audio' : 'video',
        );
        if (index === null)
          items.push({ kind: 'placeholder', name: name || 'Media', hint: 'The media file was not named.' });
        else
          items.push({
            kind: 'media',
            name: name || fileNameOf(element?.attrs['source'] ?? ''),
            media: index,
          });
        break;
      }
      default:
        losses.add(
          `playlist-${child.name}`,
          `A playlist item of type ${child.name} came across as a placeholder.`,
          `{n} playlist items of type ${child.name} came across as placeholders.`,
        );
        items.push({ kind: 'placeholder', name: name || child.name, hint: child.name });
    }
  }
  // A node holding other playlists is a folder (type 2 in these files).
  const isFolder = node.attrs['type'] === '2' || (children.length > 0 && items.length === 0);
  return {
    name: node.attrs['displayName'] ?? '',
    isFolder,
    ref: node.attrs['UUID'] ?? null,
    items,
    children,
  };
}

function playlistDocOf(root: XmlNode, filePath: string): ParsedPlaylistDoc {
  const ctx: Context = {
    width: 0,
    height: 0,
    media: [],
    mediaIndex: new Map(),
    losses: new Losses(),
    legacy: new LegacyFontUse(),
  };
  const rootNode = field(root, 'rootNode');
  const top = rootNode ? playlistOf(ctx, rootNode, ctx.losses) : null;
  // The root node itself is not shown in the app: its children are the top level.
  const playlists = top ? [...top.children] : [];
  if (top && top.items.length > 0) playlists.unshift({ ...top, children: [], name: nameFromFile(filePath) });
  return { name: nameFromFile(filePath), playlists, media: ctx.media, issues: ctx.losses.issues() };
}

/** Parse a PP6 XML file (presentation, template or playlist). Throws on files that are not XML. */
export function parsePp6(bytes: Uint8Array, filePath: string): Pp6Parsed {
  const root = parseXml(Buffer.from(bytes).toString('utf8'));
  if (root.name === 'RVPresentationDocument' || root.name === 'RVTemplateDocument') {
    return { kind: 'presentation', presentation: presentationOf(root, filePath) };
  }
  if (root.name === 'RVPlaylistDocument')
    return { kind: 'playlist', playlist: playlistDocOf(root, filePath) };
  return { kind: 'other', root: root.name };
}
