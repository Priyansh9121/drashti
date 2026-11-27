import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * LIVE's timer Take off and the audience timer's Hide change what the hall sees (the release lead's bug hunt, S3-1):
 * show controls (Button's `instant`, so data-show-control), as uimotion made the sections' others, so they never dim on a
 * press, lift in Lively or fade their colour. Read from LivePreview.tsx's source, as motion.test.ts's S4 reads the
 * sections'. Their test ids and words stay.
 */

const source = readFileSync(join(__dirname, '..', 'renderer', 'src', 'operator', 'LivePreview.tsx'), 'utf8');

/** The opening tag of the <Button …> that carries this test id. */
function buttonWith(testId: string): string {
  const at = source.indexOf(`data-testid="${testId}"`);
  const start = source.lastIndexOf('<Button', at);
  const end = source.indexOf('>', at);
  return start === -1 || at === -1 ? '' : source.slice(start, end + 1);
}

describe('LIVE’s timer controls', () => {
  it('Take off (a timer alone in the slide’s place) and Hide (the audience timer) are show controls, with their test ids and words', () => {
    for (const [testId, words] of [
      ['live-timer-off', 'Take off'],
      ['live-audience-timer-off', 'Hide'],
    ] as const) {
      const tag = buttonWith(testId);
      expect(tag, testId).toMatch(/^<Button\b/u);
      expect(tag, testId).toMatch(/\binstant\b/u);
      expect(
        source
          .slice(source.indexOf(tag) + tag.length)
          .trimStart()
          .startsWith(words),
        testId,
      ).toBe(true);
    }
  });
});
