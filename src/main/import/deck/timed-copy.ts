import { posix } from 'node:path';
import { parseXml, type XmlNode } from '../xml';
import { readZipEntries } from '../zip';
import type { MoviePlan, PlannedSlide } from './plan';
import {
  attrOf,
  childOf,
  elementsOf,
  findAll,
  isElement,
  keepKids,
  parseTree,
  setAttr,
  type TreeElement,
  writeTree,
} from './xml-tree';
import { copyZipReplacing } from './zip-copy';

/*
 * The timed copy of a PowerPoint deck (Session 54, C2, from C1's bake-copy.mjs): what PowerPoint is given to make
 * a movie of, written into a copy only (the operator's file is never touched). PowerPoint's own movie of a deck
 * runs every click by itself at its own pace, so where to cut is not known; in this copy it is (./plan.ts):
 *
 * - each slide's click groups become one chain that starts with the slide, each former click starting at its
 *   planned moment (a still gap after the group before it ends); the delays inside a group are kept as written;
 * - the slide moves on by itself (advTm) at its planned moment, after its last frame has been held;
 * - its videos and sounds are taken out of its timing (they keep their poster picture but never play), and its
 *   transition's sound too: Drashti plays them as real media, from the deck's own XML;
 * - shape triggers (interactive sequences) are left out: a click on a shape is never a Next.
 *
 * Hidden slides are left as they are (no movie shows them). A deck set not to use its timings in its slide show
 * (Set Up Slide Show, useTimings="0") uses them in the copy, or the advance times would be no one's.
 */

const MAIN_SEQ = 'mainSeq';

/** The slides' parts in the order they play (presentation.xml's p:sldIdLst through its relationships). */
async function slideParts(deck: string): Promise<string[]> {
  const parts = await readZipEntries(
    deck,
    (name) => name === 'ppt/presentation.xml' || name === 'ppt/_rels/presentation.xml.rels',
  );
  const presentation = parts.get('ppt/presentation.xml');
  const relsXml = parts.get('ppt/_rels/presentation.xml.rels');
  if (!presentation || !relsXml) throw new Error('This is not a PowerPoint (.pptx) file.');
  const all = (node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] => {
    for (const c of node.children) {
      if (c.name === name) out.push(c);
      all(c, name, out);
    }
    return out;
  };
  const targets = new Map(
    all(parseXml(relsXml.toString('utf8')), 'Relationship').map((r) => {
      const target = r.attrs['Target'] ?? '';
      return [
        r.attrs['Id'] ?? '',
        target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join('ppt', target)),
      ];
    }),
  );
  return all(parseXml(presentation.toString('utf8')), 'p:sldId').map(
    (s) => targets.get(s.attrs['r:id'] ?? '') ?? '',
  );
}

/** Every element of this name with its parent, below `root`. */
function withParents(root: TreeElement, name: string): { el: TreeElement; parent: TreeElement }[] {
  const out: { el: TreeElement; parent: TreeElement }[] = [];
  const visit = (parent: TreeElement) => {
    for (const k of elementsOf(parent)) {
      if (k.name === name) out.push({ el: k, parent });
      visit(k);
    }
  };
  visit(root);
  return out;
}

const cTnOf = (el: TreeElement) => childOf(el, 'p:cTn');
const isMediaCall = (el: TreeElement) =>
  el.name === 'p:par' && attrOf(cTnOf(el), 'presetClass') === 'mediacall';

/** A timing node's first start condition, made when it has none. */
function firstCond(cTn: TreeElement): TreeElement {
  let list = childOf(cTn, 'p:stCondLst');
  if (!list) {
    list = { name: 'p:stCondLst', attrs: [], kids: [] };
    cTn.kids.unshift(list);
  }
  let cond = childOf(list, 'p:cond');
  if (!cond) {
    cond = { name: 'p:cond', attrs: [['delay', '0']], kids: [] };
    list.kids.unshift(cond);
  }
  return cond;
}

/** One turn of an effect: its longest behaviour's length, twice over when it plays back (autoRev). */
function turnOf(effect: TreeElement): number {
  let longest = 0;
  for (const tn of findAll(effect, (n) => n.name === 'p:cTn')) {
    const dur = Number(attrOf(tn, 'dur'));
    if (!Number.isFinite(dur)) continue;
    const back = attrOf(tn, 'autoRev') === '1' || attrOf(tn, 'autoRev') === 'true' ? 2 : 1;
    longest = Math.max(longest, dur * back);
  }
  return longest;
}

/** One p:timing of a slide, made into its timed chain. Returns false when nothing is left to time. */
function chainTiming(timing: TreeElement, plan: PlannedSlide): boolean {
  const rootTn = findAll(timing, (n) => n.name === 'p:cTn' && attrOf(n, 'nodeType') === 'tmRoot')[0];
  const rootList = rootTn ? childOf(rootTn, 'p:childTnLst') : undefined;
  if (!rootList) return true;
  // Videos' and sounds' own nodes out, and every sequence but the main one (shape triggers).
  keepKids(rootList, (k) => {
    if (!isElement(k)) return true;
    if (k.name === 'p:video' || k.name === 'p:audio') return false;
    if (k.name === 'p:seq') return attrOf(cTnOf(k), 'nodeType') === MAIN_SEQ;
    return true;
  });
  const mainTn = findAll(rootList, (n) => n.name === 'p:cTn' && attrOf(n, 'nodeType') === MAIN_SEQ)[0];
  const seqList = mainTn ? childOf(mainTn, 'p:childTnLst') : undefined;
  if (mainTn && seqList) {
    const groups = elementsOf(seqList).filter((k) => k.name === 'p:par');
    // Each start of a video or sound out, wherever it is: the effects after it keep their own delays.
    for (const g of groups)
      for (const list of findAll(g, (n) => n.name === 'p:childTnLst'))
        keepKids(list, (k) => !(isElement(k) && isMediaCall(k)));
    const merged: TreeElement[] = [];
    groups.forEach((g, i) => {
      const start = plan.groups[i]?.startMs ?? plan.groups[plan.groups.length - 1]?.endMs ?? 0;
      const groupTn = cTnOf(g);
      const subs = elementsOf(groupTn ? childOf(groupTn, 'p:childTnLst') : undefined).filter(
        (k) => k.name === 'p:par',
      );
      for (const sub of subs) {
        const subTn = cTnOf(sub);
        if (!subTn) continue;
        // A sub-group that only started a video or sound is empty now: PowerPoint wants none empty.
        const effects = elementsOf(childOf(subTn, 'p:childTnLst')).filter((k) => k.name === 'p:par');
        if (effects.length === 0) continue;
        const cond = firstCond(subTn);
        const delay = Number(attrOf(cond, 'delay'));
        const at = Math.round(start + (Number.isFinite(delay) ? delay : 0));
        setAttr(cond, 'delay', at);
        // What repeats until the slide ends turns until the plan's last hold is cut, then stops (whole turns); what
        // repeats until the next click, until its own step's hold is cut (C review: the click stops it in the show).
        for (const effect of effects) {
          const tn = cTnOf(effect);
          if (!tn || attrOf(tn, 'repeatCount') !== 'indefinite') continue;
          const toClick = elementsOf(childOf(tn, 'p:endCondLst')).some((c) => attrOf(c, 'evt') === 'onNext');
          const until = toClick ? plan.groups[i]?.untilMs : plan.endlessUntilMs;
          if (until === undefined || until === null) continue;
          const own = Number(attrOf(firstCond(tn), 'delay'));
          const from = at + (Number.isFinite(own) ? own : 0);
          const turn = turnOf(effect);
          if (turn > 0) setAttr(tn, 'repeatCount', Math.max(1, Math.ceil((until - from) / turn)) * 1000);
        }
        merged.push(sub);
      }
      // The first effect of a former click now runs on after the one before.
      for (const tn of findAll(g, (n) => n.name === 'p:cTn' && attrOf(n, 'nodeType') === 'clickEffect'))
        setAttr(tn, 'nodeType', 'afterEffect');
    });
    const first = groups[0];
    const firstTn = first ? cTnOf(first) : undefined;
    if (merged.length > 0 && first && firstTn) {
      // One group that begins with the slide holds the whole chain.
      const conds: TreeElement = {
        name: 'p:stCondLst',
        attrs: [],
        kids: [
          { name: 'p:cond', attrs: [['delay', 'indefinite']], kids: [] },
          {
            name: 'p:cond',
            attrs: [
              ['evt', 'onBegin'],
              ['delay', '0'],
            ],
            kids: [{ name: 'p:tn', attrs: [['val', attrOf(mainTn, 'id') ?? '2']], kids: [] }],
          },
        ],
      };
      const at = firstTn.kids.findIndex((k) => isElement(k) && k.name === 'p:stCondLst');
      if (at >= 0) firstTn.kids[at] = conds;
      else firstTn.kids.unshift(conds);
      const list = childOf(firstTn, 'p:childTnLst');
      if (list) list.kids = merged;
      else firstTn.kids.push({ name: 'p:childTnLst', attrs: [], kids: merged });
      seqList.kids = [first];
    } else keepKids(rootList, (k) => !(isElement(k) && k.name === 'p:seq'));
  }
  return elementsOf(rootList).length > 0;
}

/** A slide's XML made into its timed copy, by its plan. */
export function timedSlideXml(xml: string, plan: PlannedSlide): string {
  const root = parseTree(xml);
  const sld = elementsOf(root).find((e) => e.name === 'p:sld');
  if (!sld) throw new Error('Not a slide');
  // The transition's sound out (its fallback's too): Drashti plays it as real sound.
  const transitions = findAll(sld, (n) => n.name === 'p:transition');
  for (const t of transitions) keepKids(t, (k) => !(isElement(k) && k.name === 'p:sndAc'));
  for (const { el, parent } of withParents(sld, 'p:timing'))
    if (!chainTiming(el, plan)) keepKids(parent, (k) => k !== el);
  // It moves on by itself once its chain has run and its last frame has been held.
  const advance = String(Math.max(1, Math.round(plan.advanceMs)));
  if (transitions.length > 0) for (const t of transitions) setAttr(t, 'advTm', advance);
  else {
    // Where the schema has it: after the colour mapping, before the timing.
    const t: TreeElement = { name: 'p:transition', attrs: [['advTm', advance]], kids: [] };
    const clr = sld.kids.findIndex((k) => isElement(k) && k.name === 'p:clrMapOvr');
    const later = sld.kids.findIndex(
      (k) => isElement(k) && ['p:timing', 'p:extLst', 'mc:AlternateContent'].includes(k.name),
    );
    if (clr >= 0) sld.kids.splice(clr + 1, 0, t);
    else if (later >= 0) sld.kids.splice(later, 0, t);
    else sld.kids.push(t);
  }
  return writeTree(root);
}

/** Where a deck keeps how its slide show runs (p:showPr): its show properties, or (older files) the presentation. */
const SHOW_PARTS = ['ppt/presProps.xml', 'ppt/presentation.xml'];

/** A part's slide show set to use the slides' timings (its useTimings="0" or "false" taken out). */
export function usingTimings(xml: string): string {
  return xml.replace(/(<p:showPr\b[^>]*?)\s+useTimings=(["'])(?:0|false)\2/gu, '$1');
}

/** Write the timed copy of `deck` to `copy`, its shown slides by `plan` (PowerPoint's, ./plan.ts). */
export async function writeTimedCopy(deck: string, copy: string, plan: MoviePlan): Promise<void> {
  const order = await slideParts(deck);
  const wanted = new Map<string, PlannedSlide>();
  for (const s of plan.slides) {
    const part = order[s.index];
    if (part) wanted.set(part, s);
  }
  const parts = await readZipEntries(
    deck,
    (name) => wanted.has(name) || SHOW_PARTS.includes(name),
    64 * 1024 * 1024,
  );
  const replace = new Map<string, Buffer>();
  for (const [part, slide] of wanted) {
    const xml = parts.get(part);
    if (!xml) throw new Error(`The deck has no ${part}`);
    replace.set(part, Buffer.from(timedSlideXml(xml.toString('utf8'), slide), 'utf8'));
  }
  for (const part of SHOW_PARTS) {
    const xml = parts.get(part)?.toString('utf8');
    const timed = xml ? usingTimings(xml) : null;
    if (timed !== null && timed !== xml) replace.set(part, Buffer.from(timed, 'utf8'));
  }
  await copyZipReplacing(deck, copy, replace);
}
