import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readPptxDeck } from '../pictures';
import { makeTestPptx } from '../testing/make-pptx';
import { addTestPptxShadow } from '../testing/pptx-shadow';
import { makeZip } from '../testing/zip-writer';
import { readZipEntries } from '../zip';
import { runDeck } from './deck-flow';

async function setAdvance(file: string, advanceMs: number): Promise<void> {
  const parts = await readZipEntries(file, () => true);
  const name = 'ppt/slides/slide1.xml';
  const page = parts.get(name);
  if (!page) throw new Error('The fixture slide is missing.');
  const xml = page.toString().replace('</p:sld>', `<p:transition advTm="${String(advanceMs)}"/></p:sld>`);
  parts.set(name, Buffer.from(xml));
  await writeFile(file, makeZip(Array.from(parts, ([name, data]) => ({ name, data }))));
}

it.each([
  {
    title: 'draws fully supported still slides without a converter',
    noConverter: true,
    shadow: false,
    kind: 'baked',
  },
  {
    title: 'keeps automatic advance on a still slide',
    noConverter: true,
    shadow: false,
    advanceMs: 4200,
    kind: 'baked',
  },
  {
    // Its "after N s" alone does not make a slide move: still, it goes to the converter like any still slide
    // (C27's review, NIT-1).
    title: 'leaves a still slide with automatic advance to the selected picture converter',
    noConverter: false,
    shadow: false,
    advanceMs: 4200,
    kind: 'pictures',
  },
  {
    title: 'keeps the selected picture converter even with movies off',
    noConverter: false,
    shadow: false,
    kind: 'pictures',
  },
  {
    title: 'leaves unsupported still slides to the converter fallback',
    noConverter: true,
    shadow: true,
    kind: 'pictures',
  },
])('$title', async ({ noConverter, shadow, advanceMs, kind }) => {
  const work = await mkdtemp(join(tmpdir(), 'drashti-static-flow-'));
  try {
    const file = join(work, 'Placeholder deck.pptx');
    await writeFile(file, makeTestPptx([{ text: 'Placeholder words', color: '204060' }]));
    if (shadow) await addTestPptxShadow(file);
    if (advanceMs !== undefined) await setAdvance(file, advanceMs);
    const read = await readPptxDeck(file);
    const options = {
      ffmpeg: '',
      onAir: () => Promise.resolve(false),
      noPictureConverter: () => Promise.resolve(noConverter),
    };
    const flow = await runDeck(
      { source: 'pptx', file, fileName: 'Placeholder deck.pptx', sourcePath: file, read, work, bakers: [] },
      options,
    );
    expect(flow.kind).toBe(kind);
    if (flow.kind === 'baked') {
      const slide = flow.parsed.groups[0]?.slides[0];
      expect(slide?.elements).toContainEqual(
        expect.objectContaining({ kind: 'text', text: 'Placeholder words' }),
      );
      if (advanceMs === undefined) expect(slide?.deck).toBeUndefined();
      else expect(slide?.deck).toMatchObject({ deckAdvanceMs: advanceMs, steps: [], media: [] });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
