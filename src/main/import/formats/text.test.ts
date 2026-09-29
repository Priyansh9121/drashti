import { describe, expect, it } from 'vitest';
import type { TextElement } from '../../../shared/model';
import { slideElementSchema } from '../../../shared/model-schema';
import { groupColor, nameFromFile, parseLyricsText } from './text';

const parse = (text: string, name = 'Placeholder Song.txt') => parseLyricsText(Buffer.from(text), name);
const texts = (p: ReturnType<typeof parse>) =>
  p.groups.map((g) => [g.name, g.slides.map((s) => (s.elements[0] as TextElement).text)]);

describe('parseLyricsText', () => {
  it('splits slides at blank lines and starts groups at [headers]', () => {
    const p = parse(
      [
        '[Verse 1]',
        'Placeholder line one',
        'Placeholder line two',
        '',
        'Placeholder line three',
        '',
        '',
        '[Chorus]',
        'Placeholder chorus',
        '',
      ].join('\n'),
    );
    expect(p.name).toBe('Placeholder Song');
    expect(texts(p)).toEqual([
      ['Verse 1', ['Placeholder line one\nPlaceholder line two', 'Placeholder line three']],
      ['Chorus', ['Placeholder chorus']],
    ]);
    expect(p.groups.map((g) => g.color)).toEqual(['#3e63dd', '#e5484d']);
    expect(p.arrangements).toEqual([]);
    expect(p.issues).toEqual([]);
    expect(p.ref).toBeNull();
  });

  it('puts text before the first header into a group with no name', () => {
    const p = parse('Placeholder title\n\n[Verse]\nPlaceholder verse');
    expect(texts(p)).toEqual([
      ['', ['Placeholder title']],
      ['Verse', ['Placeholder verse']],
    ]);
  });

  it('turns a repeated header with no text into an arrangement', () => {
    const p = parse('[Verse 1]\nV1\n\n[Chorus]\nC\n\n[Verse 2]\nV2\n\n[Chorus]\n\n[chorus]\n');
    expect(p.groups.map((g) => g.name)).toEqual(['Verse 1', 'Chorus', 'Verse 2']);
    expect(p.arrangements).toEqual([{ name: 'As written', groups: [0, 1, 2, 1, 1], ref: null }]);
    // As written is how it is sung: it is the arrangement played.
    expect(p.selectedArrangement).toBe(0);
  });

  it('leaves out a header with no text that repeats nothing, and says so', () => {
    const p = parse('[Verse]\nV\n\n[Bridge]\n');
    expect(p.groups.map((g) => g.name)).toEqual(['Verse']);
    expect(p.issues.map((i) => i.code)).toEqual(['empty-group']);
  });

  it('handles Windows and old Mac line endings, tabs and trailing spaces', () => {
    const p = parse('[Verse]\r\nfirst\tline  \r\nsecond\r\r\nthird\rfourth');
    expect(texts(p)).toEqual([['Verse', ['first line\nsecond', 'third\nfourth']]]);
  });

  it('gives each line the language of its script, and one box styled runs when they differ', () => {
    const p = parse('નમૂનાની પહેલી પંક્તિ\nNamūnānī pahelī paṅkti\n\nPlaceholder English only');
    const [mixed, english] = p.groups[0]?.slides.map((s) => s.elements[0] as TextElement) ?? [];
    expect(mixed?.lang).toBe('gu');
    expect(mixed?.runs).toEqual([
      { text: 'નમૂનાની પહેલી પંક્તિ\n', lang: 'gu' },
      { text: 'Namūnānī pahelī paṅkti', lang: 'translit' },
    ]);
    expect(english?.lang).toBe('en');
    expect(english?.runs).toBeUndefined();
    for (const el of [mixed, english]) expect(slideElementSchema.safeParse(el).success).toBe(true);
  });

  it('reports a file with no text', () => {
    const p = parse('\n\n  \n[Verse]\n');
    expect(p.groups).toEqual([]);
    expect(p.issues.map((i) => i.code)).toEqual(['empty-group', 'no-slides']);
  });

  it('cuts a slide that is too long for one text box, and says so', () => {
    const p = parse('x'.repeat(25_000));
    expect((p.groups[0]?.slides[0]?.elements[0] as TextElement).text).toHaveLength(20_000);
    expect(p.issues.map((i) => i.code)).toEqual(['text-cut']);
  });

  it('names presentations after the file', () => {
    expect(nameFromFile('/a/b/Placeholder Song.txt')).toBe('Placeholder Song');
    expect(nameFromFile('C:\\Lyrics\\Other Song.TXT')).toBe('Other Song');
    expect(nameFromFile('/a/.txt')).toBe('Untitled');
  });

  it('colours the usual group names', () => {
    expect(groupColor('Verse 2')).toBe('#3e63dd');
    expect(groupColor('Pre-Chorus')).toBe('#f76b15');
    expect(groupColor('CHORUS')).toBe('#e5484d');
    expect(groupColor('ટેક')).toBe('#e5484d');
    expect(groupColor('Bridge')).toBe('#8e4ec6');
    expect(groupColor('Ending')).toBe('#12a594');
    expect(groupColor('Announcement')).toBeNull();
  });
});
