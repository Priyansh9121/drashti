import type { KirtanLang, Lang, TextElement, TextStyle } from '../../shared/model';
import type { Db } from './database';
import { PlaylistRepo } from './playlists';
import { PresentationRepo } from './presentations';

/*
 * Placeholder content for a new install. All text here was written for
 * Drashti's tests; it is not kirtan or scripture text.
 */

export const SEED_KEY = 'seed.placeholder-presentations';
export const TEST_PRESENTATION_NAME = 'Language test slides';
export const KIRTAN_PRESENTATION_NAME = 'Sample kirtan (placeholder)';

/** One line in each language: the text the rendering tests look for. */
export const TEST_LINES: Record<KirtanLang, string> = {
  en: 'Welcome to the test slide',
  gu: 'પરીક્ષણ સ્લાઇડમાં આપનું સ્વાગત છે',
  hi: 'परीक्षण स्लाइड में आपका स्वागत है',
  translit: 'Parīkṣaṇ slāiḍmāṁ āpnuṁ svāgat che',
};

const style = (overrides: Partial<TextStyle> = {}): TextStyle => ({
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: true,
  ...overrides,
});

function line(
  id: string,
  text: string,
  lang: Lang,
  y: number,
  overrides: Partial<TextStyle> = {},
): TextElement {
  return {
    id,
    kind: 'text',
    frame: { x: 100, y, width: 1720, height: 180 },
    text,
    lang,
    style: style(overrides),
  };
}

/**
 * One text box with a styled run per language (the mix PLAN.md 4.3
 * describes): a large Gujarati line, the same in Hindi, a smaller italic
 * transliteration line and the meaning in English. These are the kirtan's
 * four tracks; each screen shows the ones it is set to.
 */
function kirtanBox(lines: Record<KirtanLang, string>): TextElement {
  const runs = [
    { text: `${lines.gu}\n`, lang: 'gu' as const, size: 92, weight: 600 },
    { text: `${lines.hi}\n`, lang: 'hi' as const, size: 80, weight: 600 },
    { text: `${lines.translit}\n`, lang: 'translit' as const, size: 60, weight: 400, italic: true },
    { text: lines.en, lang: 'en' as const, size: 52, weight: 400, color: '#e5e7eb' },
  ];
  return {
    id: 'lines',
    kind: 'text',
    frame: { x: 100, y: 240, width: 1720, height: 600 },
    text: runs.map((r) => r.text).join(''),
    lang: 'gu',
    style: style({ fontSize: 92 }),
    runs,
  };
}

const KIRTAN_LINES: { group: string; lines: Record<KirtanLang, string> }[] = [
  {
    group: 'Verse 1',
    lines: {
      en: 'Placeholder verse, first line',
      gu: 'નમૂનાની પહેલી પંક્તિ',
      hi: 'नमूने की पहली पंक्ति',
      translit: 'Namūnānī pahelī paṅkti',
    },
  },
  {
    group: 'Chorus',
    lines: { en: 'Placeholder chorus', gu: 'નમૂનાની ટેક', hi: 'नमूने की टेक', translit: 'Namūnānī ṭek' },
  },
  {
    group: 'Verse 2',
    lines: {
      en: 'Placeholder verse, second line',
      gu: 'નમૂનાની બીજી પંક્તિ',
      hi: 'नमूने की दूसरी पंक्ति',
      translit: 'Namūnānī bījī paṅkti',
    },
  },
];

/**
 * Add the two placeholder presentations once per database. Returns false
 * when they were added before (even if the operator has since deleted them).
 */
export function seedPlaceholders(db: Db): boolean {
  const done = db.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(SEED_KEY);
  if (done) return false;
  const repo = new PresentationRepo(db);
  db.transaction(() => {
    const libraryId = repo.ensureLibrary('Default');
    repo.insert({
      libraryId,
      name: TEST_PRESENTATION_NAME,
      groups: [
        {
          name: 'Languages',
          color: '#f5a524',
          slides: [
            {
              label: 'All four languages',
              background: '#101828',
              elements: [
                line('en', TEST_LINES.en, 'en', 150),
                line('gu', TEST_LINES.gu, 'gu', 360),
                line('hi', TEST_LINES.hi, 'hi', 570),
                line('translit', TEST_LINES.translit, 'translit', 780, { fontSize: 68, fontWeight: 400 }),
              ],
            },
            {
              label: 'Gujarati and English',
              background: '#0b3d2e',
              elements: [
                line('gu', 'બીજી પરીક્ષણ સ્લાઇડ', 'gu', 300, { fontSize: 96 }),
                line('en', 'Second test slide', 'en', 560),
              ],
            },
            {
              label: 'English only',
              background: '#3b0d2e',
              elements: [line('en', 'Third test slide', 'en', 450, { fontSize: 110, fontWeight: 700 })],
            },
          ],
        },
      ],
      source: { kind: 'drashti', path: null, ref: 'seed:language-test', importedAt: null },
    });
    repo.insert({
      libraryId,
      name: KIRTAN_PRESENTATION_NAME,
      groups: KIRTAN_LINES.map((k) => ({
        name: k.group,
        color: k.group === 'Chorus' ? '#e5484d' : '#3e63dd',
        slides: [{ background: '#000000', elements: [kirtanBox(k.lines)] }],
      })),
      kirtan: { category: 'Kirtan', kavi: 'Placeholder Kavi', raag: 'Placeholder Raag' },
      source: { kind: 'drashti', path: null, ref: 'seed:sample-kirtan', importedAt: null },
    });
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(SEED_KEY, new Date().toISOString());
  })();
  return true;
}

export const TEMPLATES_KEY = 'seed.example-templates';

type TemplateStep = { header: string } | { slot: string; category: string | null };

/**
 * Starting points for the mandir's own running orders (PLAN.md 3), named
 * as examples: the real orders come from the operators at the mandir setup.
 * Headers and slots only, since no presentation is the mandir's yet.
 */
export const EXAMPLE_TEMPLATES: { name: string; steps: TemplateStep[] }[] = [
  {
    name: 'Example: Ravi Sabha',
    steps: [
      { header: 'Opening' },
      { slot: 'Dhun', category: 'Dhun' },
      { slot: 'Prarthana', category: 'Prarthana' },
      { header: 'Kirtans' },
      { slot: 'Kirtan', category: 'Kirtan' },
      { slot: 'Kirtan', category: 'Kirtan' },
      { slot: 'Kirtan', category: 'Kirtan' },
      { header: 'Pravachan' },
      { slot: 'Pravachan title', category: null },
      { header: 'Announcements' },
      { slot: 'Announcements', category: null },
      { header: 'Arti' },
      { slot: 'Arti', category: 'Arti' },
      { slot: 'Closing', category: null },
    ],
  },
  {
    name: 'Example: Bal/Kishore Sabha',
    steps: [
      { header: 'Opening' },
      { slot: 'Dhun', category: 'Dhun' },
      { slot: 'Prarthana', category: 'Prarthana' },
      { header: 'Kirtans' },
      { slot: 'Bal sabha kirtan', category: 'Bal sabha' },
      { slot: 'Kishore sabha kirtan', category: 'Kishore sabha' },
      { header: 'Activity' },
      { slot: 'Story or quiz title', category: null },
      { header: 'Arti' },
      { slot: 'Arti', category: 'Arti' },
    ],
  },
];

/** Add the example templates once per library. Returns false when they were added before (even if since deleted). */
export function seedTemplates(db: Db): boolean {
  if (db.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(TEMPLATES_KEY)) return false;
  const repo = new PlaylistRepo(db);
  db.transaction(() => {
    for (const t of EXAMPLE_TEMPLATES) {
      const id = repo.create(t.name, null, false, true);
      if (!id) continue;
      for (const step of t.steps)
        if ('header' in step) repo.addItems(id, null, [{ kind: 'header', label: step.header }]);
        else repo.addSlot(id, null, step.slot, step.category);
    }
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(
      TEMPLATES_KEY,
      new Date().toISOString(),
    );
  })();
  return true;
}
