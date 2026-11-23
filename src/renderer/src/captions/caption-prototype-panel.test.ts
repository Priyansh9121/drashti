import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CaptionReview } from '../../../shared/caption-coordinator';
import { CaptionPrototypeControls, latestCaptionReview } from './CaptionPrototypePanel';

const view: CaptionReview = { on: false, version: 1, canCorrect: false, sessionId: null, current: null, previous: null, busy: false, omitted: 0 };
const clause = { sessionId: 'new-session', phraseId: 's1', revision: 1, sourceLanguage: 'en' as const, targetLanguage: 'hi' as const, sourceText: 'The blue box', startAt: 1, endAt: 2, status: 'provisional' as const };
const render = (review: CaptionReview) => renderToStaticMarkup(createElement(CaptionPrototypeControls, { review, take: () => undefined }));
describe('ephemeral operator correction panel', () => {
  it('has an explicit off switch and explains the placeholder recognizer without exposing an off review', () => {
    const html = render({ ...view, current: clause });
    expect(html).toContain('captions-prototype-on');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('No sound input or model');
    expect(html).not.toContain('The blue box');
  });
  it('distinguishes provisional from settled words and offers corrections only for settled clauses', () => {
    const provisional = render({ ...view, on: true, sessionId: 'new-session', current: clause });
    expect(provisional).toContain('Provisional');
    expect(provisional).toContain('The blue box');
    expect(provisional).not.toContain('Correct last phrase');
    const settled = render({ ...view, canCorrect: true, on: true, sessionId: 'new-session', current: { ...clause, status: 'settled' } });
    expect(settled).toContain('Settled');
    expect(settled).toContain('Correct last phrase');
    expect(settled).toContain('Dismiss phrase');
  });
  it('refuses a late IPC review snapshot even when a phrase id repeats after restart', () => {
    const current = { ...view, version: 5, on: true, sessionId: 'new-session', current: clause };
    const stale = { ...current, version: 4, sessionId: 'old-session', current: { ...clause, sessionId: 'old-session' } };
    expect(latestCaptionReview(current, stale)).toBe(current);
    expect(latestCaptionReview(stale, current)).toBe(current);
  });
});
