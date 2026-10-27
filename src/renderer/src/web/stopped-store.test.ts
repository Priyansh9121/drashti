import { describe, expect, it } from 'vitest';
import { STOPPED_REFUSAL } from '../../../shared/access';
import { heardLetIn, heardStopped, isStoppedAnswer, useStopped } from './stopped-store';

/* A phone hears that Drashti has stopped (Session 54): from a refusal in Drashti's own words, until let in again. */

describe('a phone hearing that Drashti has stopped (Session 54)', () => {
  it('takes only Drashti’s own refusal for it, and forgets it once the feed is let in again', () => {
    expect(isStoppedAnswer(503, STOPPED_REFUSAL)).toBe(true);
    expect(isStoppedAnswer(503, 'Drashti is busy: try again.')).toBe(false);
    expect(isStoppedAnswer(403, STOPPED_REFUSAL)).toBe(false);
    expect(useStopped.getState().stopped).toBe(false);
    heardStopped();
    expect(useStopped.getState().stopped).toBe(true);
    heardLetIn();
    expect(useStopped.getState().stopped).toBe(false);
  });
});
