import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { PresentationRepo } from '../db/presentations';
import { MediaStore } from './media-store';
import { runImport } from './pipeline';
import { makeTestPptx } from './testing/make-pptx';

/*
 * A still PowerPoint deck typed in an old Gujarati or Hindi font, on a computer with no picture converter (Q57-22; C16's
 * review, LOW-1): Drashti draws it, as it draws every deck it can (Q58-8: kept so), and the old-font notice names the
 * font, which its words read right only where it is installed: this computer and each node.
 */

it('draws a still deck typed in an old font with no picture converter, naming the old font', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-still-old-font-'));
  const mediaDir = join(root, 'Media');
  mkdirSync(mediaDir);
  const db = openDatabase(join(root, 'drashti.sqlite'));
  try {
    const deck = join(root, 'Placeholder old font deck.pptx');
    writeFileSync(
      deck,
      makeTestPptx([{ text: 'Placeholder old font words', color: '204060', font: 'Kruti Dev 010' }]),
    );
    const written: string[] = [];
    const run = await runImport({
      db,
      media: new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 }),
      runId: randomUUID(),
      paths: [deck],
      options: {},
      converters: false,
      baker: false,
      tempDir: root,
      onWrote: ({ presentationId }) => written.push(presentationId),
      drawPdf: () => Promise.reject(new Error('A deck Drashti draws itself is never drawn from a PDF.')),
    });
    const item = new ImportRepo(db).report(run.id)?.items[0];
    expect(item?.outcome).toBe('imported');
    // Drawn by Drashti: its words are a text box of its own, not a page's picture.
    const content = new PresentationRepo(db).content(written[0] ?? '');
    expect(content?.elements.map((element) => element.kind)).toContain('text');
    expect(content?.elements.some((element) => element.props.includes('Placeholder old font words'))).toBe(
      true,
    );
    expect(
      item?.issues.flatMap((issue) =>
        issue.code === 'legacy-font' && issue.fix?.kind === 'convert-font' ? [issue.fix.font] : [],
      ),
    ).toEqual(['Kruti Dev 010']);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
