import { describe, expect, it } from 'vitest';
import type { WordsPrinted } from '../../../shared/words-print';
import { fileMenuEntries, type FileTarget } from '../files/file-menu';
import { addWordsPrintToMenu, wordsPrintItems } from './words-print';

/*
 * A singers' sheet (alpha.22): Print words… and Save words as PDF… in the one right-click menu, on a presentation in the
 * library only (never a playlist's row, a slide, or a picture), in Pro Mode's menu only. Placeholder names only.
 */

const presentation: FileTarget = {
  kind: 'presentation',
  name: 'Placeholder Kirtan',
  place: 'library',
  presentationId: 'p1',
};

describe('Print words… and Save words as PDF… in the right-click menu', () => {
  it('are on a presentation in the library, and on nothing else', () => {
    const items = wordsPrintItems(presentation, () => undefined);
    expect(items.map((i) => i.label)).toEqual(['Print words…', 'Save words as PDF…']);
    for (const other of [
      { ...presentation, place: 'playlist' as const, playlistId: 'l', itemId: 'i' },
      { ...presentation, kind: 'slide' as const, slideId: 's' },
      { ...presentation, kind: 'deck' as const },
      { kind: 'picture' as const, name: 'Placeholder.png', place: 'media' as const, mediaId: 'm' },
      { ...presentation, presentationId: undefined },
    ])
      expect(
        wordsPrintItems(other, () => undefined),
        JSON.stringify(other),
      ).toEqual([]);
  });

  it('asks the main process for the one chosen, and says how it went', async () => {
    const asked: [string, string][] = [];
    const said: (string | null)[] = [];
    const answers: { print: WordsPrinted; pdf: WordsPrinted } = {
      print: { ok: true, file: null },
      pdf: { ok: true, file: '/placeholder/Documents/Placeholder Kirtan words.pdf' },
    };
    const items = wordsPrintItems(presentation, (text) => said.push(text), {
      print: (id) => {
        asked.push(['print', id]);
        return Promise.resolve(answers.print);
      },
      pdf: (id) => {
        asked.push(['pdf', id]);
        return Promise.resolve(answers.pdf);
      },
    });
    items[0]?.onSelect();
    items[1]?.onSelect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual([
      ['print', 'p1'],
      ['pdf', 'p1'],
    ]);
    expect(said).toEqual([
      'The words of “Placeholder Kirtan” went to the printer.',
      'Saved the words of “Placeholder Kirtan” as a PDF: Placeholder Kirtan words.pdf, in Documents.',
    ]);
  });

  it('says why not in the main process’s words, and nothing when the person cancelled', async () => {
    const said: (string | null)[] = [];
    const items = wordsPrintItems(presentation, (text) => said.push(text), {
      print: () => Promise.resolve({ ok: false, cancelled: true }),
      pdf: () => Promise.resolve({ ok: false, cancelled: false, message: 'Placeholder refusal.' }),
    });
    items[0]?.onSelect();
    items[1]?.onSelect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(said).toEqual(['Placeholder refusal.']);
  });

  it('are Pro Mode’s menu’s alone: Simple Mode’s has neither', () => {
    const remove = addWordsPrintToMenu();
    const target: FileTarget = {
      ...presentation,
      edit: { label: 'Edit slides…', run: () => undefined },
      rename: () => undefined,
    };
    try {
      const pro = fileMenuEntries(target, 'darwin').map((e) => e.label);
      expect(pro).toContain('Print words…');
      expect(pro).toContain('Save words as PDF…');
      // After Edit slides…, before Rename… (a later Part's items' place).
      expect(pro.indexOf('Edit slides…')).toBeGreaterThanOrEqual(0);
      expect(pro.indexOf('Edit slides…')).toBeLessThan(pro.indexOf('Print words…'));
      expect(pro.indexOf('Save words as PDF…')).toBeLessThan(pro.indexOf('Rename…'));
      const simple = fileMenuEntries(target, 'darwin', { simple: true }).map((e) => e.label);
      expect(simple).toContain('Edit slides…');
      expect(simple).not.toContain('Print words…');
      expect(simple).not.toContain('Save words as PDF…');
    } finally {
      remove();
    }
  });
});
