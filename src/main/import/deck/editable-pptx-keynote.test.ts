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
    const styled = (line: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="5" name="Placeholder styled shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${BOX}${line}</p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>`;
    const elements = await readSlide(
      slideXml(
        plainWords(`${BOX}<a:ln w="12700"><a:miter lim="400000"/></a:ln>`) +
          plainWords(`${BOX}<a:ln w="25400"><a:solidFill><a:srgbClr val="AA2244"/></a:solidFill></a:ln>`) +
          styled('<a:ln w="38100"/>'),
      ),
    );
    expect(elements.map((el) => el.kind)).toEqual(['text', 'shape', 'text', 'shape']);
    expect(elements[1]).toMatchObject({ fill: null, outline: { color: '#aa2244', width: (2 * 4) / 3 } });
    expect(elements[3]).toMatchObject({ name: 'Placeholder styled shape', fill: '#22bb44' });
    expect(elements[3]?.kind === 'shape' && elements[3].outline?.width).toBe(4);
  });
});
