import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SlideElement } from '../../../shared/model';
import { slideElementSchema } from '../../../shared/model-schema';
import { editablePptxFixture, slideXml, wordsShape } from '../testing/editable-pptx-fixture';
import { readEditablePptx } from './editable-pptx';

/*
 * Keynote's own PowerPoint copy of a placeholder deck our tests generate (tests/fixtures/decks; Session 57's real
 * Keynote round trip). Keynote writes a text box's alignment and font only where they differ from the presentation's
 * default text style, keeps its slide number's right alignment in the master's "other" style, and gives every box a
 * line width with no colour. Keynote and PowerPoint draw those boxes left-aligned with no outline.
 */
const KEYNOTE_COPY = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'tests',
  'fixtures',
  'decks',
  'placeholder-keynote-copy.pptx',
);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function folder() {
  const root = mkdtempSync(join(tmpdir(), 'drashti-placeholder-keynote-'));
  roots.push(root);
  return root;
}
async function readKeynoteCopy() {
  const root = folder();
  const file = join(root, 'Placeholder Keynote copy.pptx');
  copyFileSync(KEYNOTE_COPY, file);
  return readEditablePptx(file, join(root, 'prepared'));
}
async function readSlide(slide: string, parts?: Record<string, string | Buffer>) {
  const root = folder();
  const file = join(root, 'Placeholder deck.pptx');
  writeFileSync(file, editablePptxFixture({ slides: [slide], parts }));
  const deck = await readEditablePptx(file, join(root, 'prepared'));
  return deck.slides[0]?.elements.map((el) => slideElementSchema.parse(el)) ?? [];
}
const text = (elements: SlideElement[]) => elements.filter((el) => el.kind === 'text');

const NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PRESENTATION = (defaults: string) =>
  `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/>${defaults}</p:presentation>`;
const MASTER = (styles: string) =>
  `<p:sldMaster ${NS}><p:cSld><p:spTree/></p:cSld><p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles>${styles}</p:txStyles></p:sldMaster>`;
const level = (align: string, size: number, color: string) =>
  `<a:lvl1pPr marL="0" algn="${align}"><a:defRPr sz="${String(size)}"><a:solidFill>${color}</a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>`;
const BOX =
  '<a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/>';
const plainWords = (props = BOX) =>
  wordsShape('<a:p><a:pPr/><a:r><a:t>Placeholder plain words</a:t></a:r></a:p>', props);

/*
 * The real round trip's slides 4 and 5 (13 Nov, run 5 on phase1 28041612), in the shape Keynote's PowerPoint copy wrote
 * them, placeholder words only. Its master keeps Keynote's title and body styles left-aligned and its "other" style
 * (its slide number's) right-aligned at 12 pt.
 */
const KEYNOTE_STYLES = {
  'ppt/presentation.xml': PRESENTATION(
    `<p:defaultTextStyle>${level('l', 1800, '<a:srgbClr val="000000"/>')}</p:defaultTextStyle>`,
  ),
  'ppt/slideMasters/slideMaster1.xml': MASTER(
    `<p:titleStyle>${level('l', 4400, '<a:srgbClr val="000000"/>')}</p:titleStyle>` +
      `<p:bodyStyle>${level('l', 2800, '<a:srgbClr val="000000"/>')}</p:bodyStyle>` +
      `<p:otherStyle>${level('r', 1200, '<a:schemeClr val="tx1"/>')}</p:otherStyle>`,
  ),
};
const TITLE_BOX = '<a:xfrm><a:off x="1524000" y="1122363"/><a:ext cx="9144000" cy="2387600"/></a:xfrm>';
const SUBTITLE_BOX = '<a:xfrm><a:off x="1524000" y="3602038"/><a:ext cx="9144000" cy="1655762"/></a:xfrm>';
/** PowerPoint's Title Slide layout as the round trip's deck writes it: places only, unless a subtitle list is given. */
const titleLayout = (subtitleList = '') => {
  const box = (id: number, ph: string, at: string, list = '') =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="Placeholder layout box ${String(id)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${at}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle>${list}</a:lstStyle><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Placeholder layout words</a:t></a:r></a:p></p:txBody></p:sp>`;
  return `<p:sldLayout ${NS} type="title"><p:cSld name="Title Slide"><p:spTree>${box(2, '<p:ph type="ctrTitle"/>', TITLE_BOX)}${box(3, '<p:ph type="subTitle" idx="1"/>', SUBTITLE_BOX, subtitleList)}</p:spTree></p:cSld></p:sldLayout>`;
};
/** A placeholder's words as Keynote writes them: white, with no alignment of their own. */
const keynotePlaceholder = (id: number, ph: string, at: string, words: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="${words} box"/><p:cNvSpPr txBox="1"/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${at}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:pPr/><a:r><a:t>${words}</a:t></a:r></a:p></p:txBody></p:sp>`;
const titleSlide = (subtitle: string) =>
  slideXml(
    keynotePlaceholder(45, '<p:ph type="ctrTitle"/>', TITLE_BOX, 'Placeholder title 4') +
      keynotePlaceholder(46, subtitle, SUBTITLE_BOX, 'Placeholder subtitle 4'),
  );

/** One of the table styles Keynote writes into every copy, the one its table names: white borders all round. */
const KEYNOTE_TABLE_STYLE = '{4C3C2611-4C71-4FC5-86AE-919BDF0F9419}';
const keynoteTableStyles = () => {
  const border = (side: string, width = 12700) =>
    `<a:${side}><a:ln w="${String(width)}" cap="flat"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:prstDash val="solid"/><a:round/></a:ln></a:${side}>`;
  const part = (name: string, bold: string, words: string, bottom: number, fill: string) =>
    `<a:${name}><a:tcTxStyle b="${bold}" i="off"><a:font><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:font><a:srgbClr val="${words}"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${border('left')}${border('right')}${border('top')}${border('bottom', bottom)}${border('insideH')}${border('insideV')}</a:tcBdr><a:fill><a:solidFill>${fill}</a:solidFill></a:fill></a:tcStyle></a:${name}>`;
  return `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5940675A-B579-460E-94D1-54222C63F5DA}"><a:tblStyle styleId="${KEYNOTE_TABLE_STYLE}" styleName=""><a:tblBg/>${part('wholeTbl', 'off', '000000', 12700, '<a:srgbClr val="CDD2F2"/>')}${part('firstRow', 'on', 'FFFFFF', 38100, '<a:schemeClr val="accent1"/>')}</a:tblStyle></a:tblStyleLst>`;
};
const TABLE_WORDS = [
  ['Placeholder head 1', 'Placeholder head 2', 'Placeholder head 3'],
  ['Placeholder cell 1', 'Placeholder cell 2', 'Placeholder cell 3'],
  ['Placeholder cell 4', 'Placeholder cell 5', 'Placeholder cell 6'],
];
/**
 * Slide 5's table as Keynote wrote it: each cell's four borders a width with no colour, its own fill (the header row's
 * blue, none below), its words left-aligned and white; and, unless `styled` is false, Keynote's table style named.
 */
const keynoteTable = (styled = true) => {
  const borders = ['lnL', 'lnR', 'lnT', 'lnB']
    .map((side) => `<a:${side} w="12700"><a:miter lim="400000"/></a:${side}>`)
    .join('');
  const cell = (words: string, head: boolean) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l">${head ? '<a:defRPr b="0" sz="1800"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:defRPr>' : '<a:defRPr sz="1800"/>'}</a:pPr><a:r><a:rPr${head ? ' b="1"' : ''} sz="2400"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:sym typeface="Arial"/></a:rPr><a:t>${words}</a:t></a:r></a:p></a:txBody><a:tcPr marL="45720" marR="45720" marT="45720" marB="45720" anchor="t" anchorCtr="0" horzOverflow="overflow">${borders}${head ? '<a:solidFill><a:srgbClr val="35618F"/></a:solidFill>' : '<a:noFill/>'}</a:tcPr></a:tc>`;
  const rows = TABLE_WORDS.map(
    (row, r) => `<a:tr h="731520">${row.map((words) => cell(words, r === 0)).join('')}</a:tr>`,
  ).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="51" name="Placeholder table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="548640" y="1828800"/><a:ext cx="9601201" cy="2194561"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstCol="0" firstRow="1" lastCol="0" lastRow="0" bandCol="0" bandRow="0" rtl="0">${styled ? `<a:tableStyleId>${KEYNOTE_TABLE_STYLE}</a:tableStyleId>` : ''}</a:tblPr><a:tblGrid>${'<a:gridCol w="3200400"/>'.repeat(3)}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
};

describe("Keynote's PowerPoint copy", () => {
  it('reads every text box left-aligned in its own font, with no outline and no extra shape beside it', async () => {
    const deck = await readKeynoteCopy();
    expect(deck.slides).toHaveLength(3);
    for (const [index, slide] of deck.slides.entries()) {
      const n = String(index + 1);
      for (const element of slide.elements) slideElementSchema.parse(element);
      // One element per text box (Keynote's own shape ids 20/21, 25/26, 31/32), and slide 2's shape.
      expect(slide.elements.map((el) => [el.kind, el.name])).toEqual([
        ['text', `Placeholder title box ${n}`],
        ['text', `Placeholder body box ${n}`],
        ...(index === 1 ? [['shape', 'Placeholder shape']] : []),
      ]);
      const [title, body] = text(slide.elements);
      expect(title).toMatchObject({ text: `Placeholder title ${n}` });
      expect(body).toMatchObject({ text: `Placeholder body ${n}` });
      for (const [box, points] of [
        [title, 44],
        [body, 32],
      ] as const) {
        if (box?.kind !== 'text') throw new Error('A Keynote text box was not read.');
        expect(box.style).toMatchObject({ align: 'left', fontFamily: 'Arial', color: '#ffffff' });
        expect(box.style.fontSize).toBeCloseTo((points * 4) / 3);
        expect(box.runs?.map((run) => [run.paragraph?.align, run.font])).toEqual([['left', 'Arial']]);
      }
    }
    expect(deck.slides[1]?.elements[2]).toMatchObject({
      kind: 'shape',
      sourceShapeId: '27',
      shape: 'rectangle',
      fill: '#f5d90a',
      outline: null,
    });
  });
});

describe('the text style and line of a plain text box', () => {
  it('takes the presentation default text style before the master’s other style, as PowerPoint does', async () => {
    const [box] = text(
      await readSlide(slideXml(plainWords()), {
        'ppt/presentation.xml': PRESENTATION(
          `<p:defaultTextStyle>${level('l', 1800, '<a:schemeClr val="tx1"/>')}</p:defaultTextStyle>`,
        ),
        'ppt/slideMasters/slideMaster1.xml': MASTER(
          `<p:otherStyle>${level('r', 1200, '<a:schemeClr val="accent1"/>')}</p:otherStyle>`,
        ),
      }),
    );
    expect(box?.kind === 'text' && box.style).toMatchObject({
      align: 'left',
      fontSize: 24,
      color: '#101820',
      fontFamily: 'Placeholder Sans',
    });
  });

  it('reads as before where the two styles agree, and takes the other style when the presentation has none', async () => {
    const same = level('ctr', 2000, '<a:schemeClr val="accent2"/>');
    const agreeing = text(
      await readSlide(slideXml(plainWords()), {
        'ppt/presentation.xml': PRESENTATION(`<p:defaultTextStyle>${same}</p:defaultTextStyle>`),
        'ppt/slideMasters/slideMaster1.xml': MASTER(`<p:otherStyle>${same}</p:otherStyle>`),
      }),
    )[0];
    const masterOnly = text(
      await readSlide(slideXml(plainWords()), {
        'ppt/slideMasters/slideMaster1.xml': MASTER(`<p:otherStyle>${same}</p:otherStyle>`),
      }),
    )[0];
    for (const box of [agreeing, masterOnly])
      expect(box?.kind === 'text' && box.style).toMatchObject({
        align: 'center',
        fontSize: (20 * 4) / 3,
        color: '#22bb44',
        fontFamily: 'Placeholder Sans',
      });
  });

  it('draws no outline for a line with a width but no colour, and keeps a coloured line and a style’s line', async () => {
    const styled = (line: string, index = 2) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="5" name="Placeholder styled shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${BOX}${line}</p:spPr><p:style><a:lnRef idx="${String(index)}"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>`;
    const elements = await readSlide(
      slideXml(
        plainWords(`${BOX}<a:ln w="12700"><a:miter lim="400000"/></a:ln>`) +
          plainWords(`${BOX}<a:ln w="25400"><a:solidFill><a:srgbClr val="AA2244"/></a:solidFill></a:ln>`) +
          styled('<a:ln w="38100"/>') +
          styled('<a:ln w="38100"/>', 0) +
          styled('<a:ln><a:noFill/></a:ln>'),
      ),
    );
    expect(elements.map((el) => el.kind)).toEqual(['text', 'shape', 'text', 'shape', 'shape', 'shape']);
    expect(elements[1]).toMatchObject({ fill: null, outline: { color: '#aa2244', width: (2 * 4) / 3 } });
    expect(elements[3]).toMatchObject({ name: 'Placeholder styled shape', fill: '#22bb44' });
    expect.soft(elements[3]).toMatchObject({ outline: { width: 4, color: '#aa2244' } });
    expect.soft(elements[4]).toMatchObject({ fill: '#22bb44', outline: null });
    expect(elements[5]).toMatchObject({ fill: '#22bb44', outline: null });
  });

  it('uses Office-theme style lines for a shape and a connector without direct lines', async () => {
    const lines = [6350, 12700, 19050]
      .map(
        (width) => `<a:ln w="${String(width)}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`,
      )
      .join('');
    const theme =
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Placeholder Office">' +
      '<a:themeElements><a:clrScheme name="Placeholder"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>' +
      '<a:fmtScheme name="Placeholder"><a:lnStyleLst>' +
      lines +
      '</a:lnStyleLst></a:fmtScheme></a:themeElements></a:theme>';
    const style = (index: number, shade = '') =>
      `<p:style><a:lnRef idx="${String(index)}"><a:schemeClr val="accent1">${shade}</a:schemeClr></a:lnRef></p:style>`;
    const rectangle =
      '<p:sp><p:nvSpPr><p:cNvPr id="10" name="Placeholder rectangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr>' +
      BOX +
      '</p:spPr>' +
      style(2, '<a:shade val="15000"/>') +
      '</p:sp>';
    const connector = (id: number, name: string, line: string) =>
      `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${String(id)}" name="${name}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
      '<p:spPr>' +
      BOX.replace('prst="rect"', 'prst="line"') +
      line +
      '</p:spPr>' +
      style(1) +
      '</p:cxnSp>';
    const elements = await readSlide(
      slideXml(
        rectangle +
          connector(11, 'Placeholder connector', '') +
          connector(12, 'Placeholder no outline', '<a:ln><a:noFill/></a:ln>'),
      ),
      { 'ppt/theme/theme1.xml': theme },
    );
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({
      kind: 'shape',
      shape: 'rectangle',
      name: 'Placeholder rectangle',
      outline: { color: '#172c51', width: 4 / 3 },
    });
    expect(elements[1]).toMatchObject({
      kind: 'shape',
      shape: 'line',
      name: 'Placeholder connector',
      fill: null,
      outline: { color: '#4472c4', width: 2 / 3 },
    });
  });
});

describe("Keynote's copy of a title slide and a table (the real round trip's slides 4 and 5)", () => {
  it('reads a subtitle in the master’s body style, as PowerPoint does, where the deck gives no alignment', async () => {
    // `subTitle` as the round trip's deck has it; `body` (idx 1) as Keynote's copy of it wrote it.
    for (const ph of ['<p:ph type="subTitle" idx="1"/>', '<p:ph type="body" sz="quarter" idx="1"/>']) {
      const [title, subtitle] = text(
        await readSlide(titleSlide(ph), {
          ...KEYNOTE_STYLES,
          'ppt/slideLayouts/slideLayout1.xml': titleLayout(),
        }),
      );
      for (const [box, words, points] of [
        [title, 'Placeholder title 4', 44],
        [subtitle, 'Placeholder subtitle 4', 28],
      ] as const) {
        if (box?.kind !== 'text') throw new Error('A Keynote placeholder was not read.');
        expect(box).toMatchObject({ text: words, style: { align: 'left', color: '#ffffff' } });
        expect(box.style.fontSize).toBeCloseTo((points * 4) / 3);
      }
    }
  });

  it('reads PowerPoint’s own subtitle centred as before, with the body style’s spacing and no bullet', async () => {
    // The Office theme's body style (bullets, hanging indent, 90% lines, 10 pt before) and other style, and its Title
    // Slide layout's subtitle, which turns the body style's bullet and indent off.
    const body =
      '<a:lvl1pPr marL="228600" indent="-228600" algn="l"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>';
    const subtitle = (
      await readSlide(
        slideXml(
          '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Placeholder subtitle"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Placeholder PowerPoint subtitle</a:t></a:r></a:p></p:txBody></p:sp>',
        ),
        {
          'ppt/presentation.xml': PRESENTATION(
            `<p:defaultTextStyle>${level('l', 1800, '<a:schemeClr val="tx1"/>')}</p:defaultTextStyle>`,
          ),
          'ppt/slideMasters/slideMaster1.xml': MASTER(
            `<p:bodyStyle>${body}</p:bodyStyle><p:otherStyle>${level('l', 1800, '<a:schemeClr val="tx1"/>')}</p:otherStyle>`,
          ),
          'ppt/slideLayouts/slideLayout1.xml': titleLayout(
            '<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr>',
          ),
        },
      )
    )[0];
    if (subtitle?.kind !== 'text') throw new Error('The PowerPoint subtitle was not read.');
    expect(subtitle.style).toMatchObject({
      align: 'center',
      fontSize: 32,
      color: '#101820',
      lineHeight: 1.08,
    });
    const [run] = subtitle.runs ?? [];
    expect(run).not.toHaveProperty('list');
    expect(run?.paragraph).toMatchObject({ align: 'center', marginLeft: 0, indent: 0, lineHeight: 1.08 });
    expect(run?.paragraph?.spaceBefore).toBeCloseTo((10 * 4) / 3, 4);
  });

  it('draws no cell border written as a width with no colour, whatever its table style’s borders', async () => {
    // Keynote draws this table with no lines at all (the run's still of slide 5 as it came in): its gridlines are off.
    for (const styled of [true, false]) {
      const elements = await readSlide(slideXml(keynoteTable(styled)), {
        ...KEYNOTE_STYLES,
        'ppt/tableStyles.xml': keynoteTableStyles(),
      });
      const shapes = elements.flatMap((el) => (el.kind === 'shape' ? [el] : []));
      expect(shapes.filter((el) => el.shape === 'line' || el.outline)).toEqual([]);
      expect(shapes.map((el) => el.fill)).toEqual(['#35618f', '#35618f', '#35618f']);
      // Its words as Keynote wrote them: each cell left-aligned and white, in its own place.
      expect(text(elements).map((el) => [el.tableCell, el.text, el.style.align, el.style.color])).toEqual(
        TABLE_WORDS.flatMap((row, r) =>
          row.map((words, c) => [{ row: r, column: c, rowSpan: 1, columnSpan: 1 }, words, 'left', '#ffffff']),
        ),
      );
    }
  });
});
