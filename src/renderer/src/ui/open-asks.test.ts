import { describe, expect, it } from 'vitest';
import { openAsks } from './open-asks';

/*
 * Asks to unfold a section (alpha.24: a chat popup's click opens Chat; the review's MUST 3): a section takes only an ask
 * made after it mounted, and each only once. Mounted again later (Pro Mode → Simple Mode → Pro Mode, or once the
 * practice show ends), it finds the old asks standing and stays as the operator left it, folded or open, with nothing
 * scrolled: LIVE_SECTION's rule, "kept as the operator leaves it while Drashti runs".
 */

describe('an ask to unfold a section', () => {
  it('made after the section mounted: taken, once', () => {
    const asks = openAsks(0);
    expect(asks.take(0)).toBe(false);
    // A popup's click.
    expect(asks.take(1)).toBe(true);
    // The same ask seen again (the section drawn again, or its effect run again): not taken twice.
    expect(asks.take(1)).toBe(false);
    // The next click.
    expect(asks.take(2)).toBe(true);
  });

  it('made before it mounted: never taken, so a folded section stays folded', () => {
    // Opened once from a popup (ask 1), folded by the operator, then mounted again with the ask still standing.
    const again = openAsks(1);
    expect(again.take(1)).toBe(false);
    // Only a click after that opens it.
    expect(again.take(2)).toBe(true);
  });
});
