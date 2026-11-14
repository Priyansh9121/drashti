import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(deck.slides.map((slide) => slide.elements.map((el) => el.kind === 'image' && el.mediaId))).toEqual([
      ['media-ref:0'],
      ['media-ref:1'],
      ['media-ref:2'],
      ['media-ref:0'],
    ]);
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
