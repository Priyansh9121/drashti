import { describe, expect, it } from 'vitest';
import type { RenameAnswer } from '../../../shared/rename-name';
import { type RenameWays, renameWithUndo } from './rename-undo';

/*
 * Rename… kept, and its Undo, the operator window's and a phone's alike (Session 58, X3: NM-2 and NM-3). A stand-in for
 * Drashti keeps each name it is asked to (Drashti cleans it as it keeps it) and refuses those it is told to. Placeholder
 * names only.
 */

function drashti(refuse: (name: string) => string | null = () => null) {
  const asked: string[] = [];
  const undos: { text: string; undo: () => Promise<void> }[] = [];
  const said: string[] = [];
  const ways: RenameWays = {
    keep: (name) => {
      asked.push(name);
      const why = refuse(name);
      return Promise.resolve<RenameAnswer>(why === null ? { ok: true } : { ok: false, message: why });
    },
    offerUndo: (text, undo) => {
      undos.push({ text, undo });
    },
    say: (text) => {
      said.push(text);
    },
  };
  return { ways, asked, undos, said };
}

describe('Rename… kept, and its Undo', () => {
  it('says the name as Drashti kept it (hidden characters left out), and Undo asks for the old name back', async () => {
    const d = drashti();
    expect(await renameWithUndo('Placeholder dusk', ' Placeholder\u202E dawn\u200F ', d.ways)).toBeNull();
    expect(d.undos.map((u) => u.text)).toEqual(['Renamed “Placeholder dusk” to “Placeholder dawn”']);
    await d.undos[0]?.undo();
    expect(d.asked).toEqual([' Placeholder\u202E dawn\u200F ', 'Placeholder dusk']);
    expect(d.said).toEqual([]);
  });

  it('offers no Undo when the name kept is the old one (only hidden characters were added)', async () => {
    const d = drashti();
    expect(await renameWithUndo('Placeholder dusk', 'Placeholder dusk\u200E', d.ways)).toBeNull();
    expect(d.asked).toEqual(['Placeholder dusk\u200E']);
    expect(d.undos).toEqual([]);
  });

  it('gives a refusal’s words back to the question, with no Undo', async () => {
    const d = drashti(() => 'A name needs 1 to 200 characters.');
    expect(await renameWithUndo('Placeholder dusk', '\u200B', d.ways)).toBe(
      'A name needs 1 to 200 characters.',
    );
    expect(d.undos).toEqual([]);
    expect(d.said).toEqual([]);
  });

  it('says why when Drashti refuses the Undo (the thing gone meanwhile, or an old name of hidden characters only)', async () => {
    const d = drashti((name) =>
      name === 'Placeholder dusk' ? 'That picture is no longer in the library.' : null,
    );
    expect(await renameWithUndo('Placeholder dusk', 'Placeholder dawn', d.ways)).toBeNull();
    await d.undos[0]?.undo();
    expect(d.said).toEqual(['That picture is no longer in the library.']);
  });
});
