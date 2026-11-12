import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { RETAINED_SLIDE_PICTURE, sourcePictureRegion } from '../../../shared/editable-source';
import {
  MAX_LIST_LEVEL,
  type GradientFill,
  type Lang,
  type MediaElement,
  type ListMark,
  type Outline,
  type Rect,
  type ShapeElement,
  type ShapeKind,
  type SlideElement,
  type TextElement,
  type TextParagraph,
  type TextRun,
  type TextStyle,
} from '../../../shared/model';
import { detectLang, langOfLine } from '../../../shared/text-runs';
import { cutText } from '../../../shared/text';
import { mediaRef, type ParsedMediaRef } from '../model';
import { parseXml, XmlError, type XmlNode } from '../xml';
import { listZip, readZipEntries, type ZipEntry } from '../zip';

/*
 * A static editable derivative of a PPTX's own OOXML, never its baked slide picture.
 * No external relationship is opened and no original is written. Unsupported
 * objects/effects are named in issues so a caller can explain conversion limits.
 * Dimensions and fonts are CSS pixels: EMU / 9525 and points * 4/3.
 */
export interface EditablePptxSlide {
  sourceIndex: number;
  hidden: boolean;
  background: string | null;
  elements: SlideElement[];
  issues: string[];
}
export interface EditablePptx {
  sourceCount: number;
  width: number;
  height: number;
  slides: EditablePptxSlide[];
  media: ParsedMediaRef[];
}

const EMU = 9525;
const DEFAULT_LINE_HEIGHT = 1.2;
const MAX_XML = 8 * 1024 * 1024;
const MAX_XML_TOTAL = 64 * 1024 * 1024;
const MAX_IMAGE = 32 * 1024 * 1024;
const MAX_IMAGE_TOTAL = 128 * 1024 * 1024;
const MAX_ELEMENTS = 500;
type Node = XmlNode | undefined;
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const nameOf = (node: XmlNode) => node.name.split(':').at(-1) ?? node.name;
const kids = (node: Node, name?: string): XmlNode[] =>
  (node?.children ?? []).filter((n) => name === undefined || nameOf(n) === name);
const child = (node: Node, name: string): Node => kids(node, name)[0];
const attr = (node: Node, key: string): string | undefined => {
  const direct = node?.attrs[key];
  if (direct !== undefined || !key.startsWith('r:')) return direct;
  const local = key.replace(/^r:/u, '');
  return Object.entries(node?.attrs ?? {}).find(
    ([name]) => name.includes(':') && name.endsWith(`:${local}`),
  )?.[1];
};
const number = (value: string | undefined, fallback: number) => {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const flag = (value: string | undefined) => value === '1' || value === 'true';
const round = (n: number) => Math.round(n * 100_000) / 100_000;
const lowToHighValue = (nodes: Node[], key: string): string | undefined => {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const value = attr(nodes[i], key);
    if (value !== undefined) return value;
  }
  return undefined;
};
const lastChild = (nodes: Node[], name: string): Node => {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const found = child(nodes[i], name);
    if (found) return found;
  }
  return undefined;
};
function descendants(node: Node, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  const pending = node ? [...node.children].reverse() : [];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    if (nameOf(item) === name) found.push(item);
    pending.push(...[...item.children].reverse());
  }
  return found;
}
function xml(bytes: Buffer): XmlNode {
  const text = bytes.toString('utf8');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(text))
    throw new Error('XML declarations that define document types or entities are not supported.');
  const root = parseXml(text);
  const pending = [{ node: root, depth: 0 }];
  let count = 0;
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) continue;
    if (++count > 100_000 || next.depth > 128)
      throw new Error('This presentation has XML too complex to edit safely.');
    for (const node of next.node.children) pending.push({ node, depth: next.depth + 1 });
  }
  return root;
}

/** Small batches also bound memory when an archive lies about inflated sizes. */
async function readParts(file: string, entries: ZipEntry[], maxPart: number, maxTotal: number) {
  const result = new Map<string, Buffer>();
  let total = 0;
  for (let start = 0; start < entries.length; start += 4) {
    const wanted = new Set(entries.slice(start, start + 4).map((entry) => entry.name));
    const read = await readZipEntries(file, (name) => wanted.has(name), maxPart);
    for (const [name, bytes] of read) {
      total += bytes.length;
      if (total > maxTotal)
        throw new Error('The inflated presentation parts exceed the editable memory limit.');
      result.set(name, bytes);
    }
  }
  return result;
}

interface Relationship {
  type: string;
  target: string | null;
  external: boolean;
}
interface Part {
  path: string;
  root: XmlNode;
  rels: Map<string, Relationship>;
}
function safeTarget(owner: string, target: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return null;
  }
  if (
    /^[a-z][a-z0-9+.-]*:/iu.test(decoded) ||
    /[\\?#]/u.test(decoded) ||
    decoded.includes(String.fromCharCode(0)) ||
    decoded.startsWith('//')
  )
    return null;
  const path = posix.normalize(
    decoded.startsWith('/') ? decoded.slice(1) : posix.join(posix.dirname(owner), decoded),
  );
  return path.startsWith('ppt/') && !path.split('/').includes('..') ? path : null;
}
function makePart(path: string, roots: Map<string, XmlNode>): Part | undefined {
  const root = roots.get(path);
  if (!root) return undefined;
  const rels = new Map<string, Relationship>();
  const relRoot = roots.get(posix.join(posix.dirname(path), '_rels', `${posix.basename(path)}.rels`));
  for (const item of kids(relRoot, 'Relationship')) {
    const id = attr(item, 'Id');
    const target = attr(item, 'Target');
    if (!id || !target) continue;
    if (rels.has(id)) {
      // Keep ambiguous references unusable without invalidating other objects or slides.
      rels.set(id, { type: attr(item, 'Type') ?? '', external: false, target: null });
      continue;
    }
    const external = attr(item, 'TargetMode')?.toLowerCase() === 'external';
    rels.set(id, {
      type: attr(item, 'Type') ?? '',
      external,
      target: external ? null : safeTarget(path, target),
    });
  }
  return { path, root, rels };
}
function related(part: Part | undefined, kind: string, roots: Map<string, XmlNode>): Part | undefined {
  const rel = [...(part?.rels.values() ?? [])].find((r) => r.type.endsWith(`/${kind}`));
  return rel?.target && !rel.external ? makePart(rel.target, roots) : undefined;
}

interface Theme {
  colors: Record<string, string>;
  map: Record<string, string>;
  fonts: Record<string, string>;
}
interface Context {
  width: number;
  height: number;
  theme: Theme;
  master: Part | undefined;
  layout: Part | undefined;
  defaults: Node;
  issues: Set<string>;
  id: () => string;
  asset: (part: Part, relId: string, issues: Set<string>) => Promise<string | null>;
}
function themeOf(
  part: Part | undefined,
  master: Part | undefined,
  layout: Part | undefined,
  slide: Part,
): Theme {
  const colors: Record<string, string> = {};
  const scheme = descendants(part?.root, 'clrScheme')[0];
  for (const item of kids(scheme)) {
    const color = child(item, 'srgbClr');
    const system = child(item, 'sysClr');
    const value = attr(color, 'val') ?? attr(system, 'lastClr');
    if (value && /^[a-f0-9]{6}$/iu.test(value)) colors[nameOf(item)] = `#${value.toLowerCase()}`;
  }
  const map = {
    bg1: 'lt1',
    tx1: 'dk1',
    bg2: 'lt2',
    tx2: 'dk2',
    ...(child(master?.root, 'clrMap')?.attrs ?? {}),
  };
  for (const root of [layout?.root, slide.root])
    Object.assign(map, child(child(root, 'clrMapOvr'), 'overrideClrMapping')?.attrs);
  const fonts: Record<string, string> = {};
  for (const [family, token] of [
    ['majorFont', 'mj'],
    ['minorFont', 'mn'],
  ] as const) {
    const node = descendants(part?.root, family)[0];
    for (const [kind, suffix] of [
      ['latin', 'lt'],
      ['cs', 'cs'],
      ['ea', 'ea'],
    ] as const) {
      const face = attr(child(node, kind), 'typeface');
      if (face) fonts[`+${token}-${suffix}`] = face;
    }
  }
  return { colors, map, fonts };
}
function colorOf(node: Node, ctx: Context, placeholder?: string): string | null {
  if (!node) return null;
  const ownName = nameOf(node);
  const color = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(ownName)
    ? node
    : kids(node).find((n) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(nameOf(n)));
  if (!color) return null;
  const kind = nameOf(color);
  const value = attr(color, 'val') ?? '';
  const presets: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    gray: '#808080',
  };
  let hex =
    kind === 'srgbClr'
      ? `#${value}`
      : kind === 'sysClr'
        ? `#${attr(color, 'lastClr') ?? ''}`
        : kind === 'prstClr'
          ? presets[value]
          : value === 'phClr'
            ? placeholder
            : ctx.theme.colors[ctx.theme.map[value] ?? value];
  if (!hex || !/^#[a-f0-9]{6}$/iu.test(hex)) {
    ctx.issues.add('A source colour could not be reproduced.');
    return null;
  }
  let rgb = [1, 3, 5].map((at) => parseInt(hex?.slice(at, at + 2) ?? '00', 16));
  let alpha = 1;
  for (const change of kids(color)) {
    const amount = Math.max(0, Math.min(1, number(attr(change, 'val'), 100_000) / 100_000));
    switch (nameOf(change)) {
      case 'alpha':
        alpha = amount;
        break;
      case 'tint':
        rgb = rgb.map((c) => c + (255 - c) * amount);
        break;
      case 'shade':
        rgb = rgb.map((c) => c * amount);
        break;
      default:
        ctx.issues.add('Some source colour adjustments are not reproduced.');
    }
  }
  hex = `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  return (
    hex +
    (alpha < 1
      ? Math.round(alpha * 255)
          .toString(16)
          .padStart(2, '0')
      : '')
  );
}
function fillOf(nodes: Node[], ctx: Context, fallback: string | null = null): string | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const fill = kids(nodes[i]).find((n) =>
      ['solidFill', 'noFill', 'gradFill', 'blipFill', 'pattFill'].includes(nameOf(n)),
    );
    if (!fill) continue;
    if (nameOf(fill) === 'noFill') return null;
    if (nameOf(fill) === 'solidFill') return colorOf(fill, ctx) ?? fallback;
    ctx.issues.add('A gradient, patterned or picture fill is not reproduced as an editable fill.');
    return colorOf(descendants(fill, 'gs')[0], ctx) ?? fallback;
  }
  return fallback;
}
function referenceColor(chain: XmlNode[], kind: string, ctx: Context): string | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    const ref = child(child(chain[i], 'style'), kind);
    if (ref && attr(ref, 'idx') !== '0') return colorOf(ref, ctx);
  }
  return null;
}

const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const at = (m: Matrix, x: number, y: number) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});
function turning(node: Node): Matrix {
  const angle = ((number(attr(node, 'rot'), 0) / 60_000) * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const x = flag(attr(node, 'flipH')) ? -1 : 1,
    y = flag(attr(node, 'flipV')) ? -1 : 1;
  return [c * x, s * x, -s * y, c * y, 0, 0];
}
const about = (x: number, y: number, m: Matrix) => multiply(translate(x, y), multiply(m, translate(-x, -y)));
function rawRect(node: Node): Rect | null {
  const off = child(node, 'off'),
    ext = child(node, 'ext');
  const rect = {
    x: number(attr(off, 'x'), NaN),
    y: number(attr(off, 'y'), NaN),
    width: number(attr(ext, 'cx'), NaN),
    height: number(attr(ext, 'cy'), NaN),
  };
  return Object.values(rect).every(Number.isFinite) &&
    rect.width >= 0 &&
    rect.height >= 0 &&
    Math.max(Math.abs(rect.x), Math.abs(rect.y), rect.width, rect.height) <= 9525 * 1_000_000
    ? rect
    : null;
}
function placed(rect: Rect, matrix: Matrix, flipX: boolean, ctx: Context) {
  const sx = Math.hypot(matrix[0], matrix[1]),
    sy = Math.hypot(matrix[2], matrix[3]);
  if (
    !Number.isFinite(sx) ||
    !Number.isFinite(sy) ||
    sx === 0 ||
    sy === 0 ||
    Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) > sx * sy * 0.00001
  ) {
    ctx.issues.add('A slanted or squashed group of objects can’t be copied, so it was left out.');
    return null;
  }
  const center = at(matrix, rect.x + rect.width / 2, rect.y + rect.height / 2);
  const width = Math.max(0.01, (rect.width * sx) / EMU),
    height = Math.max(0.01, (rect.height * sy) / EMU);
  if (
    ![center.x, center.y, width, height].every(Number.isFinite) ||
    Math.max(Math.abs(center.x / EMU), Math.abs(center.y / EMU), width, height) > 1_000_000
  ) {
    ctx.issues.add('An object is placed or sized beyond what Drashti can copy, so it was left out.');
    return null;
  }
  const sign = flipX ? -1 : 1;
  const angle = ((Math.atan2(matrix[1] * sign, matrix[0] * sign) * 180) / Math.PI + 360) % 360;
  const flipY = (matrix[0] * matrix[3] - matrix[1] * matrix[2] < 0 ? -1 : 1) * sign < 0;
  return {
    frame: {
      x: round(center.x / EMU - width / 2),
      y: round(center.y / EMU - height / 2),
      width: round(width),
      height: round(height),
    },
    ...(Math.abs(angle) > 0.00001 && Math.abs(angle - 360) > 0.00001 ? { rotation: round(angle) } : {}),
    ...(flipX ? { flipX: true } : {}),
    ...(flipY ? { flipY: true } : {}),
  };
}
function placeholder(node: Node): Node {
  return child(child(child(node, 'nvSpPr'), 'nvPr'), 'ph');
}
function matching(root: Node, ph: Node): Node {
  if (!ph) return undefined;
  const candidates = descendants(root, 'sp').filter((n) => placeholder(n));
  const index = attr(ph, 'idx');
  return (
    (index === undefined ? undefined : candidates.find((n) => attr(placeholder(n), 'idx') === index)) ??
    candidates.find((n) => (attr(placeholder(n), 'type') ?? 'obj') === (attr(ph, 'type') ?? 'obj'))
  );
}
function chainOf(node: XmlNode, part: Part, ctx: Context): { node: XmlNode; part: Part }[] {
  const ph = placeholder(node);
  if (!ph) return [{ node, part }];
  const layout = matching(ctx.layout?.root, ph);
  const master = matching(ctx.master?.root, placeholder(layout) ?? ph);
  return [
    ...(master && ctx.master ? [{ node: master, part: ctx.master }] : []),
    ...(layout && ctx.layout ? [{ node: layout, part: ctx.layout }] : []),
    { node, part },
  ];
}
function paragraphNodes(chain: XmlNode[], paragraph: XmlNode, ctx: Context): Node[] {
  const level = Math.max(0, Math.min(8, number(attr(child(paragraph, 'pPr'), 'lvl'), 0)));
  const levelName = `lvl${String(level + 1)}pPr`;
  const ph = placeholder(chain.at(-1));
  const type = attr(ph, 'type') ?? 'obj';
  const styleName = ['title', 'ctrTitle'].includes(type)
    ? 'titleStyle'
    : ph && ['body', 'obj'].includes(type)
      ? 'bodyStyle'
      : 'otherStyle';
  const masterStyle = child(child(ctx.master?.root, 'txStyles'), styleName);
  return [
    child(ctx.defaults, 'defPPr'),
    child(ctx.defaults, levelName),
    child(masterStyle, 'defPPr'),
    child(masterStyle, levelName),
    ...chain.flatMap((shape) => {
      const body = child(shape, 'txBody'),
        list = child(body, 'lstStyle');
      return [
        child(list, 'defPPr'),
        child(list, levelName),
        shape === chain.at(-1) ? undefined : child(kids(body, 'p')[0], 'pPr'),
      ];
    }),
    child(paragraph, 'pPr'),
  ];
}
function runOf(
  text: string,
  nodes: Node[],
  ctx: Context,
  scale: number,
  fallback: { font?: string; color?: string } = {},
): TextRun {
  const named = lastChild(nodes, 'latin') ?? lastChild(nodes, 'cs');
  const token = attr(named, 'typeface');
  let font = token
    ? (ctx.theme.fonts[token] ?? (token.startsWith('+') ? undefined : token))
    : (fallback.font ?? ctx.theme.fonts['+mn-lt']);
  if (font && font.length > 200) {
    font = cutText(font, 200);
    ctx.issues.add('An unusually long font name was shortened.');
  }
  const size = (((number(lowToHighValue(nodes, 'sz'), 2400) / 100) * 4) / 3) * scale;
  if (!(size > 0 && size <= 2000)) ctx.issues.add('A font size outside the editable range was adjusted.');
  const marked = lowToHighValue(nodes, 'lang')?.toLowerCase();
  const lang: Lang | null = marked?.startsWith('gu')
    ? 'gu'
    : marked?.startsWith('hi')
      ? 'hi'
      : marked?.startsWith('sa')
        ? 'sa'
        : null;
  const underline = lowToHighValue(nodes, 'u'),
    strike = lowToHighValue(nodes, 'strike');
  if ((underline && !['none', 'sng'].includes(underline)) || strike === 'dblStrike')
    ctx.issues.add('Some underline or strike styles use a single line in the editable copy.');
  return {
    text: text.normalize('NFC'),
    font: font ?? null,
    size: Math.max(0.01, Math.min(2000, size)),
    color:
      fillOf(nodes, ctx, fallback.color ?? ctx.theme.colors[ctx.theme.map['tx1'] ?? 'dk1'] ?? '#000000') ??
      '#00000000',
    weight: flag(lowToHighValue(nodes, 'b')) ? 700 : 400,
    italic: flag(lowToHighValue(nodes, 'i')),
    underline: underline !== undefined && underline !== 'none',
    strike: strike !== undefined && strike !== 'noStrike',
    lang: langOfLine(lang, text),
  };
}
const NUMBERED_LISTS: Record<string, ListMark> = {
  alphaLc: 'a',
  alphaUc: 'A',
  romanLc: 'i',
  romanUc: 'I',
  hindiNum: 'hi',
};

// Common bullet shapes in the symbol fonts. Unicode WG2 N4384 documents the Wingdings
// and Webdings positions. Use widely available glyphs of the same shape where possible.
const SYMBOL_BULLETS = new Map<string, Readonly<Record<number, string>>>([
  [
    'wingdings',
    {
      0x6c: '●',
      0x6e: '■',
      0x71: '❑',
      0x72: '❒',
      0x75: '◆',
      0x76: '❖',
      0x9f: '•',
      0xa7: '▪',
      0xab: '★',
      0xd8: '➢',
      0xe8: '➔',
      0xfb: '✗',
      0xfc: '✓',
      0xfd: '☒',
      0xfe: '☑',
    },
  ],
  [
    'wingdings2',
    {
      0x4f: '✗',
      0x50: '✓',
      0x51: '☒',
      0x52: '☑',
      0x53: '☒',
      0x54: '☒',
      0x98: '●',
      0x99: '○',
      0xa2: '■',
      0xa3: '□',
      0xaf: '◇',
      0xb1: '◈',
    },
  ],
  [
    'wingdings3',
    {
      0x21: '←',
      0x22: '→',
      0x23: '↑',
      0x24: '↓',
      0x70: '▲',
      0x71: '▼',
      0x72: '△',
      0x73: '▽',
      0x74: '◀',
      0x75: '▶',
      0x76: '◁',
      0x77: '▷',
    },
  ],
  [
    'webdings',
    {
      0x61: '✔',
      0x63: '□',
      0x67: '■',
      0x6e: '●',
    },
  ],
  [
    'symbol',
    {
      0xa7: '♣',
      0xa8: '♦',
      0xa9: '♥',
      0xaa: '♠',
      0xab: '↔',
      0xac: '←',
      0xad: '↑',
      0xae: '→',
      0xaf: '↓',
      0xb7: '•',
    },
  ],
]);

function bulletStyle(
  character: string,
  family: string | undefined,
  ctx: Context,
): Pick<TextParagraph, 'bullet' | 'bulletFont'> {
  const key = family?.toLowerCase().replace(/\s+/gu, '');
  const glyphs = SYMBOL_BULLETS.get(key === 'symbolmt' ? 'symbol' : (key ?? ''));
  if (!glyphs) {
    return { bullet: cutText(character, 8), ...(family ? { bulletFont: cutText(family, 200) } : {}) };
  }
  const code = character.codePointAt(0) ?? 0;
  const position = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code;
  const glyph = character.length === 1 ? glyphs[position] : undefined;
  if (glyph) return { bullet: glyph };
  // Some writers already supply Unicode (for example U+2022 with Symbol).
  if (position > 0xff && !/[\p{Co}\p{Cs}]/u.test(character)) return { bullet: cutText(character, 8) };
  ctx.issues.add('Some symbol bullets use a dot. Change them with Bullets or Numbering in Words.');
  return {};
}

function paragraphOf(
  nodes: Node[],
  xScale: number,
  yScale: number,
  ctx: Context,
): Pick<TextRun, 'paragraph' | 'list' | 'level'> {
  const alignment = lowToHighValue(nodes, 'algn') ?? 'l';
  const align =
    alignment === 'ctr'
      ? 'center'
      : alignment === 'r'
        ? 'right'
        : ['just', 'justLow', 'dist', 'thaiDist'].includes(alignment)
          ? 'justify'
          : 'left';
  const paragraph: TextParagraph = { align };
  const marginLeft = lowToHighValue(nodes, 'marL');
  const marginRight = lowToHighValue(nodes, 'marR');
  const indent = lowToHighValue(nodes, 'indent');
  const pixels = (value: string, min: number) =>
    round(Math.max(min, Math.min(16_384, (number(value, 0) * xScale) / EMU)));
  if (marginLeft !== undefined) paragraph.marginLeft = pixels(marginLeft, 0);
  if (marginRight !== undefined) paragraph.marginRight = pixels(marginRight, 0);
  if (indent !== undefined) paragraph.indent = pixels(indent, -16_384);
  const spacing = attr(child(lastChild(nodes, 'lnSpc'), 'spcPct'), 'val');
  if (spacing !== undefined)
    paragraph.lineHeight = Math.max(
      0.1,
      Math.min(5, round(DEFAULT_LINE_HEIGHT * (number(spacing, 100_000) / 100_000))),
    );

  const children = [...nodes].reverse().flatMap((node) => kids(node));
  const bullet = children.find((node) => ['buNone', 'buChar', 'buAutoNum', 'buBlip'].includes(nameOf(node)));
  if (!bullet || nameOf(bullet) === 'buNone') return { paragraph };
  const level = Math.min(MAX_LIST_LEVEL, Math.max(0, Math.trunc(number(lowToHighValue(nodes, 'lvl'), 0))));
  const color = children.find((node) => ['buClr', 'buClrTx'].includes(nameOf(node)));
  if (color && nameOf(color) === 'buClr') {
    const explicit = colorOf(color, ctx);
    if (explicit) paragraph.bulletColor = explicit;
  }
  const size = children.find((node) => ['buSzPct', 'buSzPts', 'buSzTx'].includes(nameOf(node)));
  const amount = attr(size, 'val');
  if (size && amount !== undefined) {
    if (nameOf(size) === 'buSzPct') {
      const scale = amount.endsWith('%')
        ? number(amount.replace(/%$/u, ''), 100) / 100
        : number(amount, 100_000) / 100_000;
      paragraph.bulletScale = Math.min(4, Math.max(0.25, scale));
    } else if (nameOf(size) === 'buSzPts') {
      const points = number(amount, 2400) / 100;
      paragraph.bulletSize = Math.min(2000, Math.max(0.01, points * (4 / 3) * yScale));
    }
  }
  const startAt = attr(bullet, 'startAt');
  if (nameOf(bullet) === 'buAutoNum' && startAt !== undefined)
    paragraph.startAt = Math.min(32_767, Math.max(1, Math.trunc(number(startAt, 1))));
  const character = attr(bullet, 'char');
  if (character) {
    const font = children.find((node) => ['buFont', 'buFontTx'].includes(nameOf(node)));
    const typeface = attr(font, 'typeface')?.trim();
    const family = typeface?.startsWith('+') ? ctx.theme.fonts[typeface] : typeface;
    Object.assign(paragraph, bulletStyle(character, family, ctx));
  }
  const numbering = (attr(bullet, 'type') ?? '').replace(/(?:Period|ParenR|ParenBoth|Plain)$/u, '');
  return {
    paragraph,
    list: nameOf(bullet) === 'buAutoNum' ? (NUMBERED_LISTS[numbering] ?? '1') : 'disc',
    ...(level ? { level } : {}),
  };
}

function textDirection(bodies: Node[]): Pick<TextStyle, 'writingMode' | 'textOrientation'> {
  switch (lowToHighValue(bodies, 'vert')) {
    case 'vert':
    case 'eaVert':
      return { writingMode: 'vertical-rl' };
    case 'vert270':
      return { writingMode: 'sideways-lr' };
    case 'mongolianVert':
      return { writingMode: 'vertical-lr' };
    case 'wordArtVert':
    case 'wordArtVertRtl':
      return { writingMode: 'vertical-rl', textOrientation: 'upright' };
    default:
      return {};
  }
}

function textElement(
  node: XmlNode,
  chain: XmlNode[],
  rect: Rect,
  matrix: Matrix,
  flipX: boolean,
  ctx: Context,
  keepEmpty = false,
): TextElement | null {
  const body = child(node, 'txBody');
  if (!body) return null;
  const paragraphs = kids(body, 'p'),
    runs: TextRun[] = [];
  const scale = Math.hypot(matrix[2], matrix[3]);
  const xScale = Math.hypot(matrix[0], matrix[1]);
  const fontRef = lastChild(
    chain.map((shape) => child(shape, 'style')),
    'fontRef',
  );
  const fontToken = attr(fontRef, 'idx') === 'major' ? '+mj-lt' : '+mn-lt';
  const fallback = {
    font: ctx.theme.fonts[fontToken],
    color: referenceColor(chain, 'fontRef', ctx) ?? undefined,
  };
  for (const [index, paragraph] of paragraphs.entries()) {
    const nodes = paragraphNodes(chain, paragraph, ctx);
    const defaults = nodes.map((n) => child(n, 'defRPr'));
    const formatting = paragraphOf(nodes, xScale, scale, ctx);
    const push = (words: string, style: Node[], softBreak = false) =>
      runs.push({
        ...runOf(words, style, ctx, scale, fallback),
        ...formatting,
        ...(softBreak ? { softBreak } : {}),
      });
    for (const piece of kids(paragraph)) {
      const kind = nameOf(piece);
      if (kind === 'br') push('\n', [...defaults, child(piece, 'rPr')], true);
      else if (kind === 'r' || kind === 'fld') {
        if (kind === 'fld') ctx.issues.add('Dynamic fields are kept as their current words.');
        const words = child(piece, 't')?.text ?? '';
        if (words !== '') push(words, [...defaults, child(piece, 'rPr')]);
      }
    }
    if (index < paragraphs.length - 1) push('\n', [...defaults, child(paragraph, 'endParaRPr')]);
  }
  const words = runs.map((run) => run.text).join('');
  if (words === '' && !keepEmpty) return null;
  if (words.length > 20_000 || runs.length > 2000)
    throw new Error('A source text box exceeds the editable text limit; its words were not truncated.');
  const first = runs.find((r) => r.text.trim() !== '') ?? runs[0];
  const bodies = chain.map((shape) => child(child(shape, 'txBody'), 'bodyPr'));
  const inset = (key: string, fallback: number) => Math.max(0, number(lowToHighValue(bodies, key), fallback));
  const shape = attr(
    lastChild(
      chain.map((el) => child(el, 'spPr')),
      'prstGeom',
    ),
    'prst',
  );
  const insetFraction = shape === 'ellipse' ? (1 - Math.SQRT1_2) / 2 : shape === 'diamond' ? 0.25 : 0;
  const left = inset('lIns', 91_440) + rect.width * insetFraction,
    right = inset('rIns', 91_440) + rect.width * insetFraction,
    top = inset('tIns', 45_720) + rect.height * insetFraction,
    bottom = inset('bIns', 45_720) + rect.height * insetFraction;
  if (left + right >= rect.width || top + bottom >= rect.height)
    ctx.issues.add('Source text insets leave no usable area; its editable frame was adjusted.');
  const frame = placed(
    {
      x: rect.x + left,
      y: rect.y + top,
      width: Math.max(1, rect.width - left - right),
      height: Math.max(1, rect.height - top - bottom),
    },
    matrix,
    flipX,
    ctx,
  );
  if (!frame) return null;
  const anchor = lowToHighValue(bodies, 'anchor');
  const clipToBox = ['vertOverflow', 'horzOverflow'].some((key) => lowToHighValue(bodies, key) === 'clip');
  const paragraph = first?.paragraph;
  const align = paragraph?.align === 'justify' ? 'left' : (paragraph?.align ?? 'left');
  return {
    id: ctx.id(),
    kind: 'text',
    ...frame,
    text: words,
    lang: detectLang(words),
    runs,
    style: {
      fontFamily: first?.font ?? null,
      fontSize: first?.size ?? 32,
      fontWeight: first?.weight ?? 400,
      color: first?.color ?? '#000000',
      align,
      verticalAlign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
      lineHeight: paragraph?.lineHeight ?? DEFAULT_LINE_HEIGHT,
      shadow: false,
      ...(!clipToBox || lastChild(bodies, 'normAutofit') ? { shrinkToFit: true } : {}),
      ...(clipToBox ? { clipToBox: true } : {}),
      ...(lowToHighValue(bodies, 'wrap') === 'none' ? { noWrap: true } : {}),
      ...textDirection(bodies),
    },
  };
}

const SHAPES: Record<string, ShapeKind> = {
  rect: 'rectangle',
  roundRect: 'rectangle',
  ellipse: 'ellipse',
  line: 'line',
  rightArrow: 'arrow',
  triangle: 'triangle',
  diamond: 'diamond',
  star5: 'star',
  heart: 'heart',
};
function lineOutline(line: Node, ctx: Context): Outline | null {
  if (!line || child(line, 'noFill')) return null;
  const color = fillOf([line], ctx, '#000000');
  return color ? { color, width: Math.max(0.01, Math.min(100, number(attr(line, 'w'), EMU) / EMU)) } : null;
}
function linePlacement(rect: Rect, matrix: Matrix) {
  const a = at(matrix, rect.x, rect.y),
    b = at(matrix, rect.x + rect.width, rect.y + rect.height);
  const width = Math.hypot(b.x - a.x, b.y - a.y) / EMU;
  return {
    frame: {
      x: round((a.x + b.x) / 2 / EMU - width / 2),
      y: round((a.y + b.y) / 2 / EMU - 0.5),
      width: Math.max(0.01, round(width)),
      height: 1,
    },
    rotation: round(((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360),
  };
}

interface SourcePaint {
  color: string | null;
  gradient?: GradientFill;
  picture?: Pick<MediaElement, 'mediaId' | 'crop'>;
}

function gradientOf(fill: XmlNode, ctx: Context): GradientFill | undefined {
  const fraction = (value: string | undefined) => Math.max(0, Math.min(1, number(value, 0) / 100_000));
  const stops = kids(child(fill, 'gsLst'), 'gs').flatMap((stop) => {
    const color = colorOf(stop, ctx);
    return color ? [{ offset: fraction(attr(stop, 'pos')), color }] : [];
  });
  if (stops.length < 2 || stops.length > 64) return undefined;
  stops.sort((a, b) => a.offset - b.offset);
  const radial = child(fill, 'path');
  if (radial) {
    const box = child(radial, 'fillToRect');
    const center = (start: string, end: string) =>
      (1 + fraction(attr(box, start)) - fraction(attr(box, end))) / 2;
    return { kind: 'radial', x: center('l', 'r'), y: center('t', 'b'), stops };
  }
  const degrees = number(attr(child(fill, 'lin'), 'ang'), 0) / 60_000;
  return { kind: 'linear', angle: ((degrees % 360) + 360) % 360, stops };
}

async function pictureOf(fill: Node, part: Part, ctx: Context): Promise<SourcePaint['picture']> {
  const blip = child(fill, 'blip');
  const embed = attr(blip, 'r:embed');
  if (attr(blip, 'r:link'))
    ctx.issues.add('Linked pictures are not opened; only an embedded copy can be used.');
  if (!embed) {
    ctx.issues.add('A linked or missing picture has no embedded copy.');
    return undefined;
  }
  const mediaId = await ctx.asset(part, embed, ctx.issues);
  if (!mediaId) return undefined;
  const crop = child(fill, 'srcRect');
  const l = number(attr(crop, 'l'), 0) / 100_000,
    t = number(attr(crop, 't'), 0) / 100_000;
  const r = number(attr(crop, 'r'), 0) / 100_000,
    b = number(attr(crop, 'b'), 0) / 100_000;
  const valid = l >= 0 && t >= 0 && r >= 0 && b >= 0 && 1 - l - r >= 0.01 && 1 - t - b >= 0.01;
  if (!valid) ctx.issues.add('A picture crop outside the editable range was left out.');
  if (child(fill, 'tile')) ctx.issues.add('A tiled picture is stretched once in the editable copy.');
  return {
    mediaId,
    ...(crop && valid ? { crop: { x: l, y: t, width: 1 - l - r, height: 1 - t - b } } : {}),
  };
}

async function shapePaintOf(
  sources: { props: Node; part: Part }[],
  ctx: Context,
  fallback: string | null,
): Promise<SourcePaint> {
  for (const { props, part } of [...sources].reverse()) {
    const fill = kids(props).find((item) =>
      ['solidFill', 'noFill', 'gradFill', 'blipFill', 'pattFill'].includes(nameOf(item)),
    );
    if (!fill) continue;
    switch (nameOf(fill)) {
      case 'noFill':
        return { color: null };
      case 'solidFill':
        return { color: colorOf(fill, ctx) ?? fallback };
      case 'gradFill': {
        const gradient = gradientOf(fill, ctx);
        if (gradient) return { color: gradient.stops[0]?.color ?? fallback, gradient };
        ctx.issues.add('A gradient could not be read. The editable copy uses its reference colour.');
        return { color: fallback };
      }
      case 'blipFill': {
        const picture = await pictureOf(fill, part, ctx);
        return picture ? { color: null, picture } : { color: fallback };
      }
      default:
        ctx.issues.add('A patterned fill uses its foreground colour in the editable copy.');
        return { color: colorOf(child(fill, 'fgClr'), ctx) ?? fallback };
    }
  }
  return { color: fallback };
}

function pictureClip(shape: ShapeKind | undefined, cornerRadius: number): Pick<MediaElement, 'pictureClip'> {
  if (!shape || shape === 'line' || shape === 'path' || (shape === 'rectangle' && !cornerRadius)) return {};
  return { pictureClip: { shape, ...(cornerRadius ? { cornerRadius } : {}) } };
}

function fallbackPicture(rect: Rect, matrix: Matrix, ctx: Context): SlideElement[] {
  const corners = [
    at(matrix, rect.x, rect.y),
    at(matrix, rect.x + rect.width, rect.y),
    at(matrix, rect.x, rect.y + rect.height),
    at(matrix, rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = corners.map((point) => point.x / EMU);
  const ys = corners.map((point) => point.y / EMU);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const region = sourcePictureRegion({ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }, ctx);
  return region
    ? [{ id: ctx.id(), kind: 'image', fit: 'stretch', mediaId: RETAINED_SLIDE_PICTURE, ...region }]
    : [];
}

function gridStops(items: XmlNode[], key: string, length: number): number[] | null {
  const sizes = items.map((item) => number(attr(item, key), 0));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!sizes.length || sizes.some((size) => !(size > 0)) || !Number.isFinite(total)) return null;
  const stops = [0];
  let sum = 0;
  for (const size of sizes) {
    sum += size;
    stops.push((sum * length) / total);
  }
  return stops;
}

function tableTextNode(cell: XmlNode, props: Node): XmlNode {
  const body = child(cell, 'txBody') ?? { name: 'a:txBody', attrs: {}, children: [], text: '' };
  const bodyPr = child(body, 'bodyPr');
  const attrs = { ...bodyPr?.attrs };
  for (const [from, to] of [
    ['marL', 'lIns'],
    ['marR', 'rIns'],
    ['marT', 'tIns'],
    ['marB', 'bIns'],
    ['anchor', 'anchor'],
    ['vert', 'vert'],
  ] as const) {
    const value = attr(props, from);
    if (value !== undefined) attrs[to] = value;
  }
  const copy = {
    ...body,
    children: [
      { name: 'a:bodyPr', attrs, children: bodyPr?.children ?? [], text: '' },
      ...kids(body).filter((node) => node !== bodyPr),
    ],
  };
  return { ...cell, children: [copy] };
}

function cellSpan(cell: XmlNode, key: string, remaining: number): number {
  return Math.max(1, Math.min(remaining, Math.trunc(number(attr(cell, key), 1))));
}

async function tableObjects(
  table: XmlNode,
  part: Part,
  rect: Rect,
  matrix: Matrix,
  flipX: boolean,
  ctx: Context,
): Promise<SlideElement[] | null> {
  const grid = kids(child(table, 'tblGrid'), 'gridCol');
  const rows = kids(table, 'tr');
  if (grid.length * rows.length > MAX_ELEMENTS / 2) return null;
  const columns = gridStops(grid, 'w', rect.width);
  const heights = gridStops(rows, 'h', rect.height);
  if (!columns || !heights) return null;
  const groupId = ctx.id();
  const elements: SlideElement[] = [];
  const borders: SlideElement[] = [];
  for (const [row, rowNode] of rows.entries()) {
    const cells = kids(rowNode, 'tc');
    const complete = cells.length === grid.length;
    let column = 0;
    for (const cell of cells) {
      if (flag(attr(cell, 'hMerge')) || flag(attr(cell, 'vMerge'))) {
        column++;
        continue;
      }
      const rowSpan = cellSpan(cell, 'rowSpan', rows.length - row);
      const columnSpan = cellSpan(cell, 'gridSpan', grid.length - column);
      const x = columns[column],
        y = heights[row];
      const right = columns[column + columnSpan],
        bottom = heights[row + rowSpan];
      if (x === undefined || y === undefined || right === undefined || bottom === undefined) return null;
      const box = { x: rect.x + x, y: rect.y + y, width: right - x, height: bottom - y };
      const place = placed(box, matrix, flipX, ctx);
      if (!place) return null;
      const props = child(cell, 'tcPr');
      const paint = await shapePaintOf([{ props, part }], ctx, null);
      if (paint.picture)
        elements.push({ id: ctx.id(), kind: 'image', groupId, ...place, ...paint.picture, fit: 'stretch' });
      if (paint.color || paint.gradient) {
        elements.push({
          id: ctx.id(),
          kind: 'shape',
          groupId,
          ...place,
          fill: paint.color,
          cornerRadius: 0,
          opacity: 1,
          ...(paint.gradient ? { gradient: paint.gradient } : {}),
        });
      }
      const node = tableTextNode(cell, props);
      const text = textElement(node, [node], box, matrix, flipX, ctx, true);
      if (!text) return null;
      elements.push({ ...text, groupId, tableCell: { row, column, rowSpan, columnSpan } });
      const edges = [
        ['lnL', { ...box, width: 0 }],
        ['lnR', { ...box, x: box.x + box.width, width: 0 }],
        ['lnT', { ...box, height: 0 }],
        ['lnB', { ...box, y: box.y + box.height, height: 0 }],
      ] as const;
      for (const [name, edge] of edges) {
        const outline = lineOutline(child(props, name), ctx);
        if (outline) {
          borders.push({
            id: ctx.id(),
            kind: 'shape',
            shape: 'line',
            groupId,
            ...linePlacement(edge, matrix),
            fill: null,
            cornerRadius: 0,
            opacity: 1,
            outline,
          });
        }
      }
      if (elements.length + borders.length > MAX_ELEMENTS) return null;
      column += complete ? 1 : columnSpan;
    }
  }
  // Draw the edges over both cells' fills at a shared boundary.
  return [...elements, ...borders];
}

function unsupported(node: XmlNode, ctx: Context): void {
  if (
    descendants(node, 'effectLst').some((n) => n.children.length > 0) ||
    descendants(node, 'effectDag').length > 0
  )
    ctx.issues.add('Source shadows, glows and other drawing effects are not reproduced.');
  if (descendants(node, 'hlinkClick').length > 0 || descendants(node, 'hlinkMouseOver').length > 0)
    ctx.issues.add('Hyperlinks keep their displayed words but do not run their source actions.');
  if (descendants(node, 'custGeom').length > 0)
    ctx.issues.add('A custom shape outline cannot be reproduced exactly.');
  if (descendants(node, 'avLst').some((n) => n.children.length > 0))
    ctx.issues.add('Adjusted source shapes use Drashti’s own shape proportions.');
  if (
    descendants(node, 'rPr').some(
      (n) =>
        number(attr(n, 'baseline'), 0) !== 0 ||
        number(attr(n, 'spc'), 0) !== 0 ||
        (attr(n, 'cap') && attr(n, 'cap') !== 'none'),
    )
  )
    ctx.issues.add('Source character offsets, spacing or capitalization effects are not reproduced.');
  if (
    descendants(node, 'spcBef').length > 0 ||
    descendants(node, 'spcAft').length > 0 ||
    descendants(node, 'spcPts').length > 0
  )
    ctx.issues.add('Absolute source paragraph spacing may differ in the editable copy.');
  if (
    [...descendants(node, 'headEnd'), ...descendants(node, 'tailEnd')].some(
      (n) => attr(n, 'type') !== undefined && attr(n, 'type') !== 'none',
    )
  )
    ctx.issues.add('Source connector arrowheads are not reproduced on editable lines.');
}
async function objectOf(
  node: XmlNode,
  part: Part,
  parent: Matrix,
  parentFlip: boolean,
  ctx: Context,
): Promise<SlideElement[]> {
  const sources = chainOf(node, part, ctx);
  const chain = sources.map((source) => source.node);
  const paints = sources.map((source) => ({ props: child(source.node, 'spPr'), part: source.part }));
  const props = paints.map((source) => source.props);
  const kind = nameOf(node);
  const xfrm = kind === 'graphicFrame' ? child(node, 'xfrm') : lastChild(props, 'xfrm'),
    rect = rawRect(xfrm);
  if (!rect) {
    ctx.issues.add(
      kind === 'graphicFrame'
        ? 'A table, chart or embedded drawing has no usable bounds in the source.'
        : 'An object has no size or place Drashti can use, so it was left out.',
    );
    return [];
  }
  const own = about(rect.x + rect.width / 2, rect.y + rect.height / 2, turning(xfrm));
  const matrix = multiply(parent, own),
    flipX = parentFlip !== flag(attr(xfrm, 'flipH'));
  const placement = placed(rect, matrix, flipX, ctx);
  if (!placement) return fallbackPicture(rect, matrix, ctx);
  unsupported(node, ctx);
  if (kind === 'graphicFrame') {
    const data = child(child(node, 'graphic'), 'graphicData');
    const table = child(data, 'tbl');
    if (table) {
      const cells = await tableObjects(table, part, rect, matrix, flipX, ctx);
      if (cells?.length) return cells;
    }
    const preview = descendants(data, 'pic')[0];
    if (preview) {
      const picture = await pictureOf(child(preview, 'blipFill'), part, ctx);
      if (picture) return [{ id: ctx.id(), kind: 'image', ...placement, ...picture, fit: 'stretch' }];
    }
    ctx.issues.add(
      'An unsupported table, chart or drawing stays as a picture when its slide picture is available.',
    );
    return fallbackPicture(rect, matrix, ctx);
  }
  const preset = attr(lastChild(props, 'prstGeom'), 'prst') ?? (kind === 'cxnSp' ? 'line' : undefined);
  const shape = preset ? SHAPES[preset] : undefined;
  const radius = preset === 'roundRect' ? Math.min(placement.frame.width, placement.frame.height) * 0.15 : 0;
  if (kind === 'pic') {
    const blipFill = child(node, 'blipFill');
    const picture = await pictureOf(blipFill, part, ctx);
    if (!picture) {
      const rel = part.rels.get(attr(child(blipFill, 'blip'), 'r:embed') ?? '');
      return rel?.target && !rel.external && rel.type.endsWith('/image')
        ? fallbackPicture(rect, matrix, ctx)
        : [];
    }
    return [
      {
        id: ctx.id(),
        kind: 'image',
        ...placement,
        ...picture,
        fit: 'stretch',
        ...pictureClip(shape, radius),
      },
    ];
  }
  if ((preset && !shape) || lastChild(props, 'custGeom')) {
    ctx.issues.add('An unsupported shape stays as a picture when its slide picture is available.');
    return fallbackPicture(rect, matrix, ctx);
  }
  const output: SlideElement[] = [];
  const paint = await shapePaintOf(paints, ctx, referenceColor(chain, 'fillRef', ctx));
  const outline = lineOutline(lastChild(props, 'ln'), ctx);
  if (paint.picture) {
    output.push({
      id: ctx.id(),
      kind: 'image',
      ...placement,
      ...paint.picture,
      fit: 'stretch',
      ...pictureClip(shape, radius),
    });
  }
  const fill = paint.color;
  if (fill || outline || shape === 'line') {
    const place = shape === 'line' ? linePlacement(rect, matrix) : placement;
    output.push({
      id: ctx.id(),
      kind: 'shape',
      ...place,
      shape: shape ?? 'rectangle',
      fill: shape === 'line' ? null : fill,
      ...(paint.gradient ? { gradient: paint.gradient } : {}),
      opacity: 1,
      cornerRadius: radius,
      outline: outline ?? (shape === 'line' ? { color: fill ?? '#000000', width: 1 } : null),
    });
  }
  const text = textElement(node, chain, rect, matrix, flipX, ctx);
  if (text) output.push(text);
  return output;
}
function nonVisualProperties(node: XmlNode): Node {
  const wrapper = kids(node).find((part) => nameOf(part).startsWith('nv'));
  return child(wrapper, 'cNvPr');
}

function drawingId(properties: Node): string | undefined {
  const id = attr(properties, 'id')?.trim();
  return id && /^\d{1,10}$/u.test(id) ? id : undefined;
}

interface WalkGroup {
  id: string;
  sourceIds: string[];
  hidden: boolean;
}

async function walk(
  tree: Node,
  part: Part,
  parent: Matrix,
  flip: boolean,
  ctx: Context,
  inherited = false,
  group?: WalkGroup,
): Promise<SlideElement[]> {
  const result: SlideElement[] = [];
  for (const node of kids(tree)) {
    const kind = nameOf(node);
    if (inherited && placeholder(node)) continue;
    // Layout and master parts have their own ID spaces. Slide timing addresses this slide's tree.
    const properties = nonVisualProperties(node);
    const sourceShapeId = inherited ? undefined : drawingId(properties);
    const hidden = group?.hidden === true || flag(attr(properties, 'hidden'));
    if (kind === 'grpSp') {
      const xfrm = child(child(node, 'grpSpPr'), 'xfrm'),
        rect = rawRect(xfrm);
      const off = child(xfrm, 'chOff'),
        ext = child(xfrm, 'chExt');
      const cx = number(attr(ext, 'cx'), 0),
        cy = number(attr(ext, 'cy'), 0);
      if (!rect || cx <= 0 || cy <= 0) {
        ctx.issues.add('A group with no usable size or place was left out.');
        continue;
      }
      const base = multiply(
        translate(rect.x, rect.y),
        multiply(
          [rect.width / cx, 0, 0, rect.height / cy, 0, 0],
          translate(-number(attr(off, 'x'), 0), -number(attr(off, 'y'), 0)),
        ),
      );
      const m = multiply(
        parent,
        multiply(about(rect.x + rect.width / 2, rect.y + rect.height / 2, turning(xfrm)), base),
      );
      if (Math.abs(rect.width / cx - rect.height / cy) > 0.00001)
        ctx.issues.add('Non-uniform group scaling may change editable text spacing.');
      result.push(
        ...(await walk(node, part, m, flip !== flag(attr(xfrm, 'flipH')), ctx, inherited, {
          id: group?.id ?? ctx.id(),
          sourceIds: sourceShapeId ? [...(group?.sourceIds ?? []), sourceShapeId] : (group?.sourceIds ?? []),
          hidden,
        })),
      );
    } else if (kind === 'sp' || kind === 'pic' || kind === 'cxnSp' || kind === 'graphicFrame') {
      let objects: SlideElement[];
      try {
        objects = await objectOf(node, part, parent, flip, ctx);
      } catch {
        const xfrm = kind === 'graphicFrame' ? child(node, 'xfrm') : child(child(node, 'spPr'), 'xfrm');
        const rect = rawRect(xfrm);
        ctx.issues.add('A damaged source object stays as a picture when its slide picture is available.');
        objects = rect
          ? fallbackPicture(
              rect,
              multiply(parent, about(rect.x + rect.width / 2, rect.y + rect.height / 2, turning(xfrm))),
              ctx,
            )
          : [];
      }
      const name = cutText(attr(properties, 'name')?.trim() ?? '', 200);
      result.push(
        ...objects.map((el) => ({
          ...el,
          ...(group && !el.groupId ? { groupId: group.id } : {}),
          ...(name ? { name } : {}),
          ...(hidden ? { hidden } : {}),
          ...(sourceShapeId ? { sourceShapeId } : {}),
          ...(group?.sourceIds.length ? { sourceGroupIds: group.sourceIds } : {}),
        })),
      );
    } else if (kind === 'AlternateContent') {
      const choice = child(node, 'Choice');
      const fallback = child(node, 'Fallback');
      const original = kids(choice);
      const primary = original.length === 1 ? original[0] : undefined;
      const table = child(child(child(primary, 'graphic'), 'graphicData'), 'tbl');
      if (table || !fallback) {
        result.push(...(await walk(choice, part, parent, flip, ctx, inherited, group)));
      } else {
        ctx.issues.add('An alternate source drawing keeps its embedded preview.');
        const objects = await walk(fallback, part, parent, flip, ctx, inherited, group);
        const choiceProps = primary && kids(fallback).length === 1 ? nonVisualProperties(primary) : undefined;
        const id = inherited ? undefined : drawingId(choiceProps);
        const name = cutText(attr(choiceProps, 'name')?.trim() ?? '', 200);
        const hidden = attr(choiceProps, 'hidden');
        result.push(
          ...objects.map((element) => ({
            ...element,
            ...(id ? { sourceShapeId: id } : {}),
            ...(name ? { name } : {}),
            ...(hidden !== undefined ? { hidden: group?.hidden === true || flag(hidden) } : {}),
          })),
        );
      }
    } else if (!['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(kind)) {
      ctx.issues.add('Tables, charts and embedded objects are not reproduced in this editable slide.');
    }
    if (result.length > MAX_ELEMENTS)
      throw new Error(
        'A source slide exceeds the 500 editable-object limit; objects were not silently dropped.',
      );
  }
  return result;
}

function imageExtension(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Read source objects without changing its bytes or invoking a presentation app. */
export async function readEditablePptx(file: string, outDir: string): Promise<EditablePptx> {
  if ((await stat(file)).size > 1024 ** 3)
    throw new Error('This presentation is too large to prepare safely.');
  const entries = await listZip(file),
    names = new Set<string>();
  for (const entry of entries) {
    if (
      entry.name.includes('\\') ||
      entry.name.startsWith('/') ||
      entry.name.split('/').includes('..') ||
      /^[a-z]:/iu.test(entry.name) ||
      names.has(entry.name) ||
      (entry.unixMode !== null && (entry.unixMode & 0o170000) === 0o120000)
    )
      throw new Error('This presentation contains an unsafe or duplicate archive part.');
    names.add(entry.name);
  }
  const selected = entries.filter(
    (entry) =>
      entry.name.startsWith('ppt/') &&
      /\.(xml|rels)$/u.test(entry.name) &&
      !/^ppt\/(?:charts|diagrams|embeddings)\//u.test(entry.name),
  );
  if (
    selected.some((entry) => entry.size > MAX_XML || entry.compressedSize > MAX_XML) ||
    selected.reduce((sum, entry) => sum + entry.size, 0) > MAX_XML_TOTAL
  )
    throw new Error('This presentation has too much XML to prepare safely.');
  const buffers = await readParts(file, selected, MAX_XML, MAX_XML_TOTAL);
  const roots = new Map<string, XmlNode>();
  for (const [path, bytes] of buffers) {
    try {
      roots.set(path, xml(bytes));
    } catch (error) {
      if (
        !(error instanceof XmlError) ||
        path === 'ppt/presentation.xml' ||
        path === 'ppt/_rels/presentation.xml.rels'
      )
        throw error;
    }
  }
  const presentation = makePart('ppt/presentation.xml', roots);
  if (!presentation || nameOf(presentation.root) !== 'presentation')
    throw new Error('This is not a readable PPTX presentation.');
  const size = child(presentation.root, 'sldSz');
  const width = number(attr(size, 'cx'), NaN) / EMU,
    height = number(attr(size, 'cy'), NaN) / EMU;
  if (!(width > 0 && height > 0 && width <= 16_384 && height <= 16_384))
    throw new Error('The source slide dimensions are outside the editable size range.');
  const ids = kids(child(presentation.root, 'sldIdLst'), 'sldId');
  if (ids.length === 0 || ids.length > 2000)
    throw new Error('A presentation must have between 1 and 2000 editable slides.');
  const pictureParts = new Set<string>();
  for (const path of roots.keys()) {
    if (!path.endsWith('.xml')) continue;
    for (const rel of makePart(path, roots)?.rels.values() ?? [])
      if (!rel.external && rel.target && rel.type.endsWith('/image')) pictureParts.add(rel.target);
  }
  const selectedImages = entries.filter(
    (entry) => pictureParts.has(entry.name) && entry.size <= MAX_IMAGE && entry.compressedSize <= MAX_IMAGE,
  );
  if (selectedImages.reduce((sum, entry) => sum + entry.size, 0) > MAX_IMAGE_TOTAL)
    throw new Error('The embedded pictures exceed the editable memory limit.');
  const pictures = await readParts(file, selectedImages, MAX_IMAGE, MAX_IMAGE_TOTAL);
  const media: ParsedMediaRef[] = [],
    saved = new Map<string, string>();
  let assetDir: string | null = null;
  const asset: Context['asset'] = async (part, id, issues) => {
    const rel = part.rels.get(id);
    if (!rel || rel.external) {
      issues.add('A linked or external picture was not opened.');
      return null;
    }
    if (!rel.target) {
      issues.add('A picture relationship points outside the safe archive parts.');
      return null;
    }
    if (!rel.type.endsWith('/image')) {
      issues.add('An embedded object is not a supported picture.');
      return null;
    }
    const previous = saved.get(rel.target);
    if (previous) return previous;
    const bytes = pictures.get(rel.target),
      extension = bytes ? imageExtension(bytes) : null;
    if (!bytes || !extension) {
      issues.add('An embedded picture is missing, too large or outside the supported PNG/JPEG/WebP formats.');
      return null;
    }
    if (assetDir === null) {
      await mkdir(outDir, { recursive: true });
      assetDir = await mkdtemp(join(outDir, 'pptx-native-'));
    }
    const originalPath = join(assetDir, `picture-${String(media.length)}.${extension}`);
    await writeFile(originalPath, bytes, { flag: 'wx', mode: 0o600 });
    const ref = mediaRef(media.length);
    media.push({ originalPath, kind: 'image' });
    saved.set(rel.target, ref);
    return ref;
  };
  const slides: EditablePptxSlide[] = [];
  for (const [sourceIndex, id] of ids.entries()) {
    const rel = presentation.rels.get(attr(id, 'r:id') ?? '');
    const slide =
      rel?.target && rel.type.endsWith('/slide') && !rel.external ? makePart(rel.target, roots) : undefined;
    if (!slide || nameOf(slide.root) !== 'sld') continue;
    const layout = related(slide, 'slideLayout', roots),
      master = related(layout, 'slideMaster', roots);
    const theme = related(master, 'theme', roots),
      issues = new Set<string>();
    if (
      (!layout && [...slide.rels.values()].some((r) => r.type.endsWith('/slideLayout'))) ||
      (!master && [...(layout?.rels.values() ?? [])].some((r) => r.type.endsWith('/slideMaster')))
    )
      issues.add('A source layout or master is missing or unsafe; some inherited content may differ.');
    let nextId = 0;
    const ctx: Context = {
      width,
      height,
      theme: themeOf(theme, master, layout, slide),
      master,
      layout,
      defaults: child(presentation.root, 'defaultTextStyle'),
      issues,
      id: () => `pptx-${String(sourceIndex)}-${String(++nextId)}`,
      asset,
    };
    const backgrounds = [master, layout, slide].flatMap((part) => {
      const bg = child(child(part?.root, 'cSld'), 'bg');
      return part && bg ? [{ part, bg }] : [];
    });
    const paint = await shapePaintOf(
      backgrounds.map(({ part, bg }) => ({ part, props: child(bg, 'bgPr') })),
      ctx,
      ctx.theme.colors[ctx.theme.map['bg1'] ?? 'lt1'] ?? '#ffffff',
    );
    let background = paint.color;
    const ref = child(backgrounds.at(-1)?.bg, 'bgRef');
    if (ref) {
      background = colorOf(ref, ctx) ?? background;
      ctx.issues.add('A theme background style uses its reference colour in the editable copy.');
    }
    const frame = { x: 0, y: 0, width, height };
    const elements: SlideElement[] = [];
    if (!ref && paint.picture) {
      elements.push({
        id: ctx.id(),
        kind: 'image',
        name: 'Background picture',
        frame,
        ...paint.picture,
        fit: 'stretch',
      });
    } else if (!ref && paint.gradient) {
      const backdrop: ShapeElement = {
        id: ctx.id(),
        kind: 'shape',
        name: 'Background gradient',
        frame,
        fill: paint.color,
        gradient: paint.gradient,
        opacity: 1,
        cornerRadius: 0,
      };
      elements.push(backdrop);
    }
    if (
      master &&
      !['0', 'false'].includes(attr(slide.root, 'showMasterSp') ?? '') &&
      !['0', 'false'].includes(attr(layout?.root, 'showMasterSp') ?? '')
    )
      elements.push(
        ...(await walk(child(child(master.root, 'cSld'), 'spTree'), master, IDENTITY, false, ctx, true)),
      );
    if (layout)
      elements.push(
        ...(await walk(child(child(layout.root, 'cSld'), 'spTree'), layout, IDENTITY, false, ctx, true)),
      );
    elements.push(...(await walk(child(child(slide.root, 'cSld'), 'spTree'), slide, IDENTITY, false, ctx)));
    if (elements.length > MAX_ELEMENTS)
      throw new Error(
        'A source slide exceeds the 500 editable-object limit; objects were not silently dropped.',
      );
    slides.push({
      sourceIndex,
      hidden: ['0', 'false'].includes(attr(slide.root, 'show') ?? ''),
      background,
      elements,
      issues: [...issues],
    });
  }
  if (slides.length === 0) throw new Error('No source slide could be read safely.');
  return { sourceCount: ids.length, width, height, slides, media };
}
