import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDES } from '../shared/guides';

/*
 * One name for each action, and the words as they are written (Sessions 31–36, DOC-2): the screens'
 * setup is "Set Up Screens…" everywhere (the menu, its buttons, its own title, the guides); a slide or
 * message that is up is "On the screens", never "On screens"; apostrophes are typographic (’), never
 * &apos; and never a straight one in words people read. Comments and log lines are not words people read.
 */

const app = join(__dirname, '..', '..');
const src = join(app, 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

const LOG = /\b(log|warn)(\.(warn|info|error|debug))?\??\.?\(|\.log\(|console\.|\bsay\(/u;

/** A source's lines that are code (not comments, not log lines), with their numbers. */
function codeLines(path: string): { line: string; n: number }[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/u.test(line) && !LOG.test(line));
}

/** The guides people read (the four inside Drashti, and the parallel run's), line by line. */
const guideLines = [...GUIDES.map((g) => g.file), 'parallel-run.md'].flatMap((file) =>
  readFileSync(join(app, 'docs', file), 'utf8')
    .split('\n')
    .map((line, i) => ({ where: `docs/${file}:${String(i + 1)}`, line })),
);

/** Other names the screens' setup has had: only "Set Up Screens" (with "…" where it opens) stands. */
const SETUP_NAMES = /setup wizard|set up (?:the )?screens|set up drashti/giu;

/**
 * Straight apostrophes that are not words people read, each named with why: the guides' own words, which
 * these quote to find their passage (the guides are Markdown, with straight ones), and AppleScript.
 */
const STRAIGHT_KEPT: { file: string; line: RegExp; why: string }[] = [
  {
    file: join('shared', 'panel-help.ts'),
    line: /^\s*guide:/u,
    why: 'the operator guide’s words, as written',
  },
  { file: join('shared', 'guide-answers.ts'), line: /^\s*words:/u, why: 'a guide’s words, as written' },
  {
    file: join('main', 'import', 'deck-converters.ts'),
    line: /AppleScript's/u,
    why: 'AppleScript, which Keynote runs',
  },
];

describe('one name for each action, and the words as written', () => {
  it('the screens’ setup is “Set Up Screens…” in the window, the menu and the guides', () => {
    const found = [
      ...files(src).flatMap((path) =>
        codeLines(path).flatMap(({ line, n }) =>
          [...line.matchAll(SETUP_NAMES)]
            .filter((m) => m[0] !== 'Set Up Screens')
            .map((m) => `${relative(src, path)}:${String(n)} “${m[0]}”`),
        ),
      ),
      ...guideLines.flatMap(({ where, line }) =>
        [...line.matchAll(SETUP_NAMES)]
          .filter((m) => m[0] !== 'Set Up Screens')
          .map((m) => `${where} “${m[0]}”`),
      ),
    ];
    expect(found).toEqual([]);
  });

  it('what is up is “On the screens”, never “On screens”', () => {
    const found = files(join(src, 'renderer')).flatMap((path) =>
      codeLines(path)
        .filter(({ line }) => /\bOn screens\b/u.test(line))
        .map(({ n }) => `${relative(src, path)}:${String(n)}`),
    );
    expect(found).toEqual([]);
  });

  it('apostrophes are typographic: never &apos;, never a straight one in words people read', () => {
    const found = files(src).flatMap((path) => {
      const file = relative(src, path);
      return codeLines(path).flatMap(({ line, n }) => {
        const where = `${file}:${String(n)}`;
        if (line.includes('&apos;')) return [`${where} &apos;`];
        if (STRAIGHT_KEPT.some((k) => k.file === file && k.line.test(line))) return [];
        // Words in double quotes or a template (single quotes cannot hold one unescaped).
        const words = [...line.matchAll(/"([^"\n]*)"|`([^`\n]*)`/gu)].map((m) => m[1] ?? m[2] ?? '');
        return words.some((w) => /\p{L}'\p{L}/u.test(w)) ? [`${where} a straight apostrophe`] : [];
      });
    });
    expect(found).toEqual([]);
  });
});
