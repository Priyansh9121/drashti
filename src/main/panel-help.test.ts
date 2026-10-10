import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PANEL_HELP } from '../shared/panel-help';

/*
 * "What is this?" on each operator panel (Session 25): every panel has its two or three sentences,
 * each follows a passage the operator's guide still has, and every text is used by a panel.
 */

const app = join(__dirname, '..', '..');
const renderer = join(app, 'src', 'renderer', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'gallery' ? [] : files(path);
    return name.endsWith('.tsx') ? [path] : [];
  });
}

/** Each `<Panel …>` opening tag in a file that uses the shared Panel. */
function panelTags(source: string): string[] {
  if (!/import \{[^}]*\bPanel\b[^}]*\} from '[./]*ui\/Panel'/u.test(source)) return [];
  const tags: string[] = [];
  for (const start of [...source.matchAll(/<Panel\s/gu)].map((m) => m.index)) {
    let depth = 0;
    let end = start;
    for (; end < source.length; end++) {
      const c = source[end];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(source.slice(start, end + 1));
  }
  return tags;
}

describe('"What is this?" on the operator panels', () => {
  const guide = readFileSync(join(app, 'docs', 'operator-guide.md'), 'utf8');
  const sources = files(renderer).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  it('every panel has its words', () => {
    const without = sources.flatMap(({ path, text }) =>
      panelTags(text)
        .filter((tag) => !/\bhelp="[a-z]+"/u.test(tag))
        .map(
          (tag) => `${relative(renderer, path)}: ${/title="([^"]+)"/u.exec(tag)?.[1] ?? tag.slice(0, 40)}`,
        ),
    );
    expect(without).toEqual([]);
    expect(sources.reduce((n, s) => n + panelTags(s.text).length, 0)).toBeGreaterThanOrEqual(10);
  });

  it('two or three plain sentences each, following a passage the operator’s guide still has', () => {
    for (const [id, help] of Object.entries(PANEL_HELP)) {
      const sentences = help.text.split(/(?<=[.:;])\s+(?=[A-Z“])/u).filter((s) => /[.]$/u.test(s.trim()));
      expect(sentences.length, `${id}: ${help.text}`).toBeGreaterThanOrEqual(2);
      expect(sentences.length, `${id}: ${help.text}`).toBeLessThanOrEqual(3);
      expect(guide, `${id}'s passage`).toContain(help.guide);
    }
  });

  it('every text is used by a panel or a column heading', () => {
    const used = new Set(
      sources.flatMap(({ text }) =>
        [...text.matchAll(/\bhelp="([a-z]+)"|useWhatIsThis\('([a-z]+)'\)/gu)].map((m) => m[1] ?? m[2]),
      ),
    );
    expect(Object.keys(PANEL_HELP).filter((id) => !used.has(id))).toEqual([]);
  });
});
