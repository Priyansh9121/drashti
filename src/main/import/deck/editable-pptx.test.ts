import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { slideElementSchema } from '../../../shared/model-schema';
import { makeTestPptx } from '../testing/make-pptx';
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
function source(bytes: Buffer) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-editable-pptx-'));
  roots.push(root);
  const file = join(root, 'Placeholder source.pptx');
  const out = join(root, 'prepared');
  writeFileSync(file, bytes);
  return { root, file, out, bytes };
}

describe('native objects from a retained PPTX source', () => {
  it('reads actual Unicode words, dimensions, hidden slides and direct style without changing the source or adding a baked picture', async () => {
    const s = source(
      makeTestPptx([
        { text: 'Placeholder cafe\u0301', color: '204060' },
        { text: 'નમૂના', color: '112233', hidden: true },
      ]),
    );
    const deck = await readEditablePptx(s.file, s.out);
    expect([deck.width, deck.height]).toEqual([1280, 720]);
    expect(deck.slides.map((slide) => [slide.sourceIndex, slide.hidden, slide.background])).toEqual([
      [0, false, '#204060'],
      [1, true, '#112233'],
    ]);
    const box = deck.slides[0]?.elements.find((element) => element.kind === 'text');
    expect(box?.kind).toBe('text');
    if (box?.kind !== 'text') throw new Error('Source words were not read.');
    expect(box.text).toBe('Placeholder café');
    expect(slideElementSchema.parse(box)).toMatchObject({ sourceShapeId: '2' });
    expect(box.runs?.map((run) => run.text).join('')).toBe(box.text);
    expect(box.style.fontSize).toBeCloseTo((40 * 4) / 3);
    expect(box.frame.x).toBeCloseTo(105.6);
    expect(box.frame.y).toBeCloseTo(292.8);
    expect(deck.slides[1]?.elements.find((element) => element.kind === 'text')).toMatchObject({
      lang: 'gu',
      text: 'નમૂના',
    });
    expect(deck.media).toEqual([]);
    expect(deck.slides.flatMap((slide) => slide.elements).every((element) => element.kind !== 'image')).toBe(
      true,
    );
    for (const element of deck.slides.flatMap((slide) => slide.elements))
      expect(slideElementSchema.safeParse(element).success).toBe(true);
    expect(readFileSync(s.file)).toEqual(s.bytes);
  });

  it('inherits placeholder frames and text properties from layout/master/theme, with explicit runs overriding inherited values', async () => {
    const ph = '<p:ph type="body" idx="2"/>';
    const inherited = wordsShape(
      '<a:p><a:pPr/><a:r><a:t>Placeholder inherited</a:t></a:r><a:br/><a:r><a:rPr i="1" u="sng" strike="sngStrike"><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:rPr><a:t> café</a:t></a:r></a:p>',
      '',
      ph,
    );
    const layout = wordsShape(
      '<a:p><a:pPr><a:defRPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:defRPr></a:pPr></a:p>',
      undefined,
      ph,
    );
    const s = source(
      editablePptxFixture({
        slides: [slideXml(inherited)],
        parts: {
          'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${layout}</p:spTree></p:cSld></p:sldLayout>`,
          'ppt/slideMasters/slideMaster1.xml':
            '<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld><p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:bodyStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="2400" b="1"><a:latin typeface="+mn-lt"/><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle></p:txStyles></p:sldMaster>',
        },
      }),
    );
    const deck = await readEditablePptx(s.file, s.out);
    const box = deck.slides[0]?.elements.find((element) => element.kind === 'text');
    expect(box?.kind).toBe('text');
    if (box?.kind !== 'text') throw new Error('Inherited source words were not read.');
    expect(deck.slides[0]?.background).toBe('#ffffff');
    expect(box.frame).toEqual({ x: 96, y: 192, width: 384, height: 96 });
    expect(box.style).toMatchObject({
      fontSize: 32,
      fontWeight: 700,
      fontFamily: 'Placeholder Sans',
      color: '#22bb44',
      align: 'center',
    });
    expect(box.text).toBe('Placeholder inherited\n café');
    expect(box.runs?.at(-1)).toMatchObject({
      text: ' café',
      color: '#123456',
      italic: true,
      underline: true,
      strike: true,
      weight: 700,
    });
  });

  it('keeps supported group geometry, a basic shape, embedded picture crop and stable media references', async () => {
    const group =
      '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="Placeholder group"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1828800"/><a:chOff x="0" y="0"/><a:chExt cx="1828800" cy="914400"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="3" name="Placeholder rectangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="228600" y="91440"/><a:ext cx="457200" cy="274320"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="334455"/></a:solidFill></p:spPr></p:sp></p:grpSp>';
    const picture =
      '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Placeholder picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rPic"/><a:srcRect l="25000"/><a:stretch/></p:blipFill><p:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="3657600" y="914400"/><a:ext cx="1828800" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>';
    const bytes = editablePicture();
    const s = source(
      editablePptxFixture({
        slides: [slideXml(group + picture)],
        parts: {
          'ppt/media/generated.png': bytes,
          'ppt/slides/_rels/slide1.xml.rels': relationshipsXml(
            `<Relationship Id="rPic" Type="${REL_NS}/image" Target="../media/generated.png"/>`,
          ),
        },
      }),
    );
    const deck = await readEditablePptx(s.file, s.out);
    const shape = deck.slides[0]?.elements.find((element) => element.kind === 'shape');
    expect(shape).toMatchObject({
      shape: 'rectangle',
      sourceShapeId: '3',
      sourceGroupIds: ['9'],
      frame: { x: 144, y: 115.2, width: 96, height: 57.6 },
      fill: '#334455',
    });
    const image = deck.slides[0]?.elements.find((element) => element.kind === 'image');
    expect(image).toMatchObject({
      mediaId: 'media-ref:0',
      sourceShapeId: '4',
      fit: 'stretch',
      rotation: 90,
      flipX: true,
      crop: { x: 0.25, y: 0, width: 0.75, height: 1 },
    });
    expect(deck.media).toHaveLength(1);
    const asset = deck.media[0]?.originalPath ?? '';
    expect(relative(s.out, asset).startsWith('..')).toBe(false);
    expect(readFileSync(asset)).toEqual(bytes);
    for (const element of deck.slides[0]?.elements ?? [])
      expect(slideElementSchema.safeParse(element).success).toBe(true);
    expect(readFileSync(s.file)).toEqual(s.bytes);
  });

  it('does not follow external or escaping image relationships and discloses unsupported drawing content', async () => {
    const image = (id: string) =>
      `<p:pic><p:blipFill><a:blip r:embed="${id}"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic>`;
    const s = source(
      editablePptxFixture({
        slides: [
          slideXml(
            image('outside') +
              image('escape') +
              '<p:graphicFrame><a:graphic><a:graphicData/></a:graphic></p:graphicFrame>',
          ),
        ],
        parts: {
          'ppt/slides/_rels/slide1.xml.rels': relationshipsXml(
            `<Relationship Id="outside" Type="${REL_NS}/image" Target="https://example.invalid/placeholder.png" TargetMode="External"/><Relationship Id="escape" Type="${REL_NS}/image" Target="../../../outside.png"/>`,
          ),
        },
      }),
    );
    const deck = await readEditablePptx(s.file, s.out);
    expect(deck.media).toEqual([]);
    expect(deck.slides[0]?.elements).toEqual([]);
    expect(deck.slides[0]?.issues.join(' ')).toMatch(/linked|external/iu);
    expect(deck.slides[0]?.issues.join(' ')).toMatch(/outside|unsafe|escaping/iu);
    expect(deck.slides[0]?.issues.join(' ')).toMatch(/tables|charts|embedded/iu);
  });

  it('rejects unsafe XML declarations and out-of-range dimensions rather than silently losing native words', async () => {
    const unsafe = source(
      editablePptxFixture({
        slides: [
          '<!DOCTYPE p:sld [<!ENTITY outside SYSTEM "file:///placeholder-not-read">]><p:sld xmlns:p="p"/>',
        ],
      }),
    );
    await expect(readEditablePptx(unsafe.file, unsafe.out)).rejects.toThrow(/XML|declaration|doctype/iu);
    const oversized = source(
      editablePptxFixture({
        slides: [slideXml('')],
        parts: {
          'ppt/presentation.xml':
            '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst><p:sldSz cx="999999999999" cy="6858000"/></p:presentation>',
        },
      }),
    );
    await expect(readEditablePptx(oversized.file, oversized.out)).rejects.toThrow(/size|dimension/iu);
  });
});
