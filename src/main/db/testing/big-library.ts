import type { Lang, TextElement } from '../../../shared/model';
import type { Db } from '../database';
import type { NewPresentation } from '../presentations';
import { PresentationRepo } from '../presentations';

/*
 * For tests only: a library the size of a big mandir's, full of placeholder
 * text written here (nothing real), to measure how Drashti copes.
 */

const text = (id: string, value: string, lang: Lang): TextElement => ({
  id,
  kind: 'text',
  frame: { x: 100, y: 700, width: 1720, height: 300 },
  text: value,
  lang,
  style: {
    fontFamily: null,
    fontSize: 64,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'bottom',
    lineHeight: 1.2,
    shadow: true,
  },
});

/** A presentation like an imported kirtan or talk: 2 to 4 groups of 2 to 4 slides, 2 text boxes each. */
export function placeholderPresentation(libraryId: string, n: number): NewPresentation {
  const groups = Array.from({ length: 2 + (n % 3) }, (_, g) => ({
    name: g === 0 ? 'Verse' : `Chorus ${g}`,
    slides: Array.from({ length: 2 + ((n + g) % 3) }, (_, s) => ({
      label: `${g + 1}.${s + 1}`,
      elements: [
        text(`t${g}-${s}-a`, `Placeholder line ${n}.${g}.${s}`, 'en'),
        text(`t${g}-${s}-b`, `Namūnā pankti ${n}.${g}.${s}`, 'translit'),
      ],
    })),
  }));
  const kirtan = n % 3 === 0;
  return {
    libraryId,
    name: `Placeholder ${kirtan ? 'Kirtan' : 'Talk'} ${String(n).padStart(5, '0')}`,
    groups,
    ...(kirtan ? { kirtan: { category: 'Placeholder', kavi: `Placeholder Kavi ${n % 7}` } } : {}),
    source: {
      kind: 'pp6',
      path: `/Placeholder/Library/${n}.pro6`,
      ref: `P-${n}`,
      importedAt: '2026-01-01T00:00:00Z',
    },
  };
}

/** Add `count` placeholder presentations across three libraries, in one transaction. */
export function fillLibrary(db: Db, count: number): void {
  const repo = new PresentationRepo(db);
  const libraries = ['Kirtans', 'Talks', 'Templates'].map((name) => repo.ensureLibrary(name));
  db.transaction(() => {
    for (let n = 0; n < count; n++) repo.insert(placeholderPresentation(libraries[n % 2] ?? '', n));
  })();
}
