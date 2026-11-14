import { describe, expect, it } from 'vitest';
import { PHONE_ARGS } from './network-phone';

describe('phone rename names', () => {
  it('cleans control and direction characters before passing on a media name', () => {
    const name = ' \u0001 Placeholder\r\ntrack\u2029name\u009F\u061C\u200E\u202E\u2066 ';
    expect(PHONE_ARGS.mediaRename.parse({ mediaId: 'm-1', name }).name).toBe('Placeholder track name');
  });

  it('validates the length of the cleaned name', () => {
    expect(PHONE_ARGS.mediaRename.safeParse({ mediaId: 'm-1', name: '\t\u202E\u2069' }).success).toBe(false);
    const maxName = 'x'.repeat(200);
    expect(PHONE_ARGS.mediaRename.parse({ mediaId: 'm-1', name: maxName + '\u202E' }).name).toBe(maxName);
    expect(PHONE_ARGS.mediaRename.safeParse({ mediaId: 'm-1', name: maxName + 'x' }).success).toBe(false);
  });

  it('refuses a name that only looks empty, as an empty one', () => {
    for (const name of ['\u200D', '\u200C', '\u200B\u2060', ' \u00AD ']) {
      expect(PHONE_ARGS.mediaRename.safeParse({ mediaId: 'm-1', name }).success, JSON.stringify(name)).toBe(
        false,
      );
      expect(
        PHONE_ARGS.presentationRename.safeParse({ presentationId: 'p-1', name }).success,
        JSON.stringify(name),
      ).toBe(false);
    }
  });

  it('preserves letters, marks and joiners in a presentation name, and a no-break space inside it', () => {
    for (const name of [
      'ક્\u200Dષ क्\u200Cष',
      // Virama and vowel signs ("placeholder" in Gujarati and in Hindi), and a nukta, decomposed.
      'પ્લેસહોલ્ડર प्लेसहोल्डर',
      'જ\u0ABC ज\u093C',
      // An emoji ZWJ sequence, and a no-break space inside a name.
      '👨\u200D👩\u200D👧\u200D👦 Placeholder',
      'Placeholder\u00A0name',
    ])
      expect(PHONE_ARGS.presentationRename.parse({ presentationId: 'p-1', name }).name).toBe(name);
  });

  it('cleans a wallpaper’s new name as a file’s', () => {
    const rename = (name: string) => PHONE_ARGS.wallpaperRename.safeParse({ wallpaperId: 'w-1', name });
    expect(rename(' Placeholder\u202E dusk\u200F ').data?.name).toBe('Placeholder dusk');
    expect(rename('\u200B').success).toBe(false);
  });
});
