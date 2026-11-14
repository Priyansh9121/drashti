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
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

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
