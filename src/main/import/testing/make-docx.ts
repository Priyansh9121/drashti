import { makeZip } from './zip-writer';

/*
 * A small Word document made for tests (Session 26f): paragraphs of
 * placeholder lyrics, with runs in given fonts, bold or hidden or deleted
 * words, line and page breaks, a table and a picture where asked, and the
 * parts Word expects (content types, relationships, styles).
 */

export interface TestDocxRun {
  text: string;
  font?: string;
  bold?: boolean;
  /** Hidden text (Word does not show it). */
  hidden?: boolean;
  /** A tracked deletion (Word shows it struck through, gone once accepted). */
  deleted?: boolean;
  /** Then a line break (Shift+Enter) or a page break. */
  then?: 'line' | 'page';
}

/** A paragraph: its words as one run, or runs; a table; or a paragraph holding a picture. */
export type TestDocxBlock =
  | string
  | { runs: TestDocxRun[]; style?: string; centred?: boolean }
  | { table: string[][] }
  | { picture: string };

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escape = (text: string) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/** A 1 × 1 PNG, for the picture. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function run(r: TestDocxRun): string {
  const props = [
    r.font ? `<w:rFonts w:ascii="${escape(r.font)}" w:hAnsi="${escape(r.font)}"/>` : '',
    r.bold ? '<w:b/>' : '',
    r.hidden ? '<w:vanish/>' : '',
  ].join('');
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  const text = r.deleted
    ? `<w:delText xml:space="preserve">${escape(r.text)}</w:delText>`
    : `<w:t xml:space="preserve">${escape(r.text)}</w:t>`;
  const brk = r.then === 'line' ? '<w:br/>' : r.then === 'page' ? '<w:br w:type="page"/>' : '';
  const body = `<w:r>${rPr}${text}${brk}</w:r>`;
  return r.deleted
    ? `<w:del w:id="1" w:author="Placeholder" w:date="2026-01-01T00:00:00Z">${body}</w:del>`
    : body;
}

function block(b: TestDocxBlock): string {
  if (typeof b === 'string') return `<w:p>${b === '' ? '' : run({ text: b })}</w:p>`;
  if ('table' in b)
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${b.table
      .map(
        (row) =>
          `<w:tr>${row.map((cell) => `<w:tc><w:p>${run({ text: cell })}</w:p></w:tc>`).join('')}</w:tr>`,
      )
      .join('')}</w:tbl>`;
  if ('picture' in b)
    return `<w:p>${run({ text: b.picture })}<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Placeholder picture"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const pPr = [
    b.style ? `<w:pStyle w:val="${escape(b.style)}"/>` : '',
    b.centred ? '<w:jc w:val="center"/>' : '',
  ].join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${b.runs.map(run).join('')}</w:p>`;
}

/**
 * A .docx of these paragraphs. `styles`: paragraph styles with a font (a style named "Lyrics" in a
 * legacy font, say); `defaultFont`: the document's own default font.
 */
export function makeTestDocx(
  blocks: TestDocxBlock[],
  options: { styles?: { id: string; font: string }[]; defaultFont?: string } = {},
): Buffer {
  const document = `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${blocks.map(block).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
  const defaults = options.defaultFont
    ? `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${escape(options.defaultFont)}" w:hAnsi="${escape(options.defaultFont)}"/></w:rPr></w:rPrDefault></w:docDefaults>`
    : '';
  const styles = `${XML}<w:styles xmlns:w="${W}">${defaults}<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${(
    options.styles ?? []
  )
    .map(
      (s) =>
        `<w:style w:type="paragraph" w:styleId="${escape(s.id)}"><w:name w:val="${escape(s.id)}"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${escape(s.font)}" w:hAnsi="${escape(s.font)}"/></w:rPr></w:style>`,
    )
    .join('')}</w:styles>`;
  const picture = blocks.some((b) => typeof b !== 'string' && 'picture' in b);
  return makeZip([
    {
      name: '[Content_Types].xml',
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
      deflate: true,
    },
    {
      name: '_rels/.rels',
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
      deflate: true,
    },
    { name: 'word/document.xml', data: document, deflate: true },
    { name: 'word/styles.xml', data: styles, deflate: true },
    {
      name: 'word/_rels/document.xml.rels',
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>${picture ? `<Relationship Id="rId2" Type="${R}/image" Target="media/image1.png"/>` : ''}</Relationships>`,
      deflate: true,
    },
    ...(picture ? [{ name: 'word/media/image1.png', data: PNG }] : []),
  ]);
}

/**
 * What Word saves when a document has a password: not a zip at all, but an old-style compound file
 * holding the encrypted package (only its signature and the stream's name matter here).
 */
export function makeProtectedDocx(): Buffer {
  const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return Buffer.concat([
    header,
    Buffer.alloc(504),
    Buffer.from('EncryptionInfo', 'utf16le'),
    Buffer.from('EncryptedPackage', 'utf16le'),
    Buffer.alloc(512),
  ]);
}

/** An old Word document (.doc): a compound file without an encrypted package. */
export function makeOldWordDoc(): Buffer {
  const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return Buffer.concat([
    header,
    Buffer.alloc(504),
    Buffer.from('WordDocument', 'utf16le'),
    Buffer.alloc(512),
  ]);
}
