import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDES, guidePictureName, indexGuide, searchGuides } from '../shared/guides';
import { imagesOf, parseMarkdown, passagesOf } from '../shared/markdown';
import { GuideFiles, guidesDir } from './guides';

/*
 * The guides inside Drashti (Sessions 31–36), as shipped: the four guides read as written, found by search,
 * and their pictures, exactly those the guides show, packed beside the app.
 */

const app = process.cwd();
const docs = join(app, 'docs');
const guide = (file: string) => parseMarkdown(readFileSync(join(docs, file), 'utf8'));

describe('the guides inside Drashti', () => {
  it('reads the four guides as written: their sections, the Black-out row, the pictures and the checklist', () => {
    const operator = guide('operator-guide.md');
    expect(operator.filter((b) => b.kind === 'heading').length).toBeGreaterThanOrEqual(6);
    const blackOut = passagesOf(operator).find((p) => p.text.startsWith('B (or .), Black-out'));
    expect(blackOut?.section).toBe('2. Running the sabha');
    const pictures = GUIDES.flatMap((g) => imagesOf(guide(g.file)));
    expect(pictures.length).toBeGreaterThanOrEqual(53);
    expect(pictures.every((p) => guidePictureName(p) !== null)).toBe(true);
    const tasks = guide('setup-day.md').flatMap((b) => (b.kind === 'list' ? b.items : []));
    expect(tasks.filter((t) => t.task === 'open').length).toBeGreaterThan(50);
  });

  it('finds "black" in the Black-out row, by section, and nothing for words no guide has', () => {
    const indexed = GUIDES.map((g) => indexGuide(g.id, passagesOf(guide(g.file))));
    const found = searchGuides(indexed, 'black');
    const running = found.find((s) => s.guide === 'operator' && s.section === '2. Running the sabha');
    expect(running?.hits.some((p) => p.text.includes('Black-out'))).toBe(true);
    expect(searchGuides(indexed, 'zzzqqq')).toEqual([]);
    expect(searchGuides(indexed, '   ')).toEqual([]);
  });

  it('packs the four guides and exactly the pictures they show beside the app (electron-builder.yml)', () => {
    const yml = readFileSync(join(app, 'electron-builder.yml'), 'utf8');
    const entry = /- from: docs\n\s+to: guides\n\s+filter:\n((?:\s+- .+\n)+)/u.exec(yml);
    expect(entry, 'electron-builder.yml packs docs/ as guides/').not.toBeNull();
    const listed = (entry?.[1] ?? '')
      .split('\n')
      .map((l) => l.trim().replace(/^- /u, ''))
      .filter((l) => l !== '')
      .sort();
    const wanted = [
      ...GUIDES.map((g) => g.file),
      ...new Set(GUIDES.flatMap((g) => imagesOf(guide(g.file)))),
    ].sort();
    expect(listed).toEqual(wanted);
  });

  it('serves only a picture a guide shows, from the guides’ own folder', () => {
    const files = new GuideFiles(guidesDir({ packaged: false, resourcesPath: '/nowhere', appPath: app }));
    expect(files.dir).toBe(docs);
    expect(files.read('operator')).toContain('# The operator');
    const name = [...files.pictureNames()][0] ?? '';
    expect(files.picture(name)).toBe(join(docs, 'screenshots', name));
    // A screenshot no guide shows, and anything that is not a picture's name, are refused.
    expect(files.picture('announcements-queue.png')).toBeNull();
    expect(files.picture('../README.md')).toBeNull();
    expect(
      guidesDir({
        packaged: true,
        resourcesPath: '/Applications/Drashti.app/Contents/Resources',
        appPath: '',
      }),
    ).toBe(join('/Applications/Drashti.app/Contents/Resources', 'guides'));
  });
});
