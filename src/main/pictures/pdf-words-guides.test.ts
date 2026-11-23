import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('explains PDF paragraph reflow, bundled script fonts and ready-page Find in both guides', () => {
  for (const file of ['operator-guide.md', 'admin-guide.md']) {
    const words = readFileSync(join(process.cwd(), 'docs', file), 'utf8');
    expect(words).toContain('PDF paragraphs');
    expect(words).toContain('Noto Sans Gujarati');
    expect(words).toContain('Noto Sans Devanagari');
    expect(words).toContain('ready PDF pages');
    expect(words).toContain('Replace all');
    expect(words).toContain('one Undo step');
  }
});
