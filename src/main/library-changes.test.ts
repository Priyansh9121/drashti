import { describe, expect, it } from 'vitest';
import { CHANGED_NAMED_MAX, ChangedPresentations } from './library-changes';

/*
 * The presentations a library change names, gathered until Drashti tells the phones (QA24-PHONE-C,
 * a23-review-phonelows LOW-C): a phone then reads again only those of its playlist's rows, never every deck row for a
 * kirtan's words edited. A change that names none (an import, media, a book) means any may have changed. Made-up ids.
 */

describe('the presentations a library change names (QA24-PHONE-C)', () => {
  it('names those of every change gathered, each once', () => {
    const changed = new ChangedPresentations();
    changed.add(['p-one']);
    changed.add(['p-two', 'p-one']);
    expect(changed.take()).toEqual(['p-one', 'p-two']);
  });

  it('names none (any may have changed) when one change gathered could not name its presentations', () => {
    const changed = new ChangedPresentations();
    changed.add(['p-one']);
    changed.add();
    changed.add(['p-two']);
    expect(changed.take()).toBeUndefined();
  });

  it('gathers afresh after each telling', () => {
    const changed = new ChangedPresentations();
    changed.add();
    expect(changed.take()).toBeUndefined();
    changed.add(['p-three']);
    expect(changed.take()).toEqual(['p-three']);
    changed.add([]);
    expect(changed.take()).toEqual([]);
  });

  it('names none past CHANGED_NAMED_MAX (a theme applied to many: the phones read them all again)', () => {
    const changed = new ChangedPresentations();
    changed.add(Array.from({ length: CHANGED_NAMED_MAX }, (_, i) => `p-${String(i)}`));
    expect(changed.take()).toHaveLength(CHANGED_NAMED_MAX);
    changed.add(Array.from({ length: CHANGED_NAMED_MAX + 1 }, (_, i) => `p-${String(i)}`));
    expect(changed.take()).toBeUndefined();
  });
});
