import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CaptionReview } from '../../../shared/caption-coordinator';
import {
  CaptionPrototypeControls,
  correctionProblem,
  correctionStanding,
  latestCaptionReview,
} from './CaptionPrototypePanel';

const view: CaptionReview = {
  on: false,
  version: 1,
  canCorrect: false,
  sessionId: null,
  current: null,
  previous: null,
  busy: false,
  omitted: 0,
};
const clause = {
  sessionId: 'new-session',
  phraseId: 's1',
  revision: 1,
  sourceLanguage: 'en' as const,
  targetLanguage: 'hi' as const,
  sourceText: 'The blue box',
  startAt: 1,
  endAt: 2,
  status: 'provisional' as const,
};
const render = (review: CaptionReview) =>
  renderToStaticMarkup(createElement(CaptionPrototypeControls, { review, take: () => undefined }));
describe('ephemeral operator correction panel', () => {
  it('offers no placeholder rehearsal (the lead: Q-CAPI-4 A) and shows nothing of a review while caption AI is not listening', () => {
    const html = render({ ...view, current: clause });
    expect(html).not.toContain('captions-prototype-on');
    expect(html.toLowerCase()).not.toContain('placeholder');
    expect(html).not.toContain('The blue box');
  });
  it('distinguishes provisional from settled words and offers corrections only for settled clauses', () => {
    const provisional = render({ ...view, on: true, sessionId: 'new-session', current: clause });
    expect(provisional).toContain('Provisional');
    expect(provisional).toContain('The blue box');
    expect(provisional).not.toContain('Correct last phrase');
    const settled = render({
      ...view,
      canCorrect: true,
      on: true,
      sessionId: 'new-session',
      current: { ...clause, status: 'settled' },
    });
    expect(settled).toContain('Settled');
    expect(settled).toContain('Correct last phrase');
    expect(settled).toContain('Dismiss phrase');
  });
  it('refuses a late IPC review snapshot even when a phrase id repeats after restart', () => {
    const current = { ...view, version: 5, on: true, sessionId: 'new-session', current: clause };
    const stale = {
      ...current,
      version: 4,
      sessionId: 'old-session',
      current: { ...clause, sessionId: 'old-session' },
    };
    expect(latestCaptionReview(current, stale)).toBe(current);
    expect(latestCaptionReview(stale, current)).toBe(current);
  });
  it('keeps an open correction when its phrase has left the screens, and says so: never an edit box gone without a word (cap-review-next n2)', () => {
    const draft = { sessionId: 'new-session', phraseId: 's1', revision: 1, text: 'The blue box' };
    const settled = { ...clause, status: 'settled' as const };
    // On the screens as it was opened: open; corrected or settled again since: changed; none open: none.
    expect(correctionStanding(draft, settled)).toBe('open');
    expect(correctionStanding(draft, { ...settled, revision: 2 })).toBe('changed');
    expect(correctionStanding(null, settled)).toBe('none');
    expect(correctionStanding(null, null)).toBe('none');
    // Its six seconds over (the review's phrase empty), or the next phrase in its place: the edit stays, and says why.
    expect(correctionStanding(draft, null)).toBe('gone');
    expect(correctionStanding(draft, { ...settled, phraseId: 's2' })).toBe('gone');
    expect(correctionProblem('gone', true)).toBe(
      'That phrase has left the screens, so this correction cannot be applied. Close this edit.',
    );
    // As before for the others.
    expect(correctionProblem('changed', true)).toBe('The phrase changed. Close this edit and open it again.');
    expect(correctionProblem('open', false)).toBe('Use a shorter correction with plain text.');
    expect(correctionProblem('open', true)).toBeNull();
  });
});
