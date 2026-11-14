import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readPptxDeck } from '../pictures';
import { makeTestDeck, placeholderDeckMedia } from '../testing/make-deck';
import { readZipEntries } from '../zip';
import { prepareNativePptx } from './native-deck-import';
import { copyZipReplacing } from './zip-copy';

/*
 * Q58-13: a slide whose picture fill Drashti can't copy (its placeholder bytes are no PNG, as a picture over 32 MB or in
 * another format isn't read either) would play as a flat colour. It plays its baked slide instead; a picture object
 * Drashti can't copy keeps today's way, the slide's saved picture in its place.
 */
it('leaves a slide whose picture fill can’t be copied to its baked slide, never drawn as a flat colour', async () => {
  const root = await mkdtemp(join(tmpdir(), 'drashti-placeholder-picture-fill-'));
  try {
    const box = { x: 914_400, y: 914_400, w: 1_828_800, h: 1_828_800 };
    const base = join(root, 'Placeholder base.pptx');
    await writeFile(
      base,
      makeTestDeck(
        [
          {
            key: 'placeholder-fill',
            bg: '244060',
            transition: { kind: 'fade', dur: 200 },
            notes: '',
            shapes: [{ id: 2, type: 'shape', name: 'Placeholder box', fill: 'D02B25', ...box }],
            effects: [{ kind: 'fade', target: 2, dur: 300, start: 'click' }],
          },
          {
            key: 'placeholder-picture',
            bg: '244060',
            transition: { kind: 'fade', dur: 200 },
            notes: '',
            shapes: [{ id: 2, type: 'pic', name: 'Placeholder picture', media: 'pic1', ...box }],
            effects: [{ kind: 'fade', target: 2, dur: 300, start: 'click' }],
          },
        ],
        placeholderDeckMedia(),
      ),
    );
    // Slide 1's background becomes a picture fill: the picture slide 2 shows.
    const parts = await readZipEntries(base, (name) =>
      [
        'ppt/slides/slide1.xml',
        'ppt/slides/_rels/slide1.xml.rels',
        'ppt/slides/_rels/slide2.xml.rels',
      ].includes(name),
    );
    const picture = /Target="(\.\.\/media\/[^"]+\.png)"/u.exec(
      parts.get('ppt/slides/_rels/slide2.xml.rels')?.toString('utf8') ?? '',
    )?.[1];
    const slide = parts.get('ppt/slides/slide1.xml')?.toString('utf8') ?? '';
    const rels = parts.get('ppt/slides/_rels/slide1.xml.rels')?.toString('utf8') ?? '';
    if (!picture || !slide.includes('<p:bgPr><a:solidFill>'))
      throw new Error('The generated deck changed shape.');
    const file = join(root, 'Placeholder picture fill.pptx');
    await copyZipReplacing(
      base,
      file,
      new Map([
        [
          'ppt/slides/slide1.xml',
          Buffer.from(
            slide.replace(
              /<p:bgPr><a:solidFill>.*?<\/a:solidFill>/u,
              '<p:bgPr><a:blipFill><a:blip r:embed="rPlaceholderFill"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>',
            ),
          ),
        ],
        [
          'ppt/slides/_rels/slide1.xml.rels',
          Buffer.from(
            rels.replace(
              '</Relationships>',
              `<Relationship Id="rPlaceholderFill" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${picture}"/></Relationships>`,
            ),
          ),
        ],
      ]),
    );
    const deck = await readPptxDeck(file);
    const prepared = await prepareNativePptx(deck, file, root);
    // The editable copy keeps both pages (Edit slides names the picture it couldn't copy) ...
    expect(prepared?.editable.slides.map((page) => page.sourceIndex)).toEqual([0, 1]);
    expect(prepared?.editable.slides[0]?.issues).toContain(
      'An embedded picture is missing, too large or outside the supported PNG/JPEG/WebP formats.',
    );
    // ... but slide 1 isn't drawn by Drashti at all, and slide 2 takes its picture from its baked still.
    expect([...(prepared?.pages.keys() ?? [])]).toEqual([1]);
    expect(prepared?.pages.get(1)?.needsStill).toBe(true);
    expect(prepared?.exact).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
