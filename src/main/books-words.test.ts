import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { KEY_GROUPS, KEYMAP } from '../shared/keymap';
import { PANEL_HELP } from '../shared/panel-help';

/*
 * Shastra is called Books wherever a person sees it (the owner's words, 3 Nov 2026, for alpha.15): the library's tab,
 * its menus and dialogs, the phones, the help cards, the notices and errors, what a screen reader says, and every
 * guide. What is kept is what no one reads: identifiers, IPC channels, test ids, the library's tables and stored
 * values, and the text format's own names (docs/shastra-format.md, "drashti-shastra"), so older libraries and texts
 * load unchanged. The menus are checked in menu.test.ts, the windows and a phone's pages in books-words.spec.ts.
 */

const app = join(__dirname, '..', '..');

/** Every file under a folder, its own path relative to the app. */
function files(dir: string): string[] {
  return readdirSync(join(app, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(app, path)).isDirectory() ? files(path) : [path];
  });
}

/**
 * Whether words from the code say Shastra as a person would read it: the word on its own, in any case; never inside
 * an id, a channel, a path, a table or a quoted stored value ('shastra', "shastra:pg#14", 'shastra_texts',
 * "docs/shastra-format.md", "drashti-shastra", "kind = 'shastra'").
 */
export function saysShastra(words: string): boolean {
  if (/^shastra$/u.test(words)) return false;
  const unquoted = words.replace(/(['"`])shastra\1/gu, '');
  return /(?<![\p{L}\p{N}_./:#-])shastra(?![\p{L}\p{N}_/:#-]|\.[\p{L}\p{N}])/iu.test(unquoted);
}

/**
 * The two strings of the code allowed to say it, each with why, and the file it is in. Each must still be there,
 * once: a stored value nobody reads, and a migration's name in the library's history.
 */
const KEPT: readonly { file: string; words: string; why: string }[] = [
  {
    file: 'src/shared/playlists.ts',
    words: 'Shastra',
    why: 'SHASTRA_SLOT, a slot asking for a passage as libraries store it; it is shown as Books (slotCategoryName)',
  },
  {
    file: 'src/main/db/migrate.ts',
    words: 'the Shastra module',
    why: 'migration 25’s name, never shown: the library’s history, as the CHANGELOG’s past entries are',
  },
];

/** Every string in a source file (a literal, a template's words, a JSX text) that says Shastra, with its line. */
function saidIn(path: string): { line: number; words: string }[] {
  const text = readFileSync(join(app, path), 'utf8');
  if (!/shastra/iu.test(text)) return [];
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: { line: number; words: string }[] = [];
  const visit = (node: ts.Node) => {
    const words =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
        ? node.text.trim()
        : null;
    // A module's path is a file's name, which stays (src/main/shastra/…).
    const imported = ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent);
    if (words !== null && !imported && saysShastra(words))
      found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, words });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * A guide's words as its reader sees them: without its code (a block, or `in a line`, which holds file names, ids
 * and the format's technical names) and without where its links and pictures lead (file names, which stay).
 */
export function guideWords(markdown: string): string[] {
  let fenced = false;
  return markdown.split('\n').map((line) => {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      return '';
    }
    if (fenced) return '';
    return line
      .replace(/`[^`]*`/gu, '')
      .replace(/\]\([^)]*\)/gu, ']')
      .replace(/(?<![\p{L}\p{N}_-])(docs\/)?shastra-format\.md\b/gu, '');
  });
}

describe('Books, never Shastra, wherever a person sees it (alpha.15)', () => {
  it('in the app’s own words: every string of its code (windows, phones, menus, help, notices, errors, logs)', () => {
    const code = files('src').filter(
      (path) =>
        /\.tsx?$/u.test(path) &&
        !/\.test\.tsx?$/u.test(path) &&
        // The library's migrations are its history: each runs once, as written.
        !path.split(/[\\/]/u).includes('migrations'),
    );
    expect(code.length).toBeGreaterThan(500);
    const said = code.flatMap((path) =>
      saidIn(path).map((s) => ({ file: path.split('\\').join('/'), ...s })),
    );
    const kept = said.filter((s) => KEPT.some((k) => k.file === s.file && k.words === s.words));
    expect(
      said.filter((s) => !kept.includes(s)).map((s) => `${s.file}:${String(s.line)}: ${s.words}`),
    ).toEqual([]);
    // Each one kept is still there, once (else it goes from the list).
    expect(kept.map((s) => `${s.file}: ${s.words}`).sort()).toEqual(
      KEPT.map((k) => `${k.file}: ${k.words}`).sort(),
    );
  });

  it('on the help cards and the key card', () => {
    const cards = Object.values(PANEL_HELP).flatMap((card) => [card.title, card.text, card.guide]);
    const keys = [...KEYMAP.map((b) => b.label), ...KEY_GROUPS.map((g) => g.title)];
    expect(cards.length).toBeGreaterThan(40);
    expect(keys.length).toBeGreaterThan(20);
    expect([...cards, ...keys].filter(saysShastra)).toEqual([]);
  });

  it('in the guides and the README, the text format’s file and technical names aside', () => {
    const guides = [...files('docs').filter((path) => path.endsWith('.md')), 'README.md'];
    expect(guides).toEqual(
      expect.arrayContaining([
        join('docs', 'operator-guide.md'),
        join('docs', 'admin-guide.md'),
        join('docs', 'presenter-guide.md'),
        join('docs', 'setup-day.md'),
        join('docs', 'parallel-run.md'),
        join('docs', 'api.md'),
        join('docs', 'shastra-format.md'),
        'README.md',
      ]),
    );
    // Each place it is said, with the words around it.
    const found = guides.flatMap((path) =>
      guideWords(readFileSync(join(app, path), 'utf8')).flatMap((line, i) =>
        [...line.matchAll(/shastra/giu)].map(
          (m) =>
            `${relative(app, join(app, path))}:${String(i + 1)}: …${line.slice(Math.max(0, m.index - 50), m.index + 60)}…`,
        ),
      ),
    );
    expect(found).toEqual([]);
  });

  it('tells a word a person reads from an id, a channel, a path or a stored value', () => {
    for (const said of [
      'Shastra',
      'Show Shastra, Templates and Kirtan Details',
      'Its Shastra text is not loaded',
      'A Shastra passage',
      'the shastra texts',
      'Shastra’s passages',
      "Shastra's passages",
      'Open in Shastra.',
    ])
      expect(saysShastra(said), said).toBe(true);
    for (const kept of [
      'shastra',
      'shastra:pg#14',
      'shastra-texts-dialog',
      'shastra.texts',
      '/api/v1/shastra',
      'docs/shastra-format.md',
      'Check it against its format, in docs/shastra-format.md.',
      'drashti-shastra',
      'SELECT key FROM shastra_texts WHERE id = ?',
      "UPDATE playlist_items SET kind = 'shastra', passage = ?",
    ])
      expect(saysShastra(kept), kept).toBe(false);
    expect(
      guideWords(
        'Load `"format": "drashti-shastra"` as in [the format](shastra-format.md) and docs/shastra-format.md.',
      ),
    ).toEqual(['Load  as in [the format] and .']);
    expect(
      guideWords(
        '```json\n"format": "drashti-shastra"\n```\n![Shastra texts](screenshots/shastra-texts.png)',
      ),
    ).toEqual(['', '', '', '![Shastra texts]']);
  });
});
