import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveBadge, LiveDot } from './Badge';

/*
 * LIVE said once (alpha.24, uitop; the owner's "too congested"): the top bar's LIVE badge says it in words; a playlist's
 * row on the screens says it with a small dot in LIVE's colour beside its red edge, and "Live" to a screen reader, so
 * the row's name is read as before. Placeholder markup only.
 */

const draw = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** What a screen reader reads: the words, less what is hidden from it. */
const read = (html: string) =>
  html
    .replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/gu, '')
    .replace(/<[^>]+>/gu, '')
    .trim();

describe('a row’s LIVE dot', () => {
  it('reads "Live" to a screen reader, as the badge did, and shows no word', () => {
    const dot = draw(createElement(LiveDot));
    expect(read(dot)).toBe('Live');
    expect(read(draw(createElement(LiveBadge)))).toBe('Live');
    // The word is there for screen readers alone; what is seen is the dot.
    expect(dot).toMatch(/<span class="sr-only[^"]*">Live<\/span>/u);
    expect(dot).toMatch(/<span aria-hidden="true" class="[^"]*rounded-full[^"]*bg-live-edge[^"]*"><\/span>/u);
  });

  it('says Live in words in forced colours (a Windows contrast theme), where the dot and the red edge, backgrounds, are the system’s own (the release lead’s review, MUST-1)', () => {
    const dot = draw(createElement(LiveDot));
    expect(dot).toMatch(/<span class="sr-only [^"]*\bforced-colors:not-sr-only\b[^"]*">Live<\/span>/u);
    // The dot, painted over by the theme, gives its room to the word; the box grows to hold it.
    expect(dot).toMatch(/<span aria-hidden="true" class="[^"]*\bforced-colors:hidden\b[^"]*"><\/span>/u);
    expect(dot).toMatch(/data-live-dot="" class="[^"]*\bmin-w-4\b/u);
  });

  it('is no badge: no box, no capitals, nothing a badge’s rules measure', () => {
    const dot = draw(createElement(LiveDot));
    expect(dot).not.toContain('data-badge');
    expect(dot).not.toContain('uppercase');
    expect(dot).not.toMatch(/\bborder\b/u);
    expect(dot).toContain('data-live-dot');
  });
});
