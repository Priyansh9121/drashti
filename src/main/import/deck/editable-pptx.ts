import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { Lang, Outline, Rect, ShapeKind, SlideElement, TextRun, TextStyle } from '../../../shared/model';
import { detectLang, langOfLine } from '../../../shared/text-runs';
import { cutText } from '../../../shared/text';
import { mediaRef, type ParsedMediaRef } from '../model';
import { parseXml, type XmlNode } from '../xml';
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
  width: number;
  height: number;
  slides: EditablePptxSlide[];
  media: ParsedMediaRef[];
}

const EMU = 9525;
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
    if (rels.has(id)) throw new Error('This presentation contains duplicate relationship identifiers.');
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
function chainOf(node: XmlNode, ctx: Context): XmlNode[] {
  const ph = placeholder(node);
  if (!ph) return [node];
  const layout = matching(ctx.layout?.root, ph);
  const master = matching(ctx.master?.root, placeholder(layout) ?? ph);
  return [master, layout, node].filter((n): n is XmlNode => n !== undefined);
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
      return [child(list, 'defPPr'), child(list, levelName), child(kids(body, 'p')[0], 'pPr')];
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
  if (font)
    ctx.issues.add('Named fonts use Drashti’s bundled fallbacks where unavailable; text spacing may differ.');
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
function textElement(
  node: XmlNode,
  chain: XmlNode[],
  rect: Rect,
  matrix: Matrix,
  flipX: boolean,
  ctx: Context,
): SlideElement | null {
  const body = child(node, 'txBody');
  if (!body) return null;
  const paragraphs = kids(body, 'p'),
    runs: TextRun[] = [];
  let align: TextStyle['align'] = 'left',
    lineHeight = 1.2;
  const scale = Math.hypot(matrix[2], matrix[3]);
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
    const value = lowToHighValue(nodes, 'algn');
    const here = value === 'ctr' ? 'center' : value === 'r' ? 'right' : 'left';
    if (index === 0) {
      align = here;
      const spacing = child(lastChild(nodes, 'lnSpc'), 'spcPct');
      if (spacing) lineHeight = Math.max(0.1, Math.min(5, number(attr(spacing, 'val'), 100_000) / 100_000));
    } else if (here !== align)
      ctx.issues.add(
        'Different paragraph alignments share the first paragraph’s alignment in this text box.',
      );
    if (value && !['l', 'ctr', 'r'].includes(value))
      ctx.issues.add('Justified paragraphs use left alignment in the editable copy.');
    if (index > 0) runs.push(runOf('\n', defaults, ctx, scale, fallback));
    for (const piece of kids(paragraph)) {
      const kind = nameOf(piece);
      if (kind === 'br') runs.push(runOf('\n', [...defaults, child(piece, 'rPr')], ctx, scale, fallback));
      else if (kind === 'r' || kind === 'fld') {
        if (kind === 'fld') ctx.issues.add('Dynamic fields are kept as their current words.');
        const words = child(piece, 't')?.text ?? '';
        if (words !== '') runs.push(runOf(words, [...defaults, child(piece, 'rPr')], ctx, scale, fallback));
      }
    }
    const bullet = lastChild(nodes, 'buChar'),
      automatic = lastChild(nodes, 'buAutoNum');
    if ((bullet || automatic) && !lastChild(nodes, 'buNone'))
      ctx.issues.add('Source list marks and paragraph indentation may differ in the editable copy.');
  }
  const words = runs.map((run) => run.text).join('');
  if (words === '') return null;
  if (words.length > 20_000 || runs.length > 2000)
    throw new Error('A source text box exceeds the editable text limit; its words were not truncated.');
  const first = runs.find((r) => r.text.trim() !== '') ?? runs[0];
  const bodies = chain.map((shape) => child(child(shape, 'txBody'), 'bodyPr'));
  const inset = (key: string, fallback: number) => Math.max(0, number(lowToHighValue(bodies, key), fallback));
  const left = inset('lIns', 91_440),
    right = inset('rIns', 91_440),
    top = inset('tIns', 45_720),
    bottom = inset('bIns', 45_720);
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
  if (lowToHighValue(bodies, 'vert') && lowToHighValue(bodies, 'vert') !== 'horz')
    ctx.issues.add('Vertical text is laid out horizontally in the editable copy.');
  if (lastChild(bodies, 'normAutofit') || lastChild(bodies, 'spAutoFit'))
    ctx.issues.add('Source auto-fit and wrapping may differ in the editable copy.');
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
      lineHeight,
      shadow: false,
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
function outlineOf(props: Node[], ctx: Context): Outline | null {
  const line = lastChild(props, 'ln');
  if (!line || child(line, 'noFill')) return null;
  const color = fillOf([line], ctx, '#000000');
  return color ? { color, width: Math.max(0.01, Math.min(100, number(attr(line, 'w'), EMU) / EMU)) } : null;
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
  const chain = chainOf(node, ctx),
    props = chain.map((s) => child(s, 'spPr'));
  const xfrm = lastChild(props, 'xfrm'),
    rect = rawRect(xfrm);
  if (!rect) {
    ctx.issues.add('An object has no size or place Drashti can use, so it was left out.');
    return [];
  }
  const own = about(rect.x + rect.width / 2, rect.y + rect.height / 2, turning(xfrm));
  const matrix = multiply(parent, own),
    flipX = parentFlip !== flag(attr(xfrm, 'flipH'));
  const placement = placed(rect, matrix, flipX, ctx);
  if (!placement) return [];
  unsupported(node, ctx);
  if (nameOf(node) === 'pic') {
    const blipFill = child(node, 'blipFill'),
      blip = child(blipFill, 'blip');
    const embed = attr(blip, 'r:embed');
    if (attr(blip, 'r:link'))
      ctx.issues.add('Linked pictures are not opened; only an embedded copy can be used.');
    if (!embed) {
      ctx.issues.add('A linked or missing picture has no embedded copy.');
      return [];
    }
    const mediaId = await ctx.asset(part, embed, ctx.issues);
    if (!mediaId) return [];
    const crop = child(blipFill, 'srcRect');
    const l = number(attr(crop, 'l'), 0) / 100_000,
      t = number(attr(crop, 't'), 0) / 100_000;
    const r = number(attr(crop, 'r'), 0) / 100_000,
      b = number(attr(crop, 'b'), 0) / 100_000;
    const valid = l >= 0 && t >= 0 && r >= 0 && b >= 0 && l + r < 1 && t + b < 1;
    if (!valid) ctx.issues.add('A picture crop outside the editable range was left out.');
    if (child(blipFill, 'tile')) ctx.issues.add('A tiled picture is stretched once in the editable copy.');
    const preset = attr(lastChild(props, 'prstGeom'), 'prst');
    if (preset && preset !== 'rect') ctx.issues.add('A picture’s shape clipping is not reproduced.');
    return [
      {
        id: ctx.id(),
        kind: 'image',
        ...placement,
        mediaId,
        fit: 'stretch',
        ...(crop && valid ? { crop: { x: l, y: t, width: 1 - l - r, height: 1 - t - b } } : {}),
      },
    ];
  }
  const output: SlideElement[] = [];
  const preset =
    attr(lastChild(props, 'prstGeom'), 'prst') ?? (nameOf(node) === 'cxnSp' ? 'line' : undefined);
  const shape = preset ? SHAPES[preset] : undefined;
  if (preset && !shape) ctx.issues.add('An unsupported source shape uses a rectangular editable frame.');
  if (preset === 'roundRect') ctx.issues.add('Rounded rectangles use Drashti’s own corner proportions.');
  const fill = fillOf(props, ctx, referenceColor(chain, 'fillRef', ctx));
  const outline = outlineOf(props, ctx);
  if (fill || outline || shape === 'line') {
    let place = placement;
    if (shape === 'line') {
      const a = at(matrix, rect.x, rect.y),
        b = at(matrix, rect.x + rect.width, rect.y + rect.height);
      const width = Math.hypot(b.x - a.x, b.y - a.y) / EMU;
      place = {
        frame: {
          x: round((a.x + b.x) / 2 / EMU - width / 2),
          y: round((a.y + b.y) / 2 / EMU - 0.5),
          width: Math.max(0.01, round(width)),
          height: 1,
        },
        rotation: round(((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360),
      };
    }
    output.push({
      id: ctx.id(),
      kind: 'shape',
      ...place,
      shape: shape ?? 'rectangle',
      fill: shape === 'line' ? null : fill,
      opacity: 1,
      cornerRadius: preset === 'roundRect' ? Math.min(place.frame.width, place.frame.height) * 0.15 : 0,
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

function drawingId(node: XmlNode): string | undefined {
  const id = attr(nonVisualProperties(node), 'id')?.trim();
  return id && /^\d{1,10}$/u.test(id) ? id : undefined;
}

async function walk(
  tree: Node,
  part: Part,
  parent: Matrix,
  flip: boolean,
  ctx: Context,
  inherited = false,
  groupId?: string,
  sourceGroupIds: string[] = [],
): Promise<SlideElement[]> {
  const result: SlideElement[] = [];
  for (const node of kids(tree)) {
    const kind = nameOf(node);
    if (inherited && placeholder(node)) continue;
    // Layout and master parts have their own ID spaces. Slide timing addresses this slide's tree.
    const sourceShapeId = inherited ? undefined : drawingId(node);
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
        ...(await walk(
          node,
          part,
          m,
          flip !== flag(attr(xfrm, 'flipH')),
          ctx,
          inherited,
          groupId ?? ctx.id(),
          sourceShapeId ? [...sourceGroupIds, sourceShapeId] : sourceGroupIds,
        )),
      );
    } else if (kind === 'sp' || kind === 'pic' || kind === 'cxnSp') {
      const objects = await objectOf(node, part, parent, flip, ctx);
      result.push(
        ...objects.map((el) => ({
          ...el,
          ...(groupId ? { groupId } : {}),
          ...(sourceShapeId ? { sourceShapeId } : {}),
          ...(sourceGroupIds.length > 0 ? { sourceGroupIds } : {}),
        })),
      );
    } else if (kind === 'AlternateContent') {
      ctx.issues.add('Alternate drawing content uses its available fallback.');
      result.push(
        ...(await walk(
          child(node, 'Fallback') ?? child(node, 'Choice'),
          part,
          parent,
          flip,
          ctx,
          inherited,
          groupId,
          sourceGroupIds,
        )),
      );
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
    (entry) => entry.name.startsWith('ppt/') && /\.(xml|rels)$/u.test(entry.name),
  );
  if (
    selected.some((entry) => entry.size > MAX_XML || entry.compressedSize > MAX_XML) ||
    selected.reduce((sum, entry) => sum + entry.size, 0) > MAX_XML_TOTAL
  )
    throw new Error('This presentation has too much XML to prepare safely.');
  const buffers = await readParts(file, selected, MAX_XML, MAX_XML_TOTAL);
  const roots = new Map([...buffers].map(([path, bytes]) => [path, xml(bytes)]));
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
    if (!slide || nameOf(slide.root) !== 'sld')
      throw new Error('A source slide is missing or has an unsafe relationship.');
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
      theme: themeOf(theme, master, layout, slide),
      master,
      layout,
      defaults: child(presentation.root, 'defaultTextStyle'),
      issues,
      id: () => `pptx-${String(sourceIndex)}-${String(++nextId)}`,
      asset,
    };
    const backgrounds = [master?.root, layout?.root, slide.root].map((root) =>
      child(child(root, 'cSld'), 'bg'),
    );
    let background = fillOf(
      backgrounds.map((bg) => child(bg, 'bgPr')),
      ctx,
      ctx.theme.colors[ctx.theme.map['bg1'] ?? 'lt1'] ?? '#ffffff',
    );
    for (let i = backgrounds.length - 1; i >= 0; i--) {
      if (!backgrounds[i]) continue;
      const ref = child(backgrounds[i], 'bgRef');
      if (ref) {
        background = colorOf(ref, ctx) ?? background;
        issues.add('A theme background style uses its reference colour in the editable copy.');
      }
      break;
    }
    const elements: SlideElement[] = [];
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
  return { width, height, slides, media };
}
