import { describe, expect, it, vi } from 'vitest';
import type { CaptionRevision } from '../../shared/caption-coordinator';
import { CaptionStabilizer, type CaptionObservation } from './caption-stabilizer';

function setup() {
  const clauses: CaptionRevision[] = [];
  const omitted = vi.fn();
  const adapter = new CaptionStabilizer({ sessionId: 'session', inputEpoch: 'input', sourceLanguage: 'en', targetLanguage: 'hi', emit: c => clauses.push(c), omitted });
  const observation = (text: string, sequence: number, observedAt: number, final = false, enginePhraseId = 's1'): CaptionObservation => ({ sessionId: 'session', inputEpoch: 'input', enginePhraseId, sequence, observedAt, text, final, startAt: 0, endAt: observedAt });
  return { adapter, clauses, omitted, observation };
}

describe('stable source frontier', () => {
  it('settles an unchanged prefix only after five words and 500 ms, then final emits only the remainder', () => {
    const { adapter, clauses, observation } = setup();
    expect(adapter.observe(observation('The blue box is beside a round shape', 1, 0))).toBe(true);
    expect(clauses.map(c => c.status)).toEqual(['provisional']);
    adapter.observe(observation('The blue box is beside a round shape', 2, 250));
    expect(clauses).toHaveLength(1);
    adapter.observe(observation('The blue box is beside a round shape today', 3, 500));
    expect(clauses.filter(c => c.status === 'settled').map(c => c.sourceText)).toEqual(['The blue box is beside a round shape']);
    expect(clauses.at(-1)).toMatchObject({ phraseId: 's2', sourceText: 'today', status: 'provisional' });
    adapter.observe(observation('The blue box is beside a round shape today', 4, 700, true));
    expect(clauses.filter(c => c.status === 'settled').map(c => c.sourceText)).toEqual(['The blue box is beside a round shape', 'today']);
    expect(adapter.observe(observation('Changed final', 5, 800, true))).toBe(false);
    expect(clauses.filter(c => c.status === 'settled')).toHaveLength(2);
  });
  it('keeps fewer than five repeated words provisional until a final and rejects stale session/input/sequence', () => {
    const { adapter, clauses, observation } = setup();
    adapter.observe(observation('One blue box', 1, 0));
    adapter.observe(observation('One blue box', 2, 600));
    expect(clauses).toHaveLength(1);
    expect(adapter.observe({ ...observation('Wrong session', 3, 700), sessionId: 'old' })).toBe(false);
    expect(adapter.observe({ ...observation('Wrong input', 3, 700), inputEpoch: 'old' })).toBe(false);
    expect(adapter.observe(observation('Old observation', 1, 700))).toBe(false);
    adapter.observe(observation('One green box', 3, 700, true));
    expect(clauses.at(-1)).toMatchObject({ phraseId: 's1', revision: 2, status: 'settled', sourceText: 'One green box' });
  });
  it('revises the committed clause in place when ASR changes a settled word, without a second final', () => {
    const { adapter, clauses, observation } = setup();
    adapter.observe(observation('The blue box is beside a round shape', 1, 0));
    adapter.observe(observation('The blue box is beside a round shape', 2, 500));
    adapter.observe(observation('The green box is beside a round shape', 3, 700));
    expect(clauses.at(-1)).toMatchObject({ phraseId: 's1', revision: 3, status: 'corrected', sourceText: 'The green box is beside a round shape' });
    adapter.observe(observation('The green box is beside a round shape', 4, 900, true));
    expect(clauses.filter(c => c.status === 'settled')).toHaveLength(1);
  });
  it('deduplicates a forced overlap only with exact explicit scalar ranges and otherwise omits it', () => {
    const { adapter, clauses, omitted, observation } = setup();
    const first = 'The blue box is beside a round shape';
    adapter.observe(observation(first, 1, 0, true));
    const overlap = 'round shape';
    const second = 'round shape and a green square';
    expect(adapter.observe({ ...observation(second, 1, 700, true, 's2'), forcedContinuation: true, overlap: { previousEnginePhraseId: 's1', previousRange: [[...first].length - [...overlap].length, [...first].length], currentRange: [0, [...overlap].length] } })).toBe(true);
    expect(clauses.at(-1)?.sourceText).toBe('and a green square');
    expect(adapter.observe({ ...observation('green square and a circle', 1, 900, true, 's3'), forcedContinuation: true })).toBe(false);
    expect(omitted).toHaveBeenCalledWith('ambiguous-overlap');
  });
});
