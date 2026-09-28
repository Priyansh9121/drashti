/*
 * A small XML reader for presentation files: elements, attributes, text,
 * entities and CDATA. No namespaces, DTDs or validation (the files need
 * none). It throws XmlError on input that is not XML.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** The element's own text (entities decoded), not its children's. */
  text: string;
}

export class XmlError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (at character ${offset})`);
    this.name = 'XmlError';
  }
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/gu, (whole, ref: string) => {
    if (ref.startsWith('#x')) return safeCodePoint(parseInt(ref.slice(2), 16)) ?? whole;
    if (ref.startsWith('#')) return safeCodePoint(parseInt(ref.slice(1), 10)) ?? whole;
    return NAMED[ref] ?? whole;
  });
}

function safeCodePoint(n: number): string | null {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null;
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const ATTR = /\s*([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

/** Parse an XML document into its root element. */
export function parseXml(xml: string): XmlNode {
  let i = 0;
  const n = xml.length;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;

  while (i < n) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) {
      const parent = stack.at(-1);
      if (parent) parent.text += decodeEntities(xml.slice(i, textEnd));
      else if (xml.slice(i, textEnd).trim() !== '') throw new XmlError('Text outside the root element', i);
      i = textEnd;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end === -1) throw new XmlError('Unclosed processing instruction', i);
      i = end + 2;
    } else if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end === -1) throw new XmlError('Unclosed comment', i);
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end === -1) throw new XmlError('Unclosed CDATA section', i);
      const parent = stack.at(-1);
      if (parent) parent.text += xml.slice(i + 9, end);
      i = end + 3;
    } else if (xml.startsWith('<!', i)) {
      // <!DOCTYPE ...>, possibly with an internal subset in [...]
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        const c = xml.charAt(j);
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (xml.startsWith('</', i)) {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(xml);
      if (!m) throw new XmlError('Bad closing tag', i);
      const open = stack.pop();
      if (open?.name !== m[0])
        throw new XmlError(`Closing </${m[0]}> does not match <${open?.name ?? '?'}>`, i);
      const end = xml.indexOf('>', NAME.lastIndex);
      if (end === -1) throw new XmlError('Unclosed closing tag', i);
      i = end + 1;
      if (stack.length === 0) root = open;
    } else {
      NAME.lastIndex = i + 1;
      const m = NAME.exec(xml);
      if (!m) throw new XmlError('Bad tag', i);
      const node: XmlNode = { name: m[0], attrs: {}, children: [], text: '' };
      let j = NAME.lastIndex;
      for (;;) {
        ATTR.lastIndex = j;
        const a = ATTR.exec(xml);
        if (!a) break;
        node.attrs[a[1] ?? ''] = decodeEntities(a[3] ?? a[4] ?? '');
        j = ATTR.lastIndex;
      }
      while (j < n && /\s/u.test(xml.charAt(j))) j++;
      const parent = stack.at(-1);
      if (parent) parent.children.push(node);
      else if (root) throw new XmlError('More than one root element', i);
      if (xml.startsWith('/>', j)) {
        i = j + 2;
        if (!parent) root = node;
      } else if (xml.charAt(j) === '>') {
        stack.push(node);
        i = j + 1;
      } else {
        throw new XmlError(`Bad attribute in <${node.name}>`, j);
      }
    }
  }
  if (stack.length > 0) throw new XmlError(`<${stack.at(-1)?.name ?? '?'}> is never closed`, n);
  if (!root) throw new XmlError('No root element', 0);
  return root;
}

/** Child elements, optionally only those with this name. */
export function childrenOf(node: XmlNode, name?: string): XmlNode[] {
  return name === undefined ? node.children : node.children.filter((c) => c.name === name);
}

/** The child that holds an Objective-C instance variable (rvXMLIvarName="..."), as these files write fields. */
export function field(node: XmlNode, ivar: string): XmlNode | undefined {
  return node.children.find((c) => c.attrs['rvXMLIvarName'] === ivar);
}

/** The elements inside the array field `ivar` (for example a slide's displayElements). */
export function arrayField(node: XmlNode, ivar: string): XmlNode[] {
  return field(node, ivar)?.children ?? [];
}
