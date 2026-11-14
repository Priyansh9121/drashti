import { describe, expect, it } from 'vitest';
import { musicNameSchema } from './music';
import { playlistNameSchema } from './playlists';
import { cleanRenameName } from './rename-name';
import { nameSchema as screenNameSchema } from './screens-schema';
import { wallpaperNameSchema } from './wallpapers';

/*
 * The names a person gives, cleaned alike on the computer and on a phone (Session 57's PH-8 for Rename…; Session 58,
 * X3: a name that only looks empty, and the other names a person gives). Placeholder names only; the Gujarati and
 * Hindi ones are "placeholder" written in each script, and single letters with a nukta.
 */

/** Names that show nothing: joiners, a zero-width space, a word joiner, a soft hyphen, a filler, VS16 alone. */
const LOOKS_EMPTY = [
  '\u200D',
  '\u200C',
  '\u200B',
  '\u2060',
  '\u00AD',
  '\u200B \u2060\u00AD',
  '\u202E\u200B\u2069',
  '\t\u200D\n',
  '\u3164',
  '\uFE0F',
];

/** Names that keep every character: letters, marks and joiners as typed, and a no-break space inside. */
const KEPT = [
  // Virama and vowel signs: "placeholder" in Gujarati and in Hindi.
  'પ્લેસહોલ્ડર',
  'प्लेसहोल्डर',
  // Joiners inside a conjunct.
  'ક્\u200Dષ क्\u200Cष',
  // A nukta, decomposed (the letter, then the sign).
  'જ\u0ABC ज\u093C',
  // An emoji ZWJ sequence, a tag flag, a skin tone, and an emoji shown as one (VS16).
  '👨\u200D👩\u200D👧\u200D👦',
  '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  '👍🏽',
  'Placeholder ❤\uFE0F',
  // A no-break space and a narrow no-break space inside a name.
  'Placeholder\u00A0name',
  'Placeholder\u202Fname',
];

describe('a name as Rename… keeps it', () => {
  it('turns a tab or a line break into a space and leaves out control and text-direction characters', () => {
    expect(
      cleanRenameName(' \u0000 Placeholder\tname\u2028line\u007F\u0085\u061C\u200E\u200F\u202E\u2069 '),
    ).toBe('Placeholder name line');
    expect(cleanRenameName('Placeholder\r\nname')).toBe('Placeholder name');
  });

  it('is empty when nothing visible is left, so it is refused like an empty name', () => {
    for (const name of LOOKS_EMPTY) expect(cleanRenameName(name), JSON.stringify(name)).toBe('');
  });

  it('keeps letters, marks and joiners as typed, and a no-break space inside a name', () => {
    for (const name of KEPT) expect(cleanRenameName(name), JSON.stringify(name)).toBe(name);
  });

  it('gives the same name again when cleaned twice', () => {
    for (const name of [...LOOKS_EMPTY, ...KEPT, ' Placeholder\t\u202Ename\u200F '])
      expect(cleanRenameName(cleanRenameName(name))).toBe(cleanRenameName(name));
  });
});

describe('the other names a person gives are cleaned alike', () => {
  const schemas = [
    { what: 'a playlist (a folder, a header, one from a template)', schema: playlistNameSchema, max: 200 },
    { what: 'an audio playlist', schema: musicNameSchema, max: 120 },
    { what: 'a wallpaper', schema: wallpaperNameSchema, max: 200 },
    { what: 'a screen or a screen group', schema: screenNameSchema, max: 80 },
  ];

  it('playlists, audio playlists, wallpapers, screens and screen groups, as Rename… cleans a file’s name', () => {
    for (const { what, schema, max } of schemas) {
      expect(schema.parse(' Placeholder\tname\u202E\u200F\u2066 '), what).toBe('Placeholder name');
      for (const name of KEPT) expect(schema.parse(name), what).toBe(name);
      // Empty, or only looking empty: refused.
      for (const name of ['', '   ', ...LOOKS_EMPTY])
        expect(schema.safeParse(name).success, `${what}: ${JSON.stringify(name)}`).toBe(false);
      // The length is the cleaned name's.
      expect(schema.parse('x'.repeat(max) + '\u202E'), what).toBe('x'.repeat(max));
      expect(schema.safeParse('x'.repeat(max + 1)).success, what).toBe(false);
    }
  });
});
