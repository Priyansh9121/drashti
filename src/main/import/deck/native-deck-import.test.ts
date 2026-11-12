import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../db/database';
import { PresentationRepo } from '../../db/presentations';
import { MediaStore } from '../media-store';
import { runImport } from '../pipeline';
import { nativeDeckFixture } from './native-deck-fixture';

async function importPlaceholder(unsupported: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'drashti-native-deck-'));
  const db = openDatabase(join(root, 'drashti.sqlite'));
  try {
    const path = join(root, 'Placeholder clicks.pptx');
    await writeFile(path, nativeDeckFixture(unsupported));
    const summary = await runImport({
      db,
      media: new MediaStore(db, { dir: join(root, 'Media'), freeBytes: () => 1024 ** 4 }),
      runId: randomUUID(),
      paths: [path],
      options: {},
      tempDir: root,
      baker: false,
      converters: false,
      drawPdf: () => {
        throw new Error('A native deck should not need a PDF.');
      },
    });
    const repo = new PresentationRepo(db);
    const item = repo.list().find((entry) => entry.name === 'Placeholder clicks');
    const slides = item ? (repo.get(item.id)?.groups.flatMap((group) => group.slides) ?? []) : [];
    return { summary, slides };
  } finally {
    db.close();
    await rm(root, { force: true, recursive: true });
  }
}

describe('native PowerPoint import without Office', () => {
  it('keeps source words, exact click lengths and the incoming slide’s transition', async () => {
    const { summary, slides } = await importPlaceholder(false);
    expect(summary.totals).toMatchObject({ imported: 1, failed: 0, slides: 2 });
    expect(slides[0]?.slide).toMatchObject({
      elements: [
        { text: 'Placeholder appear' },
        { text: 'Placeholder fly' },
        { text: 'Placeholder wipe' },
        { text: 'Placeholder zoom' },
        { text: 'Placeholder fade' },
      ],
      deck: {
        steps: [],
        motion: { approximate: false, stepsMs: [260, 480, 620, 300] },
      },
    });
    expect(slides[1]?.slide.deck).toMatchObject({
      transition: { name: 'p:wipe', durationMs: 650 },
      steps: [],
      motion: { approximate: false, stepsMs: [0] },
    });
  });

  it('uses the closest playable transition when a PowerPoint video cannot be made', async () => {
    const { summary, slides } = await importPlaceholder(true);
    expect(summary.totals).toMatchObject({ imported: 1, failed: 0, slides: 2 });
    expect(slides[1]?.slide.deck).toMatchObject({
      transition: { name: 'p:checkerboard', nativeTransition: { kind: 'dissolve', durationMs: 650 } },
      steps: [],
      motion: { approximate: true, stepsMs: [0] },
    });
  });
});
