import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { slideElementSchema } from '../../../shared/model-schema';
import { fitElements } from '../../../shared/slide-size';
import {
  editablePicture,
  editablePptxFixture,
  REL_NS,
  relationshipsXml,
  slideXml,
  wordsShape,
} from '../testing/editable-pptx-fixture';
import { readEditablePptx } from './editable-pptx';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function read(slide: string, parts?: Record<string, string | Buffer>) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-placeholder-fidelity-'));
  roots.push(root);
  const file = join(root, 'Placeholder fidelity.pptx');
  writeFileSync(file, editablePptxFixture({ slides: [slide], parts }));
  const deck = await readEditablePptx(file, join(root, 'prepared'));
  return { ...deck, elements: deck.slides[0]?.elements.map((el) => slideElementSchema.parse(el)) ?? [] };
}

const graphic = (data: string) =>
  '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Placeholder object"/></p:nvGraphicFramePr>' +
  '<p:xfrm><a:off x="95250" y="190500"/><a:ext cx="2857500" cy="857250"/></p:xfrm>' +
  '<a:graphic><a:graphicData>' +
  data +
  '</a:graphicData></a:graphic></p:graphicFrame>';

describe('keeping a generated PPTX editable', () => {
  it('keeps paragraph spacing in points or percentages of the line, with local overrides', async () => {
    const run = (size: number, words: string) =>
      `<a:r><a:rPr sz="${String(size)}"/><a:t>${words}</a:t></a:r>`;
    const words = wordsShape(
      '<a:p><a:pPr><a:spcBef><a:spcPct val="50000"/></a:spcBef><a:spcAft><a:spcPct val="25%"/></a:spcAft></a:pPr>' +
        run(1200, 'Placeholder first run ') +
        run(3000, 'Placeholder large run') +
        '<a:br/>' +
        run(1800, 'Placeholder continuation') +
        '</a:p><a:p><a:pPr><a:spcBef><a:spcPts val="0"/></a:spcBef></a:pPr>' +
        run(2400, 'Placeholder zero before') +
        '</a:p><a:p>' +
        run(2400, 'Placeholder inherited spacing') +
        '</a:p>',
    )
      .replace('<a:bodyPr ', '<a:bodyPr spcFirstLastPara="1" ')
      .replace(
        '<a:lstStyle/>',
        '<a:lstStyle><a:lvl1pPr><a:spcBef><a:spcPts val="600"/></a:spcBef><a:spcAft><a:spcPts val="300"/></a:spcAft></a:lvl1pPr></a:lstStyle>',
      );
    const { elements } = await read(slideXml(words));
    const box = elements.find((el) => el.kind === 'text');
    if (box?.kind !== 'text') throw new Error('The editable words are missing.');
    expect(box.style).toMatchObject({ spaceAtTextEdges: true });
    const paragraph = (text: string) => box.runs?.find((run) => run.text === text)?.paragraph;
    // Percentages of the line (PF-12): the first line's 30 pt (40 px) a line of 48 px, the last's 18 pt (24 px) 28.8.
    expect(paragraph('Placeholder first run ')).toMatchObject({ spaceBefore: 24, spaceAfter: 7.2 });
    expect(paragraph('Placeholder continuation')).toEqual(paragraph('Placeholder first run '));
    expect(paragraph('Placeholder zero before')).toMatchObject({ spaceBefore: 0, spaceAfter: 4 });
    expect(paragraph('Placeholder inherited spacing')).toMatchObject({ spaceBefore: 8, spaceAfter: 4 });
    const [resized] = fitElements([box], { width: 1280, height: 720 }, { width: 640, height: 360 });
    if (resized?.kind !== 'text') throw new Error('The resized words are missing.');
    expect(resized.runs?.[0]?.paragraph).toMatchObject({ spaceBefore: 12, spaceAfter: 3.6 });
  });

  it('takes a percentage of paragraph spacing as a share of the line, as PowerPoint does (PF-12, measured 14 Nov 2026)', async () => {
    // PowerPoint's own stills: 40 pt Arial lines 48 pt apart, and 100% before adds 48 pt (a line), not 40 (the size).
    const paragraph = (props: string, words: string) =>
      `<a:p><a:pPr>${props}</a:pPr><a:r><a:rPr sz="4000"/><a:t>${words}</a:t></a:r></a:p>`;
    const words = wordsShape(
      paragraph('<a:spcBef><a:spcPct val="100000"/></a:spcBef>', 'Placeholder a line before') +
        paragraph(
          '<a:spcBef><a:spcPct val="50000"/></a:spcBef><a:spcAft><a:spcPct val="100000"/></a:spcAft>',
          'Placeholder half before, a line after',
        ) +
        paragraph('<a:spcBef><a:spcPts val="2400"/></a:spcBef>', 'Placeholder points before') +
        paragraph(
          '<a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="100000"/></a:spcBef>',
          'Placeholder closer lines',
        ) +
        paragraph(
          '<a:lnSpc><a:spcPts val="3600"/></a:lnSpc><a:spcBef><a:spcPct val="50000"/></a:spcBef>',
          'Placeholder exact lines',
        ) +
        paragraph(
          '<a:lnSpc><a:spcPct val="150000"/></a:lnSpc><a:spcBef><a:spcPct val="100000"/></a:spcBef>',
          'Placeholder wider lines',
        ),
    );
    const { elements } = await read(slideXml(words));
    const box = elements.find((el) => el.kind === 'text');
    if (box?.kind !== 'text') throw new Error('The editable words are missing.');
    const spacing = (text: string) => box.runs?.find((run) => run.text === text)?.paragraph;
    // 40 pt is 53.33 px of the slide; its line, 1.2 of it, 64 px.
    expect(spacing('Placeholder a line before')?.spaceBefore).toBe(64);
    expect(spacing('Placeholder half before, a line after')).toMatchObject({
      spaceBefore: 32,
      spaceAfter: 64,
    });
    // Points stay points: 24 pt is 32 px.
    expect(spacing('Placeholder points before')?.spaceBefore).toBe(32);
    // Whatever the paragraph's own line spacing, a share of a SINGLE line (PowerPoint's own PDF and movie, h-pptx3's
    // run 5, 14 Nov 2026: 40 pt words with lines 150% or 80% and 100% before, 48 pt; lines exactly 36 pt and 50%
    // before, 24 pt): 64 px for 90% lines and for 150%, 32 px for exactly 36 pt.
    expect(spacing('Placeholder closer lines')?.spaceBefore).toBe(64);
    expect(spacing('Placeholder exact lines')?.spaceBefore).toBe(32);
    expect(spacing('Placeholder wider lines')?.spaceBefore).toBe(64);
  });

  it('keeps fixed line spacing in slide pixels and permits a proportional override', async () => {
    const words = wordsShape(
      '<a:p><a:r><a:rPr sz="1200"/><a:t>Placeholder fixed line</a:t></a:r></a:p>' +
        '<a:p><a:pPr><a:lnSpc><a:spcPct val="90000"/></a:lnSpc></a:pPr>' +
        '<a:r><a:rPr sz="3000"/><a:t>Placeholder proportional line</a:t></a:r></a:p>',
    ).replace(
      '<a:lstStyle/>',
      '<a:lstStyle><a:lvl1pPr><a:lnSpc><a:spcPts val="1800"/></a:lnSpc></a:lvl1pPr></a:lstStyle>',
    );
    const { elements } = await read(slideXml(words));
    const box = elements.find((el) => el.kind === 'text');
    if (box?.kind !== 'text') throw new Error('The editable words are missing.');
    expect(box.runs?.find((run) => run.text === 'Placeholder fixed line')?.paragraph).toMatchObject({
      lineHeightPx: 24,
    });
    const proportional = box.runs?.find((run) => run.text === 'Placeholder proportional line')?.paragraph;
    expect(proportional).toMatchObject({ lineHeight: 1.08 });
    expect(proportional).not.toHaveProperty('lineHeightPx');
    const [resized] = fitElements([box], { width: 1280, height: 720 }, { width: 640, height: 360 });
    if (resized?.kind !== 'text') throw new Error('The resized words are missing.');
    expect(resized.runs?.[0]?.paragraph).toMatchObject({ lineHeightPx: 12 });
  });

  it('keeps paragraph alignment, bullets, hanging indents and vertical words inside their box', async () => {
    const words = wordsShape(
      '<a:p><a:pPr algn="l" lvl="2" marL="228600" marR="114300" indent="-114300"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:buChar char="•"/></a:pPr><a:r><a:t>Placeholder bullet</a:t></a:r><a:br/><a:r><a:t>Placeholder continuation</a:t></a:r></a:p>' +
        '<a:p><a:pPr algn="just"><a:buNone/></a:pPr><a:r><a:t>Placeholder justified words</a:t></a:r></a:p>' +
        '<a:p><a:pPr algn="r"><a:buNone/></a:pPr><a:r><a:t>Placeholder aligned right</a:t></a:r></a:p>',
    ).replace('<a:bodyPr ', '<a:bodyPr vert="vert" ');
    const { elements } = await read(slideXml(words));
    const box = elements.find((el) => el.kind === 'text');
    expect(box).toMatchObject({ style: { shrinkToFit: true, writingMode: 'vertical-rl' } });
    expect(box).not.toMatchObject({ style: { clipToBox: true } });
    if (box?.kind !== 'text') throw new Error('The editable words are missing.');
    expect(box.runs?.find((run) => run.text === 'Placeholder bullet')).toMatchObject({
      list: 'disc',
      level: 2,
      paragraph: {
        align: 'left',
        marginLeft: 24,
        marginRight: 12,
        indent: -12,
        lineHeight: 1.08,
        bullet: '•',
      },
    });
    expect(box.runs?.find((run) => run.softBreak)).toMatchObject({ text: '\n', softBreak: true });
    expect(box.runs?.find((run) => run.text === 'Placeholder justified words')).toMatchObject({
      paragraph: { align: 'justify' },
    });
    expect(box.runs?.find((run) => run.text === 'Placeholder aligned right')).toMatchObject({
      paragraph: { align: 'right' },
    });
  });

  it('fits source text and table cells unless PowerPoint explicitly clips the box', async () => {
    const words = '<a:p><a:r><a:t>Placeholder words to fit</a:t></a:r></a:p>';
    const auto = wordsShape(words).replace('bIns="0"/>', 'bIns="0" wrap="none"><a:spAutoFit/></a:bodyPr>');
    const clipped = wordsShape(words)
      .replace('id="2"', 'id="3"')
      .replace('<a:bodyPr ', '<a:bodyPr vertOverflow="clip" ');
    const table = graphic(
      '<a:tbl><a:tblGrid><a:gridCol w="952500"/></a:tblGrid><a:tr h="285750">' +
        '<a:tc><a:txBody><a:bodyPr/>' +
        words +
        '</a:txBody><a:tcPr/></a:tc>' +
        '</a:tr></a:tbl>',
    );
    const { elements } = await read(slideXml(auto + clipped + table));
    const box = elements.find((el) => el.kind === 'text' && el.sourceShapeId === '2');
    const explicit = elements.find((el) => el.kind === 'text' && el.sourceShapeId === '3');
    const cell = elements.find((el) => el.kind === 'text' && el.tableCell);
    expect(box).toMatchObject({ style: { shrinkToFit: true, noWrap: true } });
    expect(box).not.toMatchObject({ style: { clipToBox: true } });
    expect(cell).toMatchObject({ style: { shrinkToFit: true } });
    expect(cell).not.toMatchObject({ style: { clipToBox: true } });
    expect(explicit).toMatchObject({ style: { clipToBox: true } });
    expect(explicit).not.toMatchObject({ style: { shrinkToFit: true } });
  });

  it('keeps a background picture, clipped picture fill and all gradient stops as slide objects', async () => {
    const fill = '<a:blipFill><a:blip r:embed="rFill"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>';
    const picture = wordsShape('')
      .replace('id="2"', 'id="17"')
      .replace('</p:spPr>', '<a:prstGeom prst="ellipse"/>' + fill + '</p:spPr>');
    const gradient = wordsShape('').replace(
      '</p:spPr>',
      '<a:prstGeom prst="rect"/><a:gradFill><a:gsLst>' +
        '<a:gs pos="0"><a:srgbClr val="112233"/></a:gs>' +
        '<a:gs pos="30000"><a:srgbClr val="345678"/></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="8899AA"/></a:gs>' +
        '</a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill></p:spPr>',
    );
    const { elements, media } = await read(
      slideXml(picture + gradient).replace('<p:cSld>', '<p:cSld><p:bg><p:bgPr>' + fill + '</p:bgPr></p:bg>'),
      {
        'ppt/media/generated.png': editablePicture(),
        'ppt/slides/_rels/slide1.xml.rels': relationshipsXml(
          '<Relationship Id="rFill" Type="' + REL_NS + '/image" Target="../media/generated.png"/>',
        ),
      },
    );
    expect(media).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      kind: 'image',
      frame: { x: 0, y: 0, width: 1280, height: 720 },
      mediaId: 'media-ref:0',
    });
    expect(elements).toContainEqual(
      expect.objectContaining({
        kind: 'image',
        sourceShapeId: '17',
        pictureClip: { shape: 'ellipse' },
        mediaId: 'media-ref:0',
      }),
    );
    expect(elements).toContainEqual(
      expect.objectContaining({
        kind: 'shape',
        sourceShapeId: '2',
        gradient: {
          kind: 'linear',
          angle: 90,
          stops: [
            { offset: 0, color: '#112233' },
            { offset: 0.3, color: '#345678' },
            { offset: 1, color: '#8899aa' },
          ],
        },
      }),
    );
  });

  it('keeps only painted table edges and joins their corner with both stroke widths', async () => {
    const { elements } = await read(
      slideXml(
        graphic(
          '<a:tbl><a:tblGrid><a:gridCol w="2857500"/></a:tblGrid><a:tr h="857250"><a:tc>' +
            '<a:txBody><a:bodyPr/><a:p><a:r><a:t>Placeholder cell</a:t></a:r></a:p></a:txBody>' +
            '<a:tcPr><a:lnT><a:noFill/></a:lnT>' +
            '<a:lnL w="19050"><a:solidFill><a:srgbClr val="AA2244"/></a:solidFill></a:lnL>' +
            '<a:lnB w="38100"><a:solidFill><a:srgbClr val="22AA44"/></a:solidFill></a:lnB>' +
            '</a:tcPr></a:tc></a:tr></a:tbl>',
        ),
      ),
    );
    expect(elements.filter((element) => element.kind === 'shape')).toMatchObject([
      {
        shape: 'line',
        rotation: 90,
        frame: { x: -36, y: 65.5, width: 92, height: 1 },
        outline: { color: '#aa2244', width: 2 },
      },
      {
        shape: 'line',
        rotation: 0,
        frame: { x: 9, y: 109.5, width: 301, height: 1 },
        outline: { color: '#22aa44', width: 4 },
      },
    ]);
  });

  it('grows a border’s end only at a true corner, not where another border crosses or carries it on', async () => {
    const side = (name: string, color = '000000') =>
      `<a:${name} w="38100"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:${name}>`;
    const cell = (top = '000000') =>
      '<a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr>' +
      side('lnL') +
      side('lnR') +
      side('lnT', top) +
      side('lnB') +
      '</a:tcPr></a:tc>';
    const { elements } = await read(
      slideXml(
        graphic(
          '<a:tbl><a:tblGrid><a:gridCol w="1428750"/><a:gridCol w="1428750"/></a:tblGrid>' +
            '<a:tr h="428625">' +
            cell() +
            cell('2244AA') +
            '</a:tr><a:tr h="428625">' +
            cell() +
            cell() +
            '</a:tr></a:tbl>',
        ),
      ),
    );
    const lines = elements.filter((el) => el.kind === 'shape' && el.shape === 'line');
    // 4 px borders on a 300 × 90 table at (10, 20): an outer corner squares off by 2 px each way; a T-junction, a
    // crossing and a run carried on in another colour don't grow (a see-through border would paint there twice).
    expect(lines.map((el) => [el.rotation, el.frame.x, el.frame.y, el.frame.width])).toEqual([
      [90, -37, 64.5, 94],
      [90, 115, 64.5, 90],
      [90, 263, 64.5, 94],
      [0, 8, 19.5, 152],
      [0, 160, 19.5, 152],
      [0, 10, 64.5, 300],
      [0, 8, 109.5, 304],
    ]);
    expect(lines.map((el) => (el.kind === 'shape' ? el.outline?.color : undefined))).toEqual([
      '#000000',
      '#000000',
      '#000000',
      '#000000',
      '#2244aa',
      '#000000',
      '#000000',
    ]);
  });

  it('applies table style tints and shades in linear light', async () => {
    const part = (name: string, effect: string, value: number) =>
      `<a:${name}><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="4472C4"><a:${effect} val="${String(value)}"/></a:srgbClr></a:solidFill></a:fill></a:tcStyle></a:${name}>`;
    const style =
      '<a:tableStyle styleId="{01234567-89AB-CDEF-0123-456789ABCDEF}" styleName="Placeholder">' +
      part('wholeTbl', 'tint', 20_000) +
      part('band1H', 'tint', 40_000) +
      part('band2H', 'shade', 40_000) +
      '</a:tableStyle>';
    const row = '<a:tr h="285750"><a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc></a:tr>';
    const { elements } = await read(
      slideXml(
        graphic(
          '<a:tbl><a:tblPr firstRow="1" bandRow="1">' +
            style +
            '</a:tblPr><a:tblGrid><a:gridCol w="2857500"/></a:tblGrid>' +
            row.repeat(3) +
            '</a:tbl>',
        ),
      ),
    );
    expect(elements.flatMap((el) => (el.kind === 'shape' ? [el.fill] : []))).toEqual([
      '#e9ebf5',
      '#cfd5ea',
      '#2a4981',
    ]);
  });

  it('applies the referenced table style, conditional parts and explicit cell overrides', async () => {
    const styleId = '{01234567-89AB-CDEF-0123-456789ABCDEF}';
    const solid = (value: string, kind = 'srgbClr') =>
      `<a:solidFill><a:${kind} val="${value}"/></a:solidFill>`;
    const fill = (value: string, kind?: string) => '<a:fill>' + solid(value, kind) + '</a:fill>';
    const stroke = (tag: string, width: number, value: string) =>
      `<a:${tag}><a:ln w="${String(width * 9525)}">${solid(value)}</a:ln></a:${tag}>`;
    const part = (name: string, paint: string, border = '', text = '') =>
      `<a:${name}>${text}<a:tcStyle>${border ? `<a:tcBdr>${border}</a:tcBdr>` : ''}${paint}</a:tcStyle></a:${name}>`;
    const style =
      '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="' +
      styleId +
      '"><a:tblStyle styleId="' +
      styleId +
      '" styleName="Placeholder">' +
      part(
        'wholeTbl',
        fill('EEEEEE'),
        '<a:left><a:lnRef idx="1"><a:srgbClr val="334455"/></a:lnRef></a:left>' +
          stroke('insideV', 2, '556677'),
      ) +
      part('band1H', fill('accent1', 'schemeClr')) +
      part('band2H', '<a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef>') +
      part('firstCol', '', stroke('right', 3, '663311')) +
      part('firstRow', fill('225577'), '', '<a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle>') +
      part('nwCell', fill('113355')) +
      '</a:tblStyle></a:tblStyleLst>';
    const cell = (words: string, props = '', runProps = '') =>
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>${runProps}<a:t>Placeholder ${words}</a:t></a:r></a:p></a:txBody><a:tcPr>${props}</a:tcPr></a:tc>`;
    const row = (cells: string) => '<a:tr h="285750">' + cells + '</a:tr>';
    const table =
      '<a:tbl><a:tblPr firstRow="1" firstCol="1" bandRow="1"><a:tableStyleId>' +
      styleId.toLowerCase() +
      '</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="952500"/><a:gridCol w="1905000"/></a:tblGrid>' +
      row(cell('corner') + cell('heading', solid('664488'), '<a:rPr b="0">' + solid('FEDCBA') + '</a:rPr>')) +
      row(cell('band one') + cell('direct transparent', '<a:noFill/>')) +
      row(cell('band two') + cell('band two right')) +
      '</a:tbl>';
    const { elements } = await read(slideXml(graphic(table)), {
      'ppt/_rels/presentation.xml.rels': relationshipsXml(
        `<Relationship Id="rId1" Type="${REL_NS}/slide" Target="slides/slide1.xml"/>` +
          `<Relationship Id="rIdStyle" Type="${REL_NS}/tableStyles" Target="tableStyles.xml"/>`,
      ),
      'ppt/tableStyles.xml': style,
      'ppt/theme/theme1.xml':
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Placeholder"><a:themeElements>' +
        '<a:clrScheme name="Placeholder"><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="AA2244"/></a:accent1>' +
        '<a:accent2><a:srgbClr val="22BB44"/></a:accent2></a:clrScheme><a:fmtScheme name="Placeholder">' +
        '<a:fillStyleLst>' +
        solid('phClr', 'schemeClr') +
        '</a:fillStyleLst><a:lnStyleLst>' +
        '<a:ln w="9525">' +
        solid('phClr', 'schemeClr') +
        '</a:ln></a:lnStyleLst></a:fmtScheme></a:themeElements></a:theme>',
    });
    const fills = elements.flatMap((el) => (el.kind === 'shape' && el.shape !== 'line' ? [el.fill] : []));
    expect(fills).toEqual(['#113355', '#664488', '#aa2244', '#22bb44', '#22bb44']);
    const text = (words: string) =>
      elements.find((el) => el.kind === 'text' && el.text === 'Placeholder ' + words);
    expect(text('corner')).toMatchObject({ runs: [{ color: '#ffffff', weight: 700 }] });
    expect(text('heading')).toMatchObject({ runs: [{ color: '#fedcba', weight: 400 }] });
    const borders = elements.filter((el) => el.kind === 'shape' && el.shape === 'line');
    expect(borders).toMatchObject([
      { outline: { color: '#334455', width: 1 } },
      { outline: { color: '#663311', width: 3 } },
    ]);
  });

  it('keeps unequal table cells, spanning and empty cells editable as one group', async () => {
    const cell = (words: string, props = '') =>
      '<a:tc ' +
      props +
      '><a:txBody><a:bodyPr/><a:p><a:r><a:t>' +
      words +
      '</a:t></a:r></a:p></a:txBody>' +
      '<a:tcPr marL="0" marR="0" marT="0" marB="0"><a:solidFill><a:srgbClr val="224466"/></a:solidFill></a:tcPr></a:tc>';
    const { elements } = await read(
      slideXml(
        graphic(
          '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="952500"/><a:gridCol w="1905000"/></a:tblGrid>' +
            '<a:tr h="285750">' +
            cell('Placeholder heading', 'gridSpan="2"') +
            cell('', 'hMerge="1"') +
            '</a:tr><a:tr h="571500">' +
            cell('') +
            cell('Placeholder value') +
            '</a:tr></a:tbl>',
        ),
      ),
    );
    const cells = elements.filter((el) => el.kind === 'text');
    expect(cells).toMatchObject([
      {
        text: 'Placeholder heading',
        sourceShapeId: '7',
        tableCell: { row: 0, column: 0, rowSpan: 1, columnSpan: 2 },
        frame: { x: 10, y: 20, width: 300, height: 30 },
      },
      {
        text: '',
        sourceShapeId: '7',
        tableCell: { row: 1, column: 0, rowSpan: 1, columnSpan: 1 },
        frame: { x: 10, y: 50, width: 100, height: 60 },
      },
      {
        text: 'Placeholder value',
        sourceShapeId: '7',
        tableCell: { row: 1, column: 1, rowSpan: 1, columnSpan: 1 },
        frame: { x: 110, y: 50, width: 200, height: 60 },
      },
    ]);
    expect(cells[0]?.groupId).toBeTruthy();
    expect(elements.every((el) => el.groupId === cells[0]?.groupId)).toBe(true);
    expect(elements.filter((el) => el.kind === 'shape')).toHaveLength(3);
  });

  it('keeps a broken chart as a bounded picture between the remaining editable objects', async () => {
    const { elements } = await read(
      slideXml(
        wordsShape('<a:p><a:r><a:t>Placeholder before</a:t></a:r></a:p>') +
          graphic('<c:chart xmlns:c="c" r:id="rChart"/>') +
          wordsShape('<a:p><a:r><a:t>Placeholder after</a:t></a:r></a:p>').replace('id="2"', 'id="8"'),
      ),
      {
        'ppt/charts/chart1.xml': '<c:chartSpace xmlns:c="c"><broken',
        'ppt/slides/_rels/slide1.xml.rels': relationshipsXml(
          '<Relationship Id="rChart" Type="' + REL_NS + '/chart" Target="../charts/chart1.xml"/>',
        ),
      },
    );
    expect(elements).toMatchObject([
      { kind: 'text', text: 'Placeholder before' },
      {
        kind: 'image',
        sourceShapeId: '7',
        mediaId: 'retained-slide-picture',
        frame: { x: 10, y: 20, width: 300, height: 90 },
      },
      { kind: 'text', text: 'Placeholder after' },
    ]);
    expect(elements[1]?.kind === 'image' ? elements[1].crop : undefined).toEqual({
      x: 10 / 1280,
      y: 20 / 720,
      width: 300 / 1280,
      height: 90 / 720,
    });
  });

  it('draws a shared table edge once across a spanning cell', async () => {
    const paint = '<a:solidFill><a:srgbClr val="AA2244"/></a:solidFill>';
    const cell = (attributes: string, edge: string) =>
      '<a:tc ' +
      attributes +
      '><a:txBody><a:bodyPr/><a:p><a:r><a:t>Placeholder</a:t></a:r></a:p>' +
      '</a:txBody><a:tcPr>' +
      edge +
      '</a:tcPr></a:tc>';
    const { elements } = await read(
      slideXml(
        graphic(
          '<a:tbl><a:tblGrid><a:gridCol w="100"/><a:gridCol w="100"/></a:tblGrid>' +
            '<a:tr h="100">' +
            cell('rowSpan="2"', '<a:lnR>' + paint + '</a:lnR>') +
            cell('', '<a:lnL>' + paint + '</a:lnL>') +
            '</a:tr><a:tr h="100">' +
            cell('vMerge="1"', '') +
            cell('', '<a:lnL>' + paint + '</a:lnL>') +
            '</a:tr></a:tbl>',
        ),
      ),
    );
    expect(elements.filter((element) => element.kind === 'shape')).toMatchObject([
      {
        shape: 'line',
        frame: { width: 90, height: 1 },
        rotation: 90,
        outline: { color: '#aa2244', width: 1 },
      },
    ]);
  });

  it('returns the limit note when the only source page is over the object cap', async () => {
    const words = wordsShape('<a:p><a:r><a:t>Placeholder words</a:t></a:r></a:p>');
    await expect(read(slideXml(words.repeat(501)))).resolves.toMatchObject({
      sourceCount: 1,
      slides: [],
      failedNotes: {
        0: ['Page 1 of the original has more than 500 objects, so it stays as its saved picture.'],
      },
    });
  });

  it('keeps a table within the remaining object budget and isolates an over-limit slide', async () => {
    const root = mkdtempSync(join(tmpdir(), 'drashti-placeholder-table-cap-'));
    roots.push(root);
    const file = join(root, 'Placeholder table limits.pptx');
    const words = wordsShape('<a:p><a:r><a:t>Placeholder readable words</a:t></a:r></a:p>');
    const cell = '<a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc>';
    const table = graphic(
      '<a:tbl><a:tblGrid><a:gridCol w="100"/><a:gridCol w="100"/></a:tblGrid><a:tr h="100">' +
        cell.repeat(2) +
        '</a:tr></a:tbl>',
    );
    writeFileSync(
      file,
      editablePptxFixture({
        slides: [slideXml(words.repeat(499) + table), slideXml(words.repeat(501)), slideXml(words)],
      }),
    );
    const deck = await readEditablePptx(file, join(root, 'prepared'));
    expect(deck.sourceCount).toBe(3);
    expect(deck.slides.map((slide) => slide.sourceIndex)).toEqual([0, 2]);
    expect(deck).toMatchObject({
      failedNotes: {
        1: ['Page 2 of the original has more than 500 objects, so it stays as its saved picture.'],
      },
    });
    expect(deck.slides[0]?.elements).toHaveLength(500);
    expect(deck.slides[0]?.elements.at(-1)).toMatchObject({ kind: 'image', crop: { width: 300 / 1280 } });
    expect(deck.slides[1]?.elements).toMatchObject([{ kind: 'text', text: 'Placeholder readable words' }]);
  });

  it('reads the other slides when a single source slide is damaged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'drashti-placeholder-partial-deck-'));
    roots.push(root);
    const file = join(root, 'Placeholder partial deck.pptx');
    writeFileSync(
      file,
      editablePptxFixture({
        slides: [
          '<p:sld xmlns:p="p"><broken',
          slideXml(wordsShape('<a:p><a:r><a:t>Placeholder readable slide</a:t></a:r></a:p>')),
        ],
      }),
    );
    const deck = await readEditablePptx(file, join(root, 'prepared'));
    expect(deck.sourceCount).toBe(2);
    expect(deck.slides).toMatchObject([
      { sourceIndex: 1, elements: [{ kind: 'text', text: 'Placeholder readable slide' }] },
    ]);
  });

  it('keeps local objects editable when an inherited layout part is unreadable', async () => {
    const { slides, elements } = await read(
      slideXml(wordsShape('<a:p><a:r><a:t>Placeholder standalone words</a:t></a:r></a:p>')),
      { 'ppt/slideLayouts/slideLayout1.xml': '<p:sldLayout xmlns:p="p"><broken' },
    );
    expect(elements).toMatchObject([{ kind: 'text', text: 'Placeholder standalone words' }]);
    expect(slides[0]?.issues.join(' ')).toMatch(/layout/u);
  });

  it('keeps a chart’s source ID on its embedded compatibility picture', async () => {
    const chartNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
    const chart = graphic('<c:chart r:id="rChart"/>')
      .replace('<a:graphicData>', '<a:graphicData uri="' + chartNamespace + '">')
      .replace('</p:nvGraphicFramePr>', '<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>');
    const preview =
      '<p:pic><p:nvPicPr><p:cNvPr id="42" name="Placeholder preview"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="rPreview"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr><a:xfrm><a:off x="95250" y="190500"/><a:ext cx="2857500" cy="857250"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    const alternate =
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:c="' +
      chartNamespace +
      '"><mc:Choice Requires="c">' +
      chart +
      '</mc:Choice><mc:Fallback>' +
      preview +
      '</mc:Fallback></mc:AlternateContent>';
    const { elements, media } = await read(slideXml(alternate), {
      'ppt/charts/chart1.xml': '<c:chartSpace xmlns:c="' + chartNamespace + '"><c:chart/></c:chartSpace>',
      'ppt/media/placeholder-preview.png': editablePicture(),
      'ppt/slides/_rels/slide1.xml.rels': relationshipsXml(
        '<Relationship Id="rChart" Type="' +
          REL_NS +
          '/chart" Target="../charts/chart1.xml"/><Relationship Id="rPreview" Type="' +
          REL_NS +
          '/image" Target="../media/placeholder-preview.png"/>',
      ),
    });

    expect(media).toHaveLength(1);
    expect(elements).toMatchObject([
      {
        kind: 'image',
        mediaId: 'media-ref:0',
        sourceShapeId: '7',
        name: 'Placeholder object',
        frame: { x: 10, y: 20, width: 300, height: 90 },
      },
    ]);
  });
});
