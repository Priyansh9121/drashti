import { crc32, deflateSync } from 'node:zlib';
import { makeZip } from './zip-writer';

/* Generated OOXML only, with no installed presentation app or outside content. */
const NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
export const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const relationshipsXml = (rows: string) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows}</Relationships>`;
export const slideXml = (tree: string, hidden = false) =>
  `<p:sld ${NS}${hidden ? ' show="0"' : ''}><p:cSld><p:spTree>${tree}</p:spTree></p:cSld></p:sld>`;
export const wordsShape = (
  body: string,
  props = '<a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="3657600" cy="914400"/></a:xfrm>',
  nv = '',
) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Placeholder words"/><p:cNvSpPr txBox="1"/><p:nvPr>${nv}</p:nvPr></p:nvSpPr><p:spPr>${props}</p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/>${body}</p:txBody></p:sp>`;

export function editablePptxFixture(options: {
  slides: string[];
  parts?: Record<string, string | Buffer>;
}): Buffer {
  const parts: Record<string, string | Buffer> = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    '_rels/.rels': relationshipsXml(
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="ppt/presentation.xml"/>`,
    ),
    'ppt/presentation.xml': `<p:presentation ${NS}><p:sldIdLst>${options.slides.map((_, i) => `<p:sldId id="${String(256 + i)}" r:id="rId${String(i + 1)}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': relationshipsXml(
      options.slides
        .map(
          (_, i) =>
            `<Relationship Id="rId${String(i + 1)}" Type="${REL_NS}/slide" Target="slides/slide${String(i + 1)}.xml"/>`,
        )
        .join(''),
    ),
    'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout ${NS}><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relationshipsXml(
      `<Relationship Id="rId1" Type="${REL_NS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`,
    ),
    'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster ${NS}><p:cSld><p:spTree/></p:cSld><p:clrMap bg1="lt1" tx1="dk1"/></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relationshipsXml(
      `<Relationship Id="rId1" Type="${REL_NS}/theme" Target="../theme/theme1.xml"/>`,
    ),
    'ppt/theme/theme1.xml': `<a:theme ${NS}><a:themeElements><a:clrScheme name="Placeholder"><a:dk1><a:srgbClr val="101820"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="AA2244"/></a:accent1><a:accent2><a:srgbClr val="22BB44"/></a:accent2></a:clrScheme><a:fontScheme name="Placeholder"><a:majorFont><a:latin typeface="Placeholder Heading"/><a:cs typeface="Placeholder Indic"/></a:majorFont><a:minorFont><a:latin typeface="Placeholder Sans"/><a:cs typeface="Placeholder Indic"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
  };
  options.slides.forEach((slide, i) => {
    const name = `slide${String(i + 1)}.xml`;
    parts[`ppt/slides/${name}`] = slide;
    parts[`ppt/slides/_rels/${name}.rels`] = relationshipsXml(
      `<Relationship Id="rId1" Type="${REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
    );
  });
  Object.assign(parts, options.parts);
  return makeZip(Object.entries(parts).map(([name, data]) => ({ name, data, deflate: true })));
}

/** A valid generated 1×1 RGB picture, not a real camera or library image. */
export function editablePicture(): Buffer {
  const chunk = (type: string, bytes: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(bytes.length);
    head.write(type, 4);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), bytes])));
    return Buffer.concat([head, bytes, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 40, 90, 140]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
