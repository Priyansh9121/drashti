/*
 * An XML tree that is written back exactly as it was read, but for what is changed in it (Session 54, C2, from C1's
 * bake-copy.mjs): elements keep their attributes in order and as written (entities and all), and declarations,
 * comments, CDATA and text are kept as they are. For the timed copy of a deck (./timed-copy.ts), where a slide's
 * timing is changed and everything else must stay byte for byte what PowerPoint wrote. Namespaces are names
 * ("p:par"), as the app's reader (../xml.ts) has them.
 */

export interface TreeElement {
  name: string;
  /** Its attributes in order, values as written (escaped). */
  attrs: [string, string][];
  kids: TreeNode[];
}

/** Anything kept as written: text, a declaration, a comment, CDATA. */
export interface TreeRaw {
  raw: string;
}

export type TreeNode = TreeElement | TreeRaw;

const isElement = (n: TreeNode): n is TreeElement => 'name' in n;

const TOKEN =
  /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gy;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;

/** Read a document; throws on what is not XML of the kind the deck's parts are. */
export function parseTree(xml: string): TreeElement {
  const root: TreeElement = { name: '#root', attrs: [], kids: [] };
  const stack: TreeElement[] = [root];
  TOKEN.lastIndex = 0;
  let at = 0;
  for (let m = TOKEN.exec(xml); m !== null; m = TOKEN.exec(xml)) {
    at = TOKEN.lastIndex;
    const top = stack[stack.length - 1] ?? root;
    if (m[1] !== undefined) {
      if (top.name !== m[1]) throw new Error(`</${m[1]}> does not close <${top.name}>`);
      stack.pop();
    } else if (m[2] !== undefined) {
      const attrs: [string, string][] = [];
      for (const a of (m[3] ?? '').matchAll(ATTR)) attrs.push([a[1] ?? '', a[2] ?? a[3] ?? '']);
      const el: TreeElement = { name: m[2], attrs, kids: [] };
      top.kids.push(el);
      if (m[4] !== '/') stack.push(el);
    } else top.kids.push({ raw: m[0] });
  }
  if (at !== xml.length) throw new Error(`Not XML at character ${String(at)}`);
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1]?.name ?? '?'}> is never closed`);
  return root;
}

/** Write a tree back. */
export function writeTree(node: TreeNode): string {
  if (!isElement(node)) return node.raw;
  if (node.name === '#root') return node.kids.map(writeTree).join('');
  const attrs = node.attrs.map(([k, v]) => ` ${k}="${v}"`).join('');
  return node.kids.length > 0
    ? `<${node.name}${attrs}>${node.kids.map(writeTree).join('')}</${node.name}>`
    : `<${node.name}${attrs}/>`;
}

/** An element's child elements. */
export const elementsOf = (n: TreeElement | undefined): TreeElement[] => (n ? n.kids.filter(isElement) : []);

/** Its first child element of this name. */
export const childOf = (n: TreeElement | undefined, name: string): TreeElement | undefined =>
  elementsOf(n).find((k) => k.name === name);

export const attrOf = (n: TreeElement | undefined, key: string): string | undefined =>
  n?.attrs.find(([k]) => k === key)?.[1];

export function setAttr(n: TreeElement, key: string, value: string | number): void {
  const found = n.attrs.find(([k]) => k === key);
  if (found) found[1] = String(value);
  else n.attrs.push([key, String(value)]);
}

/** Every element below `n` (not `n` itself) that passes `test`, in document order. */
export function findAll(n: TreeElement, test: (e: TreeElement) => boolean): TreeElement[] {
  const out: TreeElement[] = [];
  const visit = (e: TreeElement) => {
    for (const k of elementsOf(e)) {
      if (test(k)) out.push(k);
      visit(k);
    }
  };
  visit(n);
  return out;
}

/** Keep only the children (elements and raw parts alike) that pass `keep`. */
export function keepKids(n: TreeElement, keep: (k: TreeNode) => boolean): void {
  n.kids = n.kids.filter(keep);
}

export { isElement };
