import { describe, expect, it } from 'vitest';
import { summaryMarkdown, type Verdict, verdictLine } from '../../../tests/soak/report';

/* The Soak's summary (Sessions 31–36, TST-13): its first line counts the non-fatal checks that failed. */

const verdict = (name: string, ok: boolean, fatal: boolean): Verdict => ({
  name,
  ok,
  detail: 'placeholder',
  fatal,
});

describe('the Soak’s summary', () => {
  it('says first how many non-fatal checks failed, then the fatal ones', () => {
    const verdicts = [
      verdict('Placeholder crash check', true, true),
      verdict('Placeholder phone check', false, false),
      verdict('Placeholder backup check', false, false),
      verdict('Placeholder stream check', true, true),
    ];
    expect(verdictLine(verdicts)).toBe('2 non-fatal checks failed; 0 fatal checks failed (of 4).');
    const summary = summaryMarkdown({
      os: 'macOS',
      minutes: 180,
      samples: [],
      events: [],
      verdicts,
    } as never);
    expect(summary.split('\n')[0]).toBe('**2 non-fatal checks failed; 0 fatal checks failed (of 4).**');
    expect(verdictLine([verdict('Placeholder', false, true)])).toBe(
      '0 non-fatal checks failed; 1 fatal check failed (of 1).',
    );
  });
});
