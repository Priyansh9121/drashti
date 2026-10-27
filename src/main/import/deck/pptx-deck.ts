import type { XmlNode } from '../xml';

/*
 * What a PowerPoint slide does, read from its own XML (Session 54, C2, from C1's trial: assister/session-54-deck-
 * trial.md, "How to take the videos and sounds out of a .pptx"): its transition and the transition's sound, the
 * main sequence's click groups and how long each runs as PowerPoint plays it, and its videos and sounds with their
 * place, poster, trims, fades, volume, loop and when they start. ECMA-376 Part 1 §19.5 (timing) and [MS-PPTX]'s
 * p14 media. A deck's slides are shown as it was from this: the timed copy (./timed-copy.ts) chains the groups,
 * the cut (./cut.ts) finds them in the movie, and the deck's media become real media.
 *
 * Where a file holds both a newer form and its fallback (mc:AlternateContent), the newer one is read (p14's
 * transitions and their lengths), as PowerPoint 2010 and later read it.
 */

/** The deck's own transition into a slide. */
export interface PptxTransition {
  /** Its effect's name in the file (`p:fade`, `p:push`, `p14:vortex`, `p159:morph`), or '' for none (a cut). */
  name: string;
  durationMs: number;
  /** Its sound: a part of the deck (ppt/media/audio1.wav), and whether it loops until the next sound. */
  sound: { part: string; loop: boolean } | null;
  /** The deck's own "after N s" (advTm), or null. */
  advanceMs: number | null;
}

/** One group of the main sequence: what one click does (or what runs by itself as the slide comes in). */
export interface PptxGroup {
  /** It waits for a click; false for the first group when it starts with the slide. */
  byClick: boolean;
  /** How long it runs as PowerPoint plays it, its videos and sounds starting aside (ms). */
  lengthMs: number;
  /** It only starts videos or sounds: nothing in it moves. */
  mediaOnly: boolean;
  /** One turn of an effect in it that repeats until the slide ends (a spin), in ms; null for none. */
  repeatsMs: number | null;
  /** One turn of an effect in it that repeats until the next click (Session 54, C review), in ms; null for none. */
  untilClickMs: number | null;
}

/** When one of the slide's videos or sounds starts. */
export type PptxMediaStart =
  /** With a group of the main sequence (its index), this long after the group starts. */
  | { group: number; offsetMs: number }
  /** When its shape is clicked (a trigger), or by its own play button: never by Next. */
  | { clicked: true };

/** One of the slide's videos or sounds. */
export interface PptxMedia {
  kind: 'video' | 'audio';
  /** Its shape's id and name on the slide. */
  shapeId: string;
  name: string;
  /** Its file inside the deck (ppt/media/media1.mp4), or null when it is linked from outside it. */
  part: string | null;
  /** A linked file outside the deck: the path or file URL the deck names, or null. */
  link: string | null;
  /** Where it sits, as fractions of the slide's width and height. */
  box: { x: number; y: number; w: number; h: number };
  /** The picture shown before it plays (a part of the deck), or null. */
  poster: string | null;
  /** PowerPoint's trims: ms cut from its start, and ms cut from its END (p14:trim's `end`). */
  trim: { startMs: number; endMs: number } | null;
  fadeInMs: number;
  fadeOutMs: number;
  /** 0 to 1. */
  volume: number;
  muted: boolean;
  loop: boolean;
  start: PptxMediaStart;
  /** It plays on across this many slides (numSld), or null for its own. */
  acrossSlides: number | null;
  /** Hidden while it is not playing (showWhenStopped="0"). */
  hideWhenStopped: boolean;
}

export interface PptxDeckSlide {
  transition: PptxTransition | null;
  groups: PptxGroup[];
  media: PptxMedia[];
  /** Effects that run when a shape is clicked (a trigger's own sequence), videos' and sounds' starts aside. */
  triggers: number;
}

/** A relationship of the slide's: its type and target (a part's path, or a link's own text when External). */
export interface SlideRel {
  type: string;
  target: string;
  external: boolean;
}

/** The slide's size in EMU (presentation.xml's p:sldSz). */
export interface SlideSize {
  cx: number;
  cy: number;
}

// ---- walking the tree ------------------------------------------------------------------------------

/** Children, with mc:AlternateContent read as its first choice (its fallback left out). */
function kids(node: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  for (const c of node.children) {
    if (c.name === 'mc:AlternateContent') {
      const choice =
        c.children.find((x) => x.name === 'mc:Choice') ?? c.children.find((x) => x.name === 'mc:Fallback');
      if (choice) out.push(...kids(choice));
    } else out.push(c);
  }
  return out;
}

const kid = (node: XmlNode | undefined, name: string): XmlNode | undefined =>
  node ? kids(node).find((c) => c.name === name) : undefined;

/** No node: for a list that is not there. */
const NONE: XmlNode = { name: '', attrs: {}, children: [], text: '' };

function all(node: XmlNode, test: (n: XmlNode) => boolean, out: XmlNode[] = []): XmlNode[] {
  for (const c of kids(node)) {
    if (test(c)) out.push(c);
    all(c, test, out);
  }
  return out;
}

const num = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** A timing node's start delay (its first numeric `p:stCondLst/p:cond@delay`), 0 when none or "indefinite". */
function delayOf(cTn: XmlNode | undefined): number {
  for (const cond of kids(kid(cTn, 'p:stCondLst') ?? NONE))
    if (cond.name === 'p:cond') {
      const d = num(cond.attrs['delay']);
      if (d !== null) return Math.max(0, d);
    }
  return 0;
}

/** The cTn of a timing element: its own (p:par, p:seq) or its behaviour's (p:set, p:anim..., p:cmd). */
function cTnOf(node: XmlNode): XmlNode | undefined {
  return kid(node, 'p:cTn') ?? kid(kid(node, 'p:cBhvr'), 'p:cTn') ?? kid(kid(node, 'p:cMediaNode'), 'p:cTn');
}

/** An effect that starts a video or sound (its preset class is "mediacall"). */
const isMediaCall = (par: XmlNode) => kid(par, 'p:cTn')?.attrs['presetClass'] === 'mediacall';

/**
 * How long a timing node runs once started, its own delay aside (ms): its own `dur`, or its children's longest
 * (one after another in a p:seq), times its repeats and twice over when it plays back (`autoRev`). An endless
 * repeat counts one turn. Videos' and sounds' starts count nothing when `skipMedia` (the timed copy has none).
 */
function runLength(node: XmlNode, skipMedia: boolean): number {
  const cTn = cTnOf(node);
  if (!cTn) return 0;
  const repeat = cTn.attrs['repeatCount'];
  const times = repeat === undefined || repeat === 'indefinite' ? 1 : (num(repeat) ?? 1000) / 1000;
  const back = cTn.attrs['autoRev'] === '1' || cTn.attrs['autoRev'] === 'true' ? 2 : 1;
  const own = num(cTn.attrs['dur']);
  let base = 0;
  if (own !== null) base = own;
  else {
    const list = kid(cTn, 'p:childTnLst');
    const children = list
      ? kids(list).filter((c) => !(skipMedia && c.name === 'p:par' && isMediaCall(c)))
      : [];
    for (const c of children) {
      const span = delayOf(cTnOf(c)) + runLength(c, skipMedia);
      base = node.name === 'p:seq' ? base + span : Math.max(base, span);
    }
  }
  return Math.max(0, base * times * back);
}

/** Every effect (a p:par with a preset class) in a group, with when it starts within the group (ms). */
function effectsOf(group: XmlNode): { par: XmlNode; atMs: number }[] {
  const out: { par: XmlNode; atMs: number }[] = [];
  const visit = (par: XmlNode, at: number) => {
    const cTn = kid(par, 'p:cTn');
    if (!cTn) return;
    const start = at + delayOf(cTn);
    if (cTn.attrs['presetClass'] !== undefined) {
      out.push({ par, atMs: start });
      return;
    }
    for (const c of kids(kid(cTn, 'p:childTnLst') ?? NONE)) if (c.name === 'p:par') visit(c, start);
  };
  // The group's own delay is its click ("indefinite"): its sub-groups' delays count from the click.
  for (const c of kids(kid(kid(group, 'p:cTn'), 'p:childTnLst') ?? NONE)) if (c.name === 'p:par') visit(c, 0);
  return out;
}

/** The shape an effect works on (its behaviours' first target). */
function targetOf(par: XmlNode): string | null {
  const tgt = all(par, (n) => n.name === 'p:spTgt')[0];
  return tgt?.attrs['spid'] ?? null;
}

/** Whether a group waits for a click: every group does but a first one that begins with the slide. */
function waitsForClick(group: XmlNode): boolean {
  const conds = kids(kid(kid(group, 'p:cTn'), 'p:stCondLst') ?? NONE);
  if (conds.some((c) => c.attrs['evt'] === 'onBegin')) return false;
  return conds.some((c) => c.attrs['delay'] === 'indefinite');
}

/** The main sequence's groups (each a p:par of its cTn's childTnLst), in order. */
export function mainGroups(timing: XmlNode | undefined): XmlNode[] {
  if (!timing) return [];
  const main = all(timing, (n) => n.name === 'p:cTn' && n.attrs['nodeType'] === 'mainSeq')[0];
  const list = kid(main, 'p:childTnLst');
  return list ? kids(list).filter((c) => c.name === 'p:par') : [];
}

// ---- the transition ---------------------------------------------------------------------------------

/** PowerPoint's own lengths for a transition's speed (ECMA-376 §19.7.66: fast is the default). */
const SPEED_MS: Record<string, number> = { fast: 500, med: 750, slow: 1000 };

function readTransition(sld: XmlNode, rels: ReadonlyMap<string, SlideRel>): PptxTransition | null {
  const t = kid(sld, 'p:transition');
  if (!t) return null;
  const effect = kids(t).find((c) => c.name !== 'p:sndAc' && c.name !== 'p:extLst');
  const p14 = num(t.attrs['p14:dur']) ?? num(t.attrs['dur']);
  const durationMs = effect ? Math.round(p14 ?? SPEED_MS[t.attrs['spd'] ?? 'fast'] ?? 500) : 0;
  const stSnd = kid(kid(t, 'p:sndAc'), 'p:stSnd');
  const snd = kid(stSnd, 'p:snd');
  const rel = snd ? rels.get(snd.attrs['r:embed'] ?? '') : undefined;
  return {
    name: effect?.name ?? '',
    durationMs,
    sound: rel && !rel.external ? { part: rel.target, loop: stSnd?.attrs['loop'] === '1' } : null,
    advanceMs: num(t.attrs['advTm']),
  };
}

// ---- the groups -------------------------------------------------------------------------------------

function readGroups(timing: XmlNode | undefined): PptxGroup[] {
  return mainGroups(timing).map((group) => {
    const effects = effectsOf(group);
    const seen = effects.filter((e) => !isMediaCall(e.par));
    // Its length as the timed copy plays it: each sub-group's start and its effects, videos and sounds aside.
    const lengthMs = Math.round(
      seen.reduce((longest, e) => Math.max(longest, e.atMs + runLength(e.par, true)), 0),
    );
    const endless = seen.filter((e) => kid(e.par, 'p:cTn')?.attrs['repeatCount'] === 'indefinite');
    // "Until Next Click": an endless repeat that ends at the next click (its end condition), not with the slide.
    const untilClick = (e: { par: XmlNode }) =>
      kids(kid(kid(e.par, 'p:cTn'), 'p:endCondLst') ?? NONE).some((c) => c.attrs['evt'] === 'onNext');
    const turnOf = (list: { par: XmlNode }[]) =>
      list.reduce((longest, e) => Math.max(longest, runLength(e.par, true)), 0);
    const toEnd = endless.filter((e) => !untilClick(e));
    const toClick = endless.filter(untilClick);
    return {
      byClick: waitsForClick(group),
      lengthMs,
      mediaOnly: seen.length === 0,
      repeatsMs: toEnd.length > 0 && turnOf(toEnd) > 0 ? Math.round(turnOf(toEnd)) : null,
      untilClickMs: toClick.length > 0 && turnOf(toClick) > 0 ? Math.round(turnOf(toClick)) : null,
    };
  });
}

// ---- the media --------------------------------------------------------------------------------------

/** A shape's place on the slide, in EMU, through the groups it sits in (their child coordinates). */
interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
}

function xfrmOf(spPr: XmlNode | undefined): Place | null {
  const xfrm = kid(spPr, 'a:xfrm');
  const off = kid(xfrm, 'a:off');
  const ext = kid(xfrm, 'a:ext');
  const x = num(off?.attrs['x']);
  const y = num(off?.attrs['y']);
  const w = num(ext?.attrs['cx']);
  const h = num(ext?.attrs['cy']);
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}

/** Every p:pic in the shape tree, with its place on the slide (a group's child coordinates mapped out). */
function pictures(tree: XmlNode): { pic: XmlNode; place: Place | null }[] {
  const out: { pic: XmlNode; place: Place | null }[] = [];
  const visit = (node: XmlNode, map: (p: Place) => Place) => {
    for (const c of kids(node)) {
      if (c.name === 'p:pic') {
        const own = xfrmOf(kid(c, 'p:spPr'));
        out.push({ pic: c, place: own ? map(own) : null });
      } else if (c.name === 'p:grpSp') {
        const xfrm = kid(kid(c, 'p:grpSpPr'), 'a:xfrm');
        const outer = xfrmOf(kid(c, 'p:grpSpPr'));
        const chOff = kid(xfrm, 'a:chOff');
        const chExt = kid(xfrm, 'a:chExt');
        const cx = num(chOff?.attrs['x']) ?? 0;
        const cy = num(chOff?.attrs['y']) ?? 0;
        const cw = num(chExt?.attrs['cx']) ?? outer?.w ?? 1;
        const ch = num(chExt?.attrs['cy']) ?? outer?.h ?? 1;
        const sx = outer && cw > 0 ? outer.w / cw : 1;
        const sy = outer && ch > 0 ? outer.h / ch : 1;
        const inner = (p: Place): Place =>
          map({
            x: (outer?.x ?? 0) + (p.x - cx) * sx,
            y: (outer?.y ?? 0) + (p.y - cy) * sy,
            w: p.w * sx,
            h: p.h * sy,
          });
        visit(c, inner);
      }
    }
  };
  visit(tree, (p) => p);
  return out;
}

/** The p:cMediaNode for a shape in the slide's timing (its volume, loop and the rest), if any. */
function mediaNodeFor(timing: XmlNode | undefined, shapeId: string): XmlNode | undefined {
  if (!timing) return undefined;
  return all(timing, (n) => n.name === 'p:cMediaNode').find(
    (node) => all(node, (n) => n.name === 'p:spTgt')[0]?.attrs['spid'] === shapeId,
  );
}

/** When a shape's video or sound starts: at an effect in the main sequence, by a trigger, or by its play button. */
function startOf(groups: readonly XmlNode[], shapeId: string): PptxMediaStart {
  for (const [g, group] of groups.entries()) {
    for (const e of effectsOf(group)) {
      if (!isMediaCall(e.par) || targetOf(e.par) !== shapeId) continue;
      const cmd = all(e.par, (n) => n.name === 'p:cmd')[0];
      const what = cmd?.attrs['cmd'] ?? '';
      // playFrom(…) starts it; a togglePause or stop in the sequence is no start.
      if (!what.startsWith('playFrom') && what !== 'play') continue;
      return { group: g, offsetMs: Math.round(e.atMs) };
    }
  }
  return { clicked: true };
}

function readMedia(
  sld: XmlNode,
  timing: XmlNode | undefined,
  rels: ReadonlyMap<string, SlideRel>,
  size: SlideSize,
): PptxMedia[] {
  const tree = kid(kid(sld, 'p:cSld'), 'p:spTree');
  if (!tree) return [];
  const groups = mainGroups(timing);
  const out: PptxMedia[] = [];
  for (const { pic, place } of pictures(tree)) {
    const nv = kid(pic, 'p:nvPicPr');
    const cNvPr = kid(nv, 'p:cNvPr');
    const nvPr = kid(nv, 'p:nvPr');
    const file = kid(nvPr, 'a:videoFile') ?? kid(nvPr, 'a:audioFile') ?? kid(nvPr, 'a:quickTimeFile');
    const p14 = nvPr ? all(nvPr, (n) => n.name === 'p14:media')[0] : undefined;
    if (!file && !p14) continue;
    const kind: PptxMedia['kind'] = file?.name === 'a:audioFile' ? 'audio' : 'video';
    // The embedded file (p14:media's r:embed) when there is one; else what a:videoFile links to.
    const embedded = p14 ? rels.get(p14.attrs['r:embed'] ?? '') : undefined;
    const linked = file ? rels.get(file.attrs['r:link'] ?? file.attrs['r:embed'] ?? '') : undefined;
    const rel = embedded && !embedded.external ? embedded : linked;
    if (!rel) continue;
    const shapeId = cNvPr?.attrs['id'] ?? '';
    const blip = kid(kid(pic, 'p:blipFill'), 'a:blip');
    const posterRel = blip ? rels.get(blip.attrs['r:embed'] ?? '') : undefined;
    const trim = kid(p14, 'p14:trim');
    const fade = kid(p14, 'p14:fade');
    const node = mediaNodeFor(timing, shapeId);
    const st = num(trim?.attrs['st']) ?? 0;
    const end = num(trim?.attrs['end']) ?? 0;
    const vol = num(node?.attrs['vol']);
    const numSld = num(node?.attrs['numSld']);
    const box = place ?? { x: 0, y: 0, w: size.cx, h: size.cy };
    out.push({
      kind,
      shapeId,
      name: cNvPr?.attrs['name'] ?? '',
      part: rel.external ? null : rel.target,
      link: rel.external ? rel.target : null,
      box: { x: box.x / size.cx, y: box.y / size.cy, w: box.w / size.cx, h: box.h / size.cy },
      poster: posterRel && !posterRel.external ? posterRel.target : null,
      trim: st > 0 || end > 0 ? { startMs: Math.round(st), endMs: Math.round(end) } : null,
      fadeInMs: Math.round(num(fade?.attrs['in']) ?? 0),
      fadeOutMs: Math.round(num(fade?.attrs['out']) ?? 0),
      // Thousandths of a percent (80000 is 80 %); left out for full.
      volume: vol === null ? 1 : Math.min(1, Math.max(0, vol / 100_000)),
      muted: node?.attrs['mute'] === '1' || node?.attrs['mute'] === 'true',
      loop: kid(node, 'p:cTn')?.attrs['repeatCount'] === 'indefinite',
      start: startOf(groups, shapeId),
      acrossSlides: numSld !== null && numSld > 1 ? Math.round(numSld) : null,
      hideWhenStopped: node?.attrs['showWhenStopped'] === '0' || node?.attrs['showWhenStopped'] === 'false',
    });
  }
  return out;
}

/**
 * What a slide does, from its XML (`sld`, the p:sld element), its relationships and the deck's slide size. A
 * slide with nothing of the kind has no transition, no groups and no media.
 */
export function readDeckSlide(
  sld: XmlNode,
  rels: ReadonlyMap<string, SlideRel>,
  size: SlideSize,
): PptxDeckSlide {
  const timing = kid(sld, 'p:timing');
  const triggered = timing
    ? all(timing, (n) => n.name === 'p:cTn' && n.attrs['nodeType'] === 'interactiveSeq')
    : [];
  return {
    transition: readTransition(sld, rels),
    groups: readGroups(timing),
    media: readMedia(sld, timing, rels, size),
    triggers: triggered.reduce(
      (n, seq) =>
        n +
        all(
          seq,
          (e) =>
            e.name === 'p:cTn' &&
            e.attrs['presetClass'] !== undefined &&
            e.attrs['presetClass'] !== 'mediacall',
        ).length,
      0,
    ),
  };
}

/** The step a group's work shows in: step 0 is the slide coming in (with a first group that needs no click). */
export function stepOfGroup(groups: readonly PptxGroup[], group: number): number {
  let step = 0;
  for (let g = 0; g <= group && g < groups.length; g++) if (groups[g]?.byClick) step++;
  return step;
}

/** How many steps a slide has: coming in, then one per click. */
export function stepsOf(groups: readonly PptxGroup[]): number {
  return 1 + groups.filter((g) => g.byClick).length;
}
