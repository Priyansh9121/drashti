import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CaptionScreen, CaptionsShown } from '../../../shared/captions';
import { stateWithoutCaptions, withoutCaptions } from '../../../shared/engine/captions-filter';
import { initialEngineState, type EngineState } from '../../../shared/engine/state';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import { CaptionsView } from './CaptionsView';
import { Scene } from './Scene';
import { StageScreen } from './StageScreen';

/*
 * Translated live captions on the screens (alpha.24, QA24-CAPLANG-2, the owner's 2b A): the audience screens (only
 * when chosen) and the stream draw the translation, a long one as two-line pages, one page at a time and never cut
 * with "…"; the stage screens draw the speaker's own words; nothing shows on the audience screens or the stream while
 * a translation is not ready (never the speaker's words in its place); phones and nodes get no live captions at all.
 * Every caption band is drawn by CaptionsView: the hall's screens and the operator's LIVE and Screens previews (Scene,
 * place "hall"), the stream's page and a key and fill pair (Scene and ProgramView, "stream"), and the stage screens,
 * the stage preview and the Stage preview window (StageScreen, "stage"). Placeholder words only.
 */

const CANVAS = { width: 1920, height: 1080 };

const TRANSLATED: CaptionsShown = {
  kind: 'translation',
  lines: ['Placeholder translated line one', 'placeholder translated line two'],
  language: 'hi',
  audience: true,
  size: 'medium',
  place: 'bottom',
  fit: true,
  page: { n: 1, of: 2 },
  stage: { lines: ['Placeholder spoken words'], language: 'gu', fit: true },
};

const withCaptions = (captions: CaptionsShown | null): EngineState => ({ ...initialEngineState(), captions });

const band = (state: EngineState, screen: CaptionScreen) =>
  renderToStaticMarkup(createElement(CaptionsView, { state, canvas: CANVAS, screen }));
/** The lines a band draws, in order. */
const linesOf = (html: string) =>
  [...html.matchAll(/<div style="white-space:nowrap;overflow:hidden">([^<]*)<\/div>/gu)].map((m) => m[1]);
const attr = (html: string, name: string) =>
  new RegExp(`data-testid="captions"[^>]*\\s${name}="([^"]*)"`, 'u').exec(html)?.[1] ??
  new RegExp(`\\s${name}="([^"]*)"[^>]*data-testid="captions"`, 'u').exec(html)?.[1] ??
  null;
const langOf = (html: string) =>
  /<div[^>]*\slang="([^"]+)"[^>]*data-testid="captions"|data-testid="captions"[^>]*\slang="([^"]+)"/u
    .exec(html)
    ?.slice(1)
    .find(Boolean) ?? null;

describe('translated live captions on each kind of screen (alpha.24, 2b A)', () => {
  it('the audience screens and the stream draw the translation, its page marked, in its language', () => {
    for (const screen of ['hall', 'stream'] as const) {
      const html = band(withCaptions(TRANSLATED), screen);
      expect(linesOf(html), screen).toEqual(TRANSLATED.lines);
      expect(attr(html, 'data-kind'), screen).toBe('translation');
      expect(attr(html, 'data-page'), screen).toBe('1/2');
      expect(attr(html, 'data-screen'), screen).toBe(screen);
      expect(langOf(html), screen).toBe('hi');
      expect(html, screen).not.toContain('Placeholder spoken words');
    }
  });

  it('the stage screens draw the speaker’s own words, in the speaker’s language, not the translation', () => {
    const html = band(withCaptions(TRANSLATED), 'stage');
    expect(linesOf(html)).toEqual(['Placeholder spoken words']);
    expect(langOf(html)).toBe('gu');
    expect(attr(html, 'data-kind')).toBeNull();
    expect(attr(html, 'data-page')).toBeNull();
    expect(html).not.toContain('Placeholder translated');
  });

  it('a long translation: one two-line page at a time, the next page as it comes, never cut short with "…"', () => {
    const first = band(withCaptions(TRANSLATED), 'stream');
    const second = band(
      withCaptions({ ...TRANSLATED, lines: ['Placeholder second page words'], page: { n: 2, of: 2 } }),
      'stream',
    );
    expect(linesOf(first)).toHaveLength(2);
    expect(linesOf(second)).toEqual(['Placeholder second page words']);
    expect(attr(second, 'data-page')).toBe('2/2');
    for (const html of [first, second]) {
      expect(html).not.toContain('…');
      expect(html).not.toContain('...');
      expect(html).not.toMatch(/text-overflow/u);
    }
    // Speech in the speaker's own words is not marked as a page or a translation (today's captions).
    const own = band(
      withCaptions({
        lines: ['Placeholder heard'],
        language: 'gu',
        audience: true,
        size: 'medium',
        place: 'bottom',
      }),
      'stream',
    );
    expect(attr(own, 'data-kind')).toBeNull();
    expect(attr(own, 'data-page')).toBeNull();
    expect(linesOf(own)).toEqual(['Placeholder heard']);
  });

  it('nothing on the audience screens or the stream while the translation is not ready: never the speaker’s words in its place', () => {
    const { page: _page, ...unpaged } = TRANSLATED;
    const waiting = withCaptions({ ...unpaged, lines: [] });
    expect(band(waiting, 'hall')).toBe('');
    expect(band(waiting, 'stream')).toBe('');
    // The stage still shows the speaker.
    expect(linesOf(band(waiting, 'stage'))).toEqual(['Placeholder spoken words']);
    // Nothing for the stage now: the stage draws nothing, the others the translation.
    const noStage = withCaptions({ ...TRANSLATED, stage: null });
    expect(band(noStage, 'stage')).toBe('');
    expect(linesOf(band(noStage, 'stream'))).toEqual(TRANSLATED.lines);
  });

  it('the audience screens only when chosen, as today; the stream and the stage always', () => {
    const notChosen = withCaptions({ ...TRANSLATED, audience: false });
    expect(band(notChosen, 'hall')).toBe('');
    expect(linesOf(band(notChosen, 'stream'))).toEqual(TRANSLATED.lines);
    expect(linesOf(band(notChosen, 'stage'))).toEqual(['Placeholder spoken words']);
  });

  it('every renderer draws it so: a hall screen and the previews (Scene), the stream (Scene, stream), the stage screens (StageScreen)', () => {
    const state = withCaptions(TRANSLATED);
    const hall = renderToStaticMarkup(createElement(Scene, { state, canvas: CANVAS, scaling: 'fit' }));
    const stream = renderToStaticMarkup(
      createElement(Scene, { state, canvas: CANVAS, scaling: 'fit', place: 'stream', ticker: false }),
    );
    const stage = renderToStaticMarkup(
      createElement(StageScreen, { state, look: DEFAULT_LIVE_GROUP_LOOK, canvas: CANVAS }),
    );
    expect(attr(hall, 'data-kind')).toBe('translation');
    expect(linesOf(hall)).toEqual(TRANSLATED.lines);
    expect(attr(stream, 'data-kind')).toBe('translation');
    expect(attr(stream, 'data-screen')).toBe('stream');
    expect(linesOf(stream)).toEqual(TRANSLATED.lines);
    expect(attr(stage, 'data-screen')).toBe('stage');
    expect(linesOf(stage)).toEqual(['Placeholder spoken words']);
    expect(stage).not.toContain('Placeholder translated');
    // A screen that draws no captions of its own (a stage screen's audience picture, the stream's Camera layout).
    const off = renderToStaticMarkup(
      createElement(Scene, { state, canvas: CANVAS, scaling: 'fit', captions: false }),
    );
    expect(off).not.toContain('data-testid="captions"');
  });

  it('phones, the API and output nodes are given no live captions, translated or not (unchanged)', () => {
    const state = withCaptions(TRANSLATED);
    expect(stateWithoutCaptions(state).captions).toBeNull();
    const message = withoutCaptions({ kind: 'snapshot', version: 1, rev: 3, state, sentAt: 0 });
    expect(message.state.captions).toBeNull();
    const patch = withoutCaptions({
      kind: 'patch',
      version: 1,
      baseRev: 3,
      rev: 4,
      ops: [{ path: ['captions'], value: TRANSLATED }],
      sentAt: 0,
    });
    expect(patch.ops).toEqual([]);
  });
});
