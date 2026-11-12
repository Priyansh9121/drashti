import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { slideElementSchema } from '../../../shared/model-schema';
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
  it('keeps paragraph alignment, bullets, hanging indents and vertical words inside their box', async () => {
    const words = wordsShape(
      '<a:p><a:pPr algn="l" lvl="2" marL="228600" marR="114300" indent="-114300"><a:buChar char="•"/></a:pPr><a:r><a:t>Placeholder bullet</a:t></a:r><a:br/><a:r><a:t>Placeholder continuation</a:t></a:r></a:p>' +
        '<a:p><a:pPr algn="just"><a:buNone/></a:pPr><a:r><a:t>Placeholder justified words</a:t></a:r></a:p>' +
        '<a:p><a:pPr algn="r"><a:buNone/></a:pPr><a:r><a:t>Placeholder aligned right</a:t></a:r></a:p>',
    ).replace('<a:bodyPr ', '<a:bodyPr vert="vert" ');
    const { elements } = await read(slideXml(words));
    const box = elements.find((el) => el.kind === 'text');
    expect(box).toMatchObject({ style: { clipToBox: true, writingMode: 'vertical-rl' } });
    if (box?.kind !== 'text') throw new Error('The editable words are missing.');
    expect(box.runs?.find((run) => run.text === 'Placeholder bullet')).toMatchObject({
      list: 'disc',
      level: 2,
      paragraph: { align: 'left', marginLeft: 24, marginRight: 12, indent: -12, bullet: '•' },
    });
    expect(box.runs?.find((run) => run.softBreak)).toMatchObject({ text: '\n', softBreak: true });
    expect(box.runs?.find((run) => run.text === 'Placeholder justified words')).toMatchObject({
      paragraph: { align: 'justify' },
    });
    expect(box.runs?.find((run) => run.text === 'Placeholder aligned right')).toMatchObject({
      paragraph: { align: 'right' },
    });
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
});
