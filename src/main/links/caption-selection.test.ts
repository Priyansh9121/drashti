import { describe, expect, it } from 'vitest';
import { captionArgs, parseDetails } from './youtube';

const track = (language: string, translated = false) => [
  {
    ext: 'vtt',
    url: `https://captions.invalid/placeholder?lang=en${translated ? `&tlang=${language}` : ''}`,
  },
];
const read = (extra: Record<string, unknown>) => {
  const result = parseDetails(
    JSON.stringify({ id: 'AAAAAAAAAAA', title: 'Placeholder title', duration: 12, formats: [], ...extra }),
  );
  return result.ok ? result.details : null;
};

describe('YouTube caption selection', () => {
  it('takes every creator language and the original automatic track, even when a creator used that language too', () => {
    expect(
      read({
        language: 'en',
        subtitles: { gu: track('gu'), en: track('en') },
        automatic_captions: {
          'en-orig': track('en'),
          en: track('en'),
          hi: track('hi', true),
          fr: track('fr', true),
        },
      }),
    ).toMatchObject({
      captions: [
        { language: 'en', source: 'en', kind: 'creator' },
        { language: 'gu', source: 'gu', kind: 'creator' },
        { language: 'en', source: 'en-orig', kind: 'automatic' },
      ],
    });
  });

  it('can identify the original without the language field, and never selects a machine translation', () => {
    expect(read({ automatic_captions: { hi: track('hi', true), 'en-orig': track('en') } })).toMatchObject({
      captions: [{ language: 'en', source: 'en-orig', kind: 'automatic' }],
    });
    expect(
      read({ language: 'fr', automatic_captions: { fr: track('fr', true), hi: track('hi', true) } }),
    ).toMatchObject({ captions: [] });
    expect(read({ language: 'en', automatic_captions: { en: track('en') } })).toMatchObject({
      captions: [{ language: 'en', source: 'en', kind: 'automatic' }],
    });
  });

  it('leaves out empty tracks and unsafe language codes', () => {
    expect(
      read({
        subtitles: { '../../escape': track('en'), 'en,all': track('en'), en: [], 'pt-BR': track('pt-BR') },
      }),
    ).toMatchObject({ captions: [{ language: 'pt-BR', source: 'pt-BR', kind: 'creator' }] });
  });

  it('uses the same isolated tools for a single exact caption, converts to SRT, and downloads no media', () => {
    const args = captionArgs(
      { deno: 'placeholder-deno', ffmpeg: 'placeholder-ffmpeg' },
      'https://www.youtube.com/watch?v=AAAAAAAAAAA',
      { language: 'en', source: 'en-orig', kind: 'automatic' },
      '/placeholder/work',
    );
    expect(args).toEqual(
      expect.arrayContaining([
        '--ignore-config',
        '--no-plugin-dirs',
        '--no-cookies',
        '--no-cookies-from-browser',
        '--no-cache-dir',
        '--no-remote-components',
        '--skip-download',
        '--write-auto-subs',
        '--no-write-subs',
        '--convert-subs',
        'srt',
      ]),
    );
    expect(args[args.indexOf('--sub-langs') + 1]).toBe('en-orig');
    expect(args).not.toContain('all');
  });
});
