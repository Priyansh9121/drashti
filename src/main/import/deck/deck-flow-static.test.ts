import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readPptxDeck } from '../pictures';
import { makeTestPptx } from '../testing/make-pptx';
import { addTestPptxShadow } from '../testing/pptx-shadow';
import { runDeck } from './deck-flow';

it.each([
  {
    title: 'draws fully supported still slides without a converter',
    noConverter: true,
    shadow: false,
    kind: 'baked',
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
])('$title', async ({ noConverter, shadow, kind }) => {
  const work = await mkdtemp(join(tmpdir(), 'drashti-static-flow-'));
  try {
    const file = join(work, 'Placeholder deck.pptx');
    await writeFile(file, makeTestPptx([{ text: 'Placeholder words', color: '204060' }]));
    if (shadow) await addTestPptxShadow(file);
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
      expect(slide?.deck).toBeUndefined();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
