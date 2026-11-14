import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readEditablePptx } from '../deck/editable-pptx';
import { editablePptxFixture, slideXml, wordsShape } from './editable-pptx-fixture';
import { nativeSourceReader } from './native-source-reader';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// C23's review LOW-3: the unit seam answers as the document reader does, a page over a limit with its own note, so
// a test can run a deck from the reader to Edit slides in one piece.
it('passes on a PowerPoint page’s own note and the deck’s page count, as the document reader does', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-placeholder-seam-notes-'));
  roots.push(root);
  const file = join(root, 'Placeholder seam notes.pptx');
  const words = wordsShape('<a:p><a:r><a:t>Placeholder readable words</a:t></a:r></a:p>');
  writeFileSync(
    file,
    editablePptxFixture({ slides: [slideXml(words), slideXml(words.repeat(501)), slideXml(words)] }),
  );
  const read = await nativeSourceReader({
    ext: 'pptx',
    file,
    outDir: join(root, 'prepared'),
    sourcePages: [0, 1, 2],
    signal: new AbortController().signal,
    checkpoint: () => Promise.resolve(true),
  });
  expect(read).toMatchObject({
    ok: true,
    total: 3,
    failed: [1],
    pages: [{ sourceIndex: 0 }, { sourceIndex: 2 }],
  });
  // The reader's own note for that page, whatever its words, and no other.
  const direct = await readEditablePptx(file, join(root, 'direct'));
  expect(direct.failedNotes?.[1]).toHaveLength(1);
  expect(read.ok ? read.failedNotes : undefined).toEqual({ 1: direct.failedNotes?.[1] });
});
