import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDES, passagesHolding } from '../shared/guides';
import { parseMarkdown, passagesOf } from '../shared/markdown';
import { PANEL_HELP } from '../shared/panel-help';

/*
 * "What is this?" on each operator panel (Session 25): every panel has its two or three sentences, each
 * follows one passage of a guide shipped with Drashti, which its Read more opens (Sessions 31–36), and
 * every text is used by a panel.
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
  const passages = Object.fromEntries(
    GUIDES.map((g) => [g.id, passagesOf(parseMarkdown(readFileSync(join(app, 'docs', g.file), 'utf8')))]),
  );
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

  it('two or three plain sentences each, following exactly one passage of a shipped guide (Read more opens it)', () => {
    for (const [id, help] of Object.entries(PANEL_HELP)) {
      const sentences = help.text.split(/(?<=[.:;])\s+(?=[A-Z“])/u).filter((s) => /[.]$/u.test(s.trim()));
      expect(sentences.length, `${id}: ${help.text}`).toBeGreaterThanOrEqual(2);
      expect(sentences.length, `${id}: ${help.text}`).toBeLessThanOrEqual(3);
      const found = passagesHolding(passages[help.doc] ?? [], help.guide);
      expect(found.length, `${id}'s passage in the ${help.doc} guide: ${help.guide}`).toBe(1);
      expect(found[0]?.heading, `${id} opens a passage, not a heading`).toBe(false);
    }
  });

  it('has a ? where the guides were asked for: the open playlist, the show controls, Next and Back, the header’s Stream, Phones and Announcements, the status bar, and the Audio and More tools groups', () => {
    expect(Object.keys(PANEL_HELP)).toEqual(
      expect.arrayContaining([
        'playlist',
        'controls',
        'nextback',
        'stream',
        'phones',
        'announcements',
        'statusbar',
        'audio',
        'tools',
      ]),
    );
  });

  it('every text is used by a panel or a column heading', () => {
    const used = new Set(
      sources.flatMap(({ text }) =>
        [...text.matchAll(/\bhelp="([a-z]+)"|useWhatIsThis\('([a-z]+)'[,)]/gu)].map((m) => m[1] ?? m[2]),
      ),
    );
    expect(Object.keys(PANEL_HELP).filter((id) => !used.has(id))).toEqual([]);
  });
});
