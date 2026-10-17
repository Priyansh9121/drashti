import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_ANSWERS, type GuideAnswer, searchAnswers } from '../shared/guide-answers';
import { GUIDES, indexGuide, passagesHolding, plainWords } from '../shared/guides';
import { parseMarkdown, passagesOf } from '../shared/markdown';

/*
 * Curated answers in Help › Guides (Sessions 31–36): "When …, what do I do?", each pointing at one passage of
 * a shipped guide, shown in that guide's own words, and found first by its own words.
 */

const app = join(__dirname, '..', '..');
const guides = GUIDES.map((g) =>
  indexGuide(g.id, passagesOf(parseMarkdown(readFileSync(join(app, 'docs', g.file), 'utf8')))),
);

describe('curated answers', () => {
  it('are 20 to 30, each asked as "When …, what do I do?"', () => {
    expect(GUIDE_ANSWERS.length).toBeGreaterThanOrEqual(20);
    expect(GUIDE_ANSWERS.length).toBeLessThanOrEqual(30);
    for (const a of GUIDE_ANSWERS) expect(a.question).toMatch(/^When .+, what do I do\?$/u);
  });

  it('each point at exactly one passage of its guide, never a heading, and no two at the same one', () => {
    const seen = new Set<string>();
    for (const a of GUIDE_ANSWERS) {
      const guide = guides.find((g) => g.id === a.doc);
      const found = passagesHolding(guide?.passages ?? [], a.words);
      expect(found.length, `${a.question} (${a.doc}: ${a.words})`).toBe(1);
      expect(found[0]?.heading).toBe(false);
      const key = `${a.doc} ${String(found[0]?.id)}`;
      expect(seen.has(key), `${a.question}: another answer has its passage`).toBe(false);
      seen.add(key);
    }
  });

  it('each is found first by its own words, and only where its guide can be read', () => {
    for (const a of GUIDE_ANSWERS) {
      // Its question, and its passage's first words as the guide writes them.
      for (const typed of [a.question, plainWords(a.words)]) {
        const hits = searchAnswers(GUIDE_ANSWERS, guides, typed);
        expect(hits[0]?.answer.question, typed).toBe(a.question);
      }
    }
    // Simple Mode reads the operator's and presenter's guides only: the admin's answers are not offered there.
    const simple = guides.filter((g) => g.id === 'operator' || g.id === 'presenter');
    const admin = GUIDE_ANSWERS.find((a) => a.doc === 'admin');
    expect(admin && searchAnswers(GUIDE_ANSWERS, simple, admin.question)).toEqual([]);
    expect(searchAnswers(GUIDE_ANSWERS, guides, '')).toEqual([]);
    // A word or two finds the answer too: "black screen" finds the black or frozen screen first.
    expect(searchAnswers(GUIDE_ANSWERS, guides, 'black screen')[0]?.answer.words).toContain(
      'black or frozen',
    );
  });

  it('puts the closest first, whatever the list’s order', () => {
    const guide = indexGuide(
      'operator',
      passagesOf(parseMarkdown('**A screen is black or frozen.** One.\n\n**A screen is black.** Two.\n')),
    );
    const answers: GuideAnswer[] = [
      {
        question: 'When a screen is black or frozen, what do I do?',
        doc: 'operator',
        words: '**A screen is black or frozen.**',
      },
      { question: 'When a screen is black, what do I do?', doc: 'operator', words: '**A screen is black.**' },
    ];
    expect(
      searchAnswers(answers, [guide], 'When a screen is black, what do I do?').map((h) => h.answer),
    ).toEqual([answers[1], answers[0]]);
  });
});
