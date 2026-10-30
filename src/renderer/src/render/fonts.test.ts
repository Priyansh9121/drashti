import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOWER_THIRD_FONT_CHOICES } from '../../../shared/lower-third-fonts';
import { LANG_FONT_STACK } from './fonts';

/* The font stacks (Sessions 31–36, I18N-7). */

describe('font stacks', () => {
  it('have both Indian scripts wherever words in them can be, after Latin so Latin letters stay as they were', () => {
    const fonts = (stack: string) => stack.split(', ').map((f) => f.replace(/'/gu, ''));
    for (const lang of ['en', 'default', 'gu', 'sa-gu', 'hi', 'sa'] as const) {
      const list = fonts(LANG_FONT_STACK[lang]);
      expect(list, lang).toContain('Noto Sans Gujarati');
      expect(list, lang).toContain('Noto Sans Devanagari');
    }
    expect(fonts(LANG_FONT_STACK.gu)).toEqual([
      'Noto Sans Gujarati',
      'Noto Sans',
      'Noto Sans Devanagari',
      'sans-serif',
    ]);
    expect(fonts(LANG_FONT_STACK.hi)).toEqual([
      'Noto Sans Devanagari',
      'Noto Sans',
      'Noto Sans Gujarati',
      'sans-serif',
    ]);
    expect(fonts(LANG_FONT_STACK.translit)).toEqual(['Noto Sans', 'sans-serif']);
  });
});

/*
 * What a page's start asks for (Session 55, after the Performance check of 30 Oct 2026: an output's first frame after a
 * crash came 9.1 s after the start on CI's Windows, against alpha.13's 3.6 s). An output, the stream's page and the
 * LIVE picture wait for Drashti's own Noto fonts before they draw (preloadFonts); the Lower Thirds studio's 50 faces
 * (Part 16) are asked for only once the page has drawn, by the page (preloadStudioFonts), never with its start.
 */
describe('fonts at a page’s start', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** A page from the app's files (one of Drashti's own windows) or served to a phone, and the fonts it asks for. */
  function page(protocol: 'file:' | 'http:'): string[] {
    const asked: string[] = [];
    vi.stubGlobal('location', { protocol });
    vi.stubGlobal('document', {
      fonts: {
        load: (font: string) => {
          asked.push(font);
          return Promise.resolve([]);
        },
      },
    });
    return asked;
  }
  const familyOf = (font: string) => /"([^"]+)"/u.exec(font)?.[1] ?? '';
  const STUDIO = LOWER_THIRD_FONT_CHOICES.filter((c) => c.bundled === 'studio');

  it('waits for Drashti’s own Noto fonts, each weight, and asks for none of the Lower Thirds studio’s', async () => {
    const asked = page('file:');
    const { BUNDLED_FAMILIES, BUNDLED_WEIGHTS, preloadFonts } = await import('./fonts');
    // Waited for as a page waits for it: whatever it does once its fonts are in has been done.
    await preloadFonts();
    expect(asked).toHaveLength(BUNDLED_FAMILIES.length * BUNDLED_WEIGHTS.length);
    expect(new Set(asked.map(familyOf))).toEqual(new Set(BUNDLED_FAMILIES));
  });

  it('the studio’s fonts once the page asks (it has drawn): every face of every studio choice, once', async () => {
    const asked = page('file:');
    const { preloadStudioFonts } = await import('./studio-fonts');
    preloadStudioFonts();
    preloadStudioFonts();
    expect(asked).toHaveLength(STUDIO.reduce((n, c) => n + c.families.length * c.weights.length, 0));
    expect(new Set(asked.map(familyOf))).toEqual(new Set(STUDIO.flatMap((c) => c.families)));
  });

  it('a page served to a phone or a browser asks for none of them: each loads when its words need it', async () => {
    const asked = page('http:');
    const { preloadStudioFonts } = await import('./studio-fonts');
    preloadStudioFonts();
    expect(asked).toEqual([]);
  });
});
