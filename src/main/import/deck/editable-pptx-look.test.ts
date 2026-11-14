import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SlideElement } from '../../../shared/model';
import { slideElementSchema } from '../../../shared/model-schema';
import {
  editablePicture,
  editablePptxFixture,
  REL_NS,
  relationshipsXml,
  slideXml,
} from '../testing/editable-pptx-fixture';
import { readEditablePptx } from './editable-pptx';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function folder() {
  const root = mkdtempSync(join(tmpdir(), 'drashti-placeholder-look-'));
  roots.push(root);
  return root;
}

describe('a deck with more pictures than Drashti edits at once', () => {
  /** A generated picture of the given size in bytes: a valid 1 × 1 PNG with room after its end. */
  const picture = (bytes: number) => {
    const png = editablePicture();
    return Buffer.concat([png, Buffer.alloc(bytes - png.length)]);
  };
  const pictureObject =
    '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Placeholder picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rPicture"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    '<p:spPr><a:xfrm><a:off x="95250" y="190500"/><a:ext cx="952500" cy="952500"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></p:spPr></p:pic>';
  const pictureRels = (name: string) =>
    relationshipsXml(
      `<Relationship Id="rId1" Type="${REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        `<Relationship Id="rPicture" Type="${REL_NS}/image" Target="../media/${name}.png"/>`,
    );

  it('keeps the pages whose pictures fit, in deck order, and leaves the rest as their saved pictures', async () => {
    const root = folder();
    const file = join(root, 'Placeholder pictures.pptx');
    // Pages 1-5 use pictures a, b, c, d and a again; the budget holds 2,500 bytes: a + b, then c doesn't fit, d does.
    const uses = ['a', 'b', 'c', 'd', 'a'];
    writeFileSync(
      file,
      editablePptxFixture({
        slides: uses.map(() => slideXml(pictureObject)),
        parts: {
          'ppt/media/a.png': picture(1000),
          'ppt/media/b.png': picture(1000),
          'ppt/media/c.png': picture(1000),
          'ppt/media/d.png': picture(400),
          ...Object.fromEntries(
            uses.map((name, i) => [`ppt/slides/_rels/slide${String(i + 1)}.xml.rels`, pictureRels(name)]),
          ),
        },
      }),
    );
    const deck = await readEditablePptx(file, join(root, 'prepared'), { pictureBytes: 2500 });
    expect(deck.sourceCount).toBe(5);
    expect(deck.slides.map((slide) => slide.sourceIndex)).toEqual([0, 1, 3, 4]);
    expect(deck.failedNotes).toEqual({
      2: [
        'Page 3 of the original stays as its saved picture: its pictures go past the 128 MB of pictures Drashti can edit in one deck.',
      ],
    });
    expect(deck.media).toHaveLength(3);
    expect(deck.slides.map((slide) => slide.elements.map((el) => el.kind === 'image' && el.mediaId))).toEqual(
      [['media-ref:0'], ['media-ref:1'], ['media-ref:2'], ['media-ref:0']],
    );
  });

  it('still reads a deck whose pictures all fit, with no note', async () => {
    const root = folder();
    const file = join(root, 'Placeholder pictures that fit.pptx');
    writeFileSync(
      file,
      editablePptxFixture({
        slides: [slideXml(pictureObject), slideXml(pictureObject)],
        parts: {
          'ppt/media/a.png': picture(1000),
          'ppt/media/b.png': picture(1000),
          'ppt/slides/_rels/slide1.xml.rels': pictureRels('a'),
          'ppt/slides/_rels/slide2.xml.rels': pictureRels('b'),
        },
      }),
    );
    const deck = await readEditablePptx(file, join(root, 'prepared'), { pictureBytes: 2000 });
    expect(deck.slides.map((slide) => slide.sourceIndex)).toEqual([0, 1]);
    expect(deck).not.toHaveProperty('failedNotes');
    expect(deck.media).toHaveLength(2);
  });
});

/** An Office theme (2013 and later): its colours, and its fill, line and background styles. */
const OFFICE_COLORS = [
  ['dk1', '000000'],
  ['lt1', 'FFFFFF'],
  ['dk2', '44546A'],
  ['lt2', 'E7E6E6'],
  ['accent1', '4472C4'],
  ['accent2', 'ED7D31'],
  ['accent3', 'A5A5A5'],
  ['accent4', 'FFC000'],
  ['accent5', '5B9BD5'],
  ['accent6', '70AD47'],
] as const;
const stop = (at: number, changes: string) =>
  `<a:gs pos="${String(at)}"><a:schemeClr val="phClr">${changes}</a:schemeClr></a:gs>`;
const change = (name: string, value: number) => `<a:${name} val="${String(value)}"/>`;
const gradient = (stops: string) =>
  `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>`;
const OFFICE_THEME =
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Placeholder Office"><a:themeElements>' +
  '<a:clrScheme name="Placeholder">' +
  OFFICE_COLORS.map(([name, value]) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`).join('') +
  '</a:clrScheme><a:fontScheme name="Placeholder"><a:majorFont><a:latin typeface="Placeholder Heading"/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Placeholder Sans"/></a:minorFont></a:fontScheme><a:fmtScheme name="Placeholder">' +
  '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  gradient(
    stop(0, change('lumMod', 110_000) + change('satMod', 105_000) + change('tint', 67_000)) +
      stop(50_000, change('lumMod', 105_000) + change('satMod', 103_000) + change('tint', 73_000)) +
      stop(100_000, change('lumMod', 105_000) + change('satMod', 109_000) + change('tint', 81_000)),
  ) +
  gradient(
    stop(0, change('satMod', 103_000) + change('lumMod', 102_000) + change('tint', 94_000)) +
      stop(50_000, change('satMod', 110_000) + change('lumMod', 100_000) + change('shade', 100_000)) +
      stop(100_000, change('lumMod', 99_000) + change('satMod', 120_000) + change('shade', 78_000)),
  ) +
  '</a:fillStyleLst><a:lnStyleLst>' +
  [6350, 12700, 19050]
    .map((w) => `<a:ln w="${String(w)}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`)
    .join('') +
  '</a:lnStyleLst><a:bgFillStyleLst><a:solidFill><a:srgbClr val="AA0000"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  gradient(stop(0, '') + stop(100_000, change('shade', 50_000))) +
  '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

const BOX =
  '<a:xfrm><a:off x="95250" y="190500"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/>';
const shape = (id: number, props: string, style = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="Placeholder swatch ${String(id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${BOX}${props}</p:spPr>${style}</p:sp>`;
async function readSlide(slide: string, parts: Record<string, string | Buffer> = {}) {
  const root = folder();
  const file = join(root, 'Placeholder look.pptx');
  writeFileSync(
    file,
    editablePptxFixture({ slides: [slide], parts: { 'ppt/theme/theme1.xml': OFFICE_THEME, ...parts } }),
  );
  const deck = await readEditablePptx(file, join(root, 'prepared'));
  const page = deck.slides[0];
  return {
    elements: page?.elements.map((el) => slideElementSchema.parse(el)) ?? [],
    issues: page?.issues ?? [],
  };
}

describe('PowerPoint’s colour changes', () => {
  it('draws lumMod, lumOff and satMod in HSL, as PowerPoint’s theme colour shades are', async () => {
    const swatch = (id: number, changes: string) =>
      shape(id, `<a:solidFill><a:schemeClr val="accent1">${changes}</a:schemeClr></a:solidFill>`);
    const { elements, issues } = await readSlide(
      slideXml(
        swatch(10, change('lumMod', 75_000)) +
          swatch(11, change('lumMod', 60_000) + change('lumOff', 40_000)) +
          swatch(12, change('lumMod', 20_000) + change('lumOff', 80_000)) +
          swatch(13, change('satMod', 50_000)) +
          swatch(14, change('satMod', 150_000)) +
          swatch(15, change('lumOff', -25_000)),
      ),
    );
    // PowerPoint's Accent 1 Darker 25%, Lighter 40% and Lighter 80% of the Office theme's 4472C4, then saturation
    // halved and raised by half, and a negative lightness offset (each in HSL, worked out by hand).
    expect(elements.map((el) => el.kind === 'shape' && el.fill)).toEqual([
      '#2f5597',
      '#8faadc',
      '#dae3f3',
      '#647ba4',
      '#2469e4',
      '#213a68',
    ]);
    expect(issues).not.toContain('Some source colour adjustments are not reproduced.');
  });

  it('still names a colour change it doesn’t draw', async () => {
    const { elements, issues } = await readSlide(
      slideXml(
        shape(
          10,
          `<a:solidFill><a:schemeClr val="accent1">${change('hueOff', 600_000)}</a:schemeClr></a:solidFill>`,
        ),
      ),
    );
    expect(elements).toMatchObject([{ kind: 'shape', fill: '#4472c4' }]);
    expect(issues).toContain('Some source colour adjustments are not reproduced.');
  });
});

describe('a shape’s and a table’s theme styles', () => {
  const fillStyle = (index: number) =>
    `<p:style><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="${String(index)}"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>`;
  const outlined = '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>';

  it('fills a shape from its theme’s fill style, a gradient too, as PowerPoint’s shape styles do', async () => {
    const { elements } = await readSlide(
      slideXml(
        shape(20, outlined, fillStyle(0)) +
          shape(21, '', fillStyle(1)) +
          shape(22, '', fillStyle(2)) +
          shape(23, '', fillStyle(3)) +
          shape(24, '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>', fillStyle(3)),
      ),
    );
    const linear = (colors: string[]) => ({
      kind: 'linear',
      angle: 90,
      stops: colors.map((color, i) => ({ offset: i / 2, color })),
    });
    expect(elements.map((el) => (el.kind === 'shape' ? [el.fill, el.gradient ?? null] : el.kind))).toEqual([
      [null, null],
      ['#4472c4', null],
      // The Office theme's two gradients from accent 1, each stop's lumMod and satMod in HSL, its tint or shade in
      // linear light (worked out by hand).
      ['#a8b7df', linear(['#a8b7df', '#9aabd9', '#879ed7'])],
      ['#6083cb', linear(['#6083cb', '#3e70ca', '#2e61ba'])],
      ['#123456', null],
    ]);
  });

  it('keeps a shape’s reference colour when its theme has no fill styles, with no note', async () => {
    const { elements, issues } = await readSlide(slideXml(shape(21, '', fillStyle(3))), {
      'ppt/theme/theme1.xml': OFFICE_THEME.replace(/<a:fmtScheme[\s\S]*<\/a:fmtScheme>/u, ''),
    });
    expect(elements).toMatchObject([{ kind: 'shape', fill: '#4472c4' }]);
    expect(elements[0]).not.toHaveProperty('gradient');
    expect(issues).toEqual([]);
  });

  it('draws a slide background from its theme’s background style, a gradient too', async () => {
    const root = folder();
    const file = join(root, 'Placeholder background style.pptx');
    writeFileSync(
      file,
      editablePptxFixture({
        slides: [
          slideXml('').replace(
            '<p:cSld>',
            '<p:cSld><p:bg><p:bgRef idx="1003"><a:schemeClr val="accent1"/></p:bgRef></p:bg>',
          ),
        ],
        parts: { 'ppt/theme/theme1.xml': OFFICE_THEME },
      }),
    );
    const deck = await readEditablePptx(file, join(root, 'prepared'));
    const page = deck.slides[0];
    // The theme's third background fill, from accent 1 to it shaded by half in linear light (worked out by hand).
    expect(page?.background).toBe('#4472c4');
    expect(page?.elements).toMatchObject([
      {
        kind: 'shape',
        name: 'Background gradient',
        frame: { x: 0, y: 0, width: 1280, height: 720 },
        gradient: {
          kind: 'linear',
          angle: 90,
          stops: [
            { offset: 0, color: '#4472c4' },
            { offset: 1, color: '#2f528f' },
          ],
        },
      },
    ]);
    expect(page?.issues).toEqual([]);
  });

  const MEDIUM_2_ACCENT_1 = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
  const table = (styleId: string, rows = 3) => {
    const cell = (words: string) =>
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${words}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
    const row = (r: number) =>
      `<a:tr h="285750">${cell(`Placeholder ${String(r)} a`)}${cell(`Placeholder ${String(r)} b`)}</a:tr>`;
    return (
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Placeholder table"/></p:nvGraphicFramePr>' +
      '<p:xfrm><a:off x="95250" y="190500"/><a:ext cx="2857500" cy="857250"/></p:xfrm><a:graphic><a:graphicData>' +
      `<a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>${styleId}</a:tableStyleId></a:tblPr>` +
      '<a:tblGrid><a:gridCol w="1428750"/><a:gridCol w="1428750"/></a:tblGrid>' +
      Array.from({ length: rows }, (_, r) => row(r)).join('') +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
    );
  };
  /** A table style list naming its default and holding no definitions, as python-pptx writes it. */
  const EMPTY_STYLES = `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${MEDIUM_2_ACCENT_1}"/>`;

  it('draws PowerPoint’s own Medium Style 2 for a table naming it when the deck doesn’t save it', async () => {
    const { elements, issues } = await readSlide(slideXml(table(MEDIUM_2_ACCENT_1)), {
      'ppt/tableStyles.xml': EMPTY_STYLES,
    });
    const fills = elements.flatMap((el) => (el.kind === 'shape' && el.shape !== 'line' ? [el.fill] : []));
    // The header row in accent 1, then its banded rows at 40% and 20% (PowerPoint's E9EBF5 and CFD5EA for 4472C4).
    expect(fills).toEqual(['#4472c4', '#4472c4', '#cfd5ea', '#cfd5ea', '#e9ebf5', '#e9ebf5']);
    const words = elements.filter((el) => el.kind === 'text');
    expect(words.map((el) => el.kind === 'text' && [el.runs?.[0]?.color, el.runs?.[0]?.weight])).toEqual([
      ['#ffffff', 700],
      ['#ffffff', 700],
      ['#000000', 400],
      ['#000000', 400],
      ['#000000', 400],
      ['#000000', 400],
    ]);
    // White 1 pt borders, the header's foot 3 pt.
    const lines = elements.filter((el) => el.kind === 'shape' && el.shape === 'line');
    expect(lines.map((el) => el.kind === 'shape' && el.outline)).toEqual([
      ...Array.from({ length: 4 }, () => ({ color: '#ffffff', width: 4 / 3 })),
      { color: '#ffffff', width: 4 },
      ...Array.from({ length: 2 }, () => ({ color: '#ffffff', width: 4 / 3 })),
    ]);
    expect(issues).not.toContain(
      'A table style was not included in the source; its own cell formatting is used.',
    );
  });

  it('draws each accent of Medium Style 2, and the plain grid, from their IDs in any case', async () => {
    const header = async (styleId: string) => {
      const { elements } = await readSlide(slideXml(table(styleId, 1)), {
        'ppt/tableStyles.xml': EMPTY_STYLES,
      });
      return (
        elements.flatMap((el) => (el.kind === 'shape' && el.shape !== 'line' ? [el.fill] : []))[0] ?? null
      );
    };
    expect(await header('{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}')).toBe('#000000');
    expect(await header('{21e4aea4-8dfa-4a89-87eb-49c32662afe8}')).toBe('#ed7d31');
    expect(await header('{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}')).toBe('#a5a5a5');
    expect(await header('{00A15C55-8517-42AA-B614-E9B94910E393}')).toBe('#ffc000');
    expect(await header('{7DF18680-E054-41AD-8BC1-D1AEF772440D}')).toBe('#5b9bd5');
    expect(await header('{93296810-A885-4BE3-A3E7-6D5BEEA58F35}')).toBe('#70ad47');
    // No Style, Table Grid: no fill, 1 pt lines in the text colour.
    const { elements } = await readSlide(slideXml(table('{5940675A-B579-460E-94D1-54222C63F5DA}', 1)), {
      'ppt/tableStyles.xml': EMPTY_STYLES,
    });
    expect(elements.filter((el) => el.kind === 'shape' && el.shape !== 'line')).toEqual([]);
    const grid = elements.filter((el) => el.kind === 'shape' && el.shape === 'line');
    expect(grid.map((el) => el.kind === 'shape' && el.outline)).toEqual(
      Array.from({ length: 5 }, () => ({ color: '#000000', width: 4 / 3 })),
    );
    // No Style, No Grid: nothing drawn but the words.
    const plain = await readSlide(slideXml(table('{2D5ABB26-0587-4C30-8999-92F81FD0307C}', 1)), {
      'ppt/tableStyles.xml': EMPTY_STYLES,
    });
    expect(plain.elements.map((el) => el.kind)).toEqual(['text', 'text']);
  });

  it('keeps a deck’s own definition of a built-in style’s ID', async () => {
    const own =
      `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${MEDIUM_2_ACCENT_1}">` +
      `<a:tblStyle styleId="${MEDIUM_2_ACCENT_1}" styleName="Placeholder own"><a:wholeTbl><a:tcStyle>` +
      '<a:fill><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl></a:tblStyle></a:tblStyleLst>';
    const { elements } = await readSlide(slideXml(table(MEDIUM_2_ACCENT_1, 1)), {
      'ppt/tableStyles.xml': own,
    });
    expect(elements.flatMap((el) => (el.kind === 'shape' && el.shape !== 'line' ? [el.fill] : []))).toEqual([
      '#abcdef',
      '#abcdef',
    ]);
  });
});

describe('PowerPoint’s own shrink of a box’s words', () => {
  const box = (id: number, body: string, nv = '') =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="Placeholder fit ${String(id)}"/><p:cNvSpPr/><p:nvPr>${nv}</p:nvPr></p:nvSpPr>` +
    '<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>' +
    `<p:txBody>${body}<a:lstStyle/><a:p><a:r><a:t>Placeholder words ${String(id)}</a:t></a:r></a:p></p:txBody></p:sp>`;

  it('keeps normAutofit’s font scale and line spacing reduction for the fit to start from', async () => {
    const { elements } = await readSlide(
      slideXml(
        box(30, '<a:bodyPr><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr>') +
          box(31, '<a:bodyPr><a:normAutofit fontScale="85%"/></a:bodyPr>') +
          box(32, '<a:bodyPr><a:normAutofit lnSpcReduction="10000"/></a:bodyPr>') +
          box(33, '<a:bodyPr><a:normAutofit/></a:bodyPr>') +
          box(34, '<a:bodyPr><a:spAutoFit/></a:bodyPr>'),
      ),
    );
    expect(elements.map((el) => el.kind === 'text' && el.style.sourceFit)).toEqual([
      { fontScale: 0.625, lineSpacingReduction: 0.2 },
      { fontScale: 0.85, lineSpacingReduction: 0 },
      { fontScale: 1, lineSpacingReduction: 0.1 },
      undefined,
      undefined,
    ]);
    // Drashti's own fit still decides: each box is still made smaller to fit.
    expect(elements.every((el) => el.kind === 'text' && el.style.shrinkToFit)).toBe(true);
  });

  it('takes the shrink from the box’s own autofit over its layout’s', async () => {
    const layout =
      '<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>' +
      box(
        2,
        '<a:bodyPr><a:normAutofit fontScale="70000" lnSpcReduction="20000"/></a:bodyPr>',
        '<p:ph type="body" idx="1"/>',
      ) +
      '</p:spTree></p:cSld></p:sldLayout>';
    const { elements } = await readSlide(
      slideXml(
        box(40, '<a:bodyPr/>', '<p:ph type="body" idx="1"/>') +
          box(41, '<a:bodyPr><a:noAutofit/></a:bodyPr>', '<p:ph type="body" idx="1"/>') +
          box(42, '<a:bodyPr><a:normAutofit fontScale="90000"/></a:bodyPr>', '<p:ph type="body" idx="1"/>'),
      ),
      { 'ppt/slideLayouts/slideLayout1.xml': layout },
    );
    expect(elements.map((el) => el.kind === 'text' && el.style.sourceFit)).toEqual([
      { fontScale: 0.7, lineSpacingReduction: 0.2 },
      undefined,
      { fontScale: 0.9, lineSpacingReduction: 0 },
    ]);
  });

  it('keeps the shrink through the slide schema, within its range', async () => {
    const { elements } = await readSlide(
      slideXml(box(50, '<a:bodyPr><a:normAutofit fontScale="500" lnSpcReduction="250000"/></a:bodyPr>')),
    );
    expect(elements[0]).toMatchObject({ style: { sourceFit: { fontScale: 0.01, lineSpacingReduction: 1 } } });
  });
});

describe('a table style’s parts (coverage)', () => {
  const STYLE_ID = '{01234567-89AB-CDEF-0123-456789ABCDEF}';
  const fill = (value: string) => `<a:fill><a:solidFill><a:srgbClr val="${value}"/></a:solidFill></a:fill>`;
  const part = (name: string, paint: string, text = '') =>
    `<a:${name}>${text}<a:tcStyle><a:tcBdr/>${paint}</a:tcStyle></a:${name}>`;
  const styles = (body: string, extra = '') =>
    `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${STYLE_ID}">` +
    `<a:tblStyle styleId="${STYLE_ID}" styleName="Placeholder">${body}</a:tblStyle>${extra}</a:tblStyleLst>`;
  const grid = (rows: number, columns: number, properties: string, styleId = STYLE_ID) => {
    const cell = (r: number, c: number) =>
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Placeholder ${String(r)}.${String(c)}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
    return (
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Placeholder table"/></p:nvGraphicFramePr>' +
      '<p:xfrm><a:off x="95250" y="190500"/><a:ext cx="2857500" cy="857250"/></p:xfrm><a:graphic><a:graphicData>' +
      `<a:tbl><a:tblPr ${properties}><a:tableStyleId>${styleId}</a:tableStyleId></a:tblPr><a:tblGrid>` +
      '<a:gridCol w="571500"/>'.repeat(columns) +
      '</a:tblGrid>' +
      Array.from(
        { length: rows },
        (_, r) =>
          '<a:tr h="214312">' + Array.from({ length: columns }, (_, c) => cell(r, c)).join('') + '</a:tr>',
      ).join('') +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
    );
  };
  const fills = (elements: SlideElement[]) =>
    elements.flatMap((el) => (el.kind === 'shape' && el.shape !== 'line' ? [el.fill] : []));

  it('lays banded columns over banded rows, the first and last columns over both, then the rows and corners', async () => {
    const style =
      part('wholeTbl', fill('111111')) +
      part('band1H', fill('222222')) +
      part('band2H', fill('333333')) +
      part('band1V', fill('444444')) +
      part('band2V', '') +
      part('lastCol', fill('666666'), '<a:tcTxStyle b="on"/>') +
      part('firstCol', fill('777777')) +
      part('lastRow', fill('888888'), '<a:tcTxStyle b="on"/>') +
      part('firstRow', fill('999999')) +
      part('seCell', fill('AAAAAA')) +
      part('swCell', fill('BBBBBB')) +
      part('neCell', fill('CCCCCC')) +
      part('nwCell', fill('DDDDDD'));
    const { elements } = await readSlide(
      slideXml(grid(4, 5, 'firstRow="1" lastRow="1" firstCol="1" lastCol="1" bandRow="1" bandCol="1"')),
      { 'ppt/tableStyles.xml': styles(style) },
    );
    expect(fills(elements)).toEqual([
      ...['#dddddd', '#999999', '#999999', '#999999', '#cccccc'],
      ...['#777777', '#444444', '#222222', '#444444', '#666666'],
      ...['#777777', '#444444', '#333333', '#444444', '#666666'],
      ...['#bbbbbb', '#888888', '#888888', '#888888', '#aaaaaa'],
    ]);
    const bold = elements.flatMap((el) =>
      el.kind === 'text' && el.runs?.[0]?.weight === 700 ? [el.text] : [],
    );
    expect(bold).toEqual([
      'Placeholder 0.4',
      'Placeholder 1.4',
      'Placeholder 2.4',
      'Placeholder 3.0',
      'Placeholder 3.1',
      'Placeholder 3.2',
      'Placeholder 3.3',
      'Placeholder 3.4',
    ]);
  });

  it('banded columns alone start after a first column, and turn off at the last', async () => {
    const style =
      part('wholeTbl', fill('111111')) + part('band1V', fill('444444')) + part('band2V', fill('555555'));
    const { elements } = await readSlide(slideXml(grid(1, 5, 'firstCol="1" lastCol="1" bandCol="1"')), {
      'ppt/tableStyles.xml': styles(style),
    });
    expect(fills(elements)).toEqual(['#111111', '#444444', '#555555', '#444444', '#111111']);
  });

  it('draws the style’s table background behind the cells, and reads fill references from 1001 as background fills', async () => {
    const style =
      '<a:tblBg><a:fill><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:fill></a:tblBg>' +
      part('wholeTbl', '<a:fillRef idx="1002"><a:schemeClr val="accent2"/></a:fillRef>') +
      part('band1H', '<a:fillRef idx="1001"><a:schemeClr val="accent2"/></a:fillRef>');
    const { elements } = await readSlide(slideXml(grid(2, 1, 'bandRow="1"')), {
      'ppt/tableStyles.xml': styles(style),
    });
    expect(elements[0]).toMatchObject({
      kind: 'shape',
      fill: '#abcdef',
      frame: { x: 10, y: 20, width: 300, height: 90 },
    });
    // The theme's background fills: the first a fixed red, the second the reference colour.
    expect(fills(elements)).toEqual(['#abcdef', '#aa0000', '#ed7d31']);
  });

  it('draws a table’s own cells, with one note, when its style is unknown or the style list is broken', async () => {
    const unknown = await readSlide(
      slideXml(grid(1, 1, 'firstRow="1"', '{FEDCBA98-7654-3210-FEDC-BA9876543210}')),
      {
        'ppt/tableStyles.xml': styles(part('wholeTbl', fill('111111'))),
      },
    );
    const broken = await readSlide(slideXml(grid(1, 1, 'firstRow="1"')), {
      'ppt/tableStyles.xml': '<a:tblStyleLst xmlns:a="a"><broken',
    });
    for (const { elements, issues } of [unknown, broken]) {
      expect(fills(elements)).toEqual([]);
      expect(elements.map((el) => el.kind)).toEqual(['text']);
      expect(issues).toContain(
        'A table style was not included in the source; its own cell formatting is used.',
      );
    }
  });
});

describe('words through the master’s styles (coverage)', () => {
  it('takes a body placeholder’s paragraph spacing from the master’s body style, level by level', async () => {
    const at = '<a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="3657600"/></a:xfrm>';
    const body = (words: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Placeholder body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${at}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${words}</p:txBody></p:sp>`;
    const master =
      '<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<p:cSld><p:spTree>${body('<a:p><a:r><a:t>Placeholder master words</a:t></a:r></a:p>')}</p:spTree></p:cSld>` +
      '<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:bodyStyle>' +
      '<a:lvl1pPr><a:spcBef><a:spcPts val="1200"/></a:spcBef><a:spcAft><a:spcPct val="50000"/></a:spcAft></a:lvl1pPr>' +
      '<a:lvl2pPr><a:lnSpc><a:spcPts val="3000"/></a:lnSpc></a:lvl2pPr>' +
      '</p:bodyStyle></p:txStyles></p:sldMaster>';
    const { elements } = await readSlide(
      slideXml(
        body(
          '<a:p><a:r><a:rPr sz="2400"/><a:t>Placeholder level one</a:t></a:r></a:p>' +
            '<a:p><a:pPr lvl="1"/><a:r><a:rPr sz="2400"/><a:t>Placeholder level two</a:t></a:r></a:p>',
        ),
      ),
      { 'ppt/slideMasters/slideMaster1.xml': master },
    );
    const box = elements.find((el) => el.kind === 'text' && el.text.startsWith('Placeholder level'));
    if (box?.kind !== 'text') throw new Error('The placeholder’s words are missing.');
    const paragraph = (words: string) => box.runs?.find((run) => run.text === words)?.paragraph;
    // 12 pt before; after, half the line's 24 pt words: 16 px each. Level two: its own 30 pt line, no spacing.
    expect(paragraph('Placeholder level one')).toMatchObject({ spaceBefore: 16, spaceAfter: 16 });
    expect(paragraph('Placeholder level two')).toMatchObject({ lineHeightPx: 40 });
    expect(paragraph('Placeholder level two')).not.toHaveProperty('spaceBefore');
    expect(paragraph('Placeholder level two')).not.toHaveProperty('spaceAfter');
  });
});
