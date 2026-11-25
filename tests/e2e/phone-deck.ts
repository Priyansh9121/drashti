import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds } from './helpers';
import { generatedPdf, PDF_PAGES } from './pdf-tools-fixtures';

/*
 * A PDF a Pro Mode phone may put up (alpha.23, QA23-PHONE-1, the owner's "Only PPT and PDF"): a generated three-page
 * PDF (pdf-tools-fixtures.ts, placeholder words and shapes only), imported as Drashti imports one (its pages, a
 * presentation from a document: shared/phone-decks.ts), as a row of a playlist. A phone lists it in Pro Mode's
 * Playlist; a kirtan's or words' rows it does not.
 */

export const DECK = 'Placeholder phone deck';

export interface PhoneDeck {
  deckId: string;
  itemId: string;
  /** Its pages: 3. */
  pages: number;
}

/** The generated PDF imported, and added at the end of the playlist. */
export async function addPhoneDeck(win: Page, playlistId: string, name = DECK): Promise<PhoneDeck> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-deck-'));
  const file = join(dir, `${name}.pdf`);
  writeFileSync(file, generatedPdf(PDF_PAGES));
  const [deckId = ''] = await importAndGetIds(win, [file]);
  expect(deckId, 'the generated PDF imports').not.toBe('');
  const itemId = await win.evaluate(
    async ({ playlistId, deckId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const added = await d.playlists.addItems(playlistId, null, [
        { kind: 'presentation', presentationId: deckId },
      ]);
      if (!added.ok) throw new Error(added.message);
      return added.ids[0] ?? '';
    },
    { playlistId, deckId },
  );
  expect(itemId, 'the PDF is a row of the playlist').not.toBe('');
  return { deckId, itemId, pages: PDF_PAGES.length };
}

/** Put a playlist row up from the operator window, as one click on its row does. */
export async function putUpFromComputer(win: Page, playlistId: string, itemId: string): Promise<void> {
  const result = await win.evaluate(
    ({ playlistId, itemId }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', playlistId, itemId }),
    { playlistId, itemId },
  );
  expect(result.ok, 'the row goes up from the computer').toBe(true);
}

/**
 * Every request of a phone's page that Drashti refuses it (403), by path, from now on: the page asks for none in either
 * mode (QA23-PHONE-1; a23-review-phoneui S1). A test that means a refusal (a tap Simple Mode refuses before the phone
 * has heard of it) checks it apart.
 */
export function refusedRequests(page: Page): string[] {
  const refused: string[] = [];
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/') && r.status() === 403) refused.push(path);
  });
  return refused;
}
