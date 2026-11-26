import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The slide editor's and the words editor's buttons write their keys as this computer writes them, from the keys
 * they act on (shared/window-keys.ts's EDITOR_KEYS, written by keyText), never by hand (alpha.24, keyplat R5: "Back out"
 * said ⇧Tab on Windows, which writes Shift+Tab). A key written by hand is a Mac's sign (⌘ ⌥ ⇧ ⌃) or a Windows
 * modifier and a plus (Ctrl+, Alt+, Shift+) in quotes, outside a comment.
 */

const here = join(__dirname, '..', 'renderer', 'src', 'editor');
const files = [
  ...readdirSync(here)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(here, f)),
  join(here, '..', 'library', 'WordsEditor.tsx'),
];
const BY_HAND = /(['"`])[^'"`\n]*(?:[⌘⌥⇧⌃]|\b(?:Ctrl|Alt|Shift)\+)[^'"`\n]*\1/u;

describe('the editors’ keys on their buttons', () => {
  it('are written from the keys they act on, never by hand', () => {
    // The editor's own files are read (SlideEditor, WordsGroup and the rest), and the words editor.
    expect(files.map((f) => f.slice(f.lastIndexOf('/') + 1))).toEqual(
      expect.arrayContaining(['SlideEditor.tsx', 'WordsGroup.tsx', 'WordsEditor.tsx']),
    );
    const found = files.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, i) => {
          const code = line.replace(/\/\/.*$/u, '');
          if (/^\s*(\*|\/\*)/u.test(code)) return [];
          return BY_HAND.test(code) ? [`${path.slice(here.length - 'editor'.length)}:${String(i + 1)}`] : [];
        }),
    );
    expect(found).toEqual([]);
  });
});
