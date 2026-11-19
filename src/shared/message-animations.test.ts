import { describe, expect, it } from 'vitest';
import { findAnimations } from './lower-third-search';
import { messageAnimationChoices } from './message-animations';
import { MESSAGE_FIRST_ANIMATIONS } from './message-look';

/*
 * Messages' look finds an animation with the studio's one search box (Session 59, X14; C13's search): the list shows
 * only what has every word typed, the ones a message offers first still first.
 */

const all = (c: { first: readonly string[]; more: readonly string[] }) => [...c.first, ...c.more];

describe('the animations Messages’ look offers, found by the one search box (X14)', () => {
  it('nothing typed: all of them, a message’s own first', () => {
    const c = messageAnimationChoices('');
    expect(c.first.length).toBeGreaterThan(0);
    expect(c.first.every((id) => (MESSAGE_FIRST_ANIMATIONS as readonly string[]).includes(id))).toBe(true);
    expect(new Set(all(c)).size).toBe(all(c).length);
    expect(all(c).length).toBe(findAnimations('', 'in').length);
  });

  it('words typed: only what the studio’s search finds coming in, in the same order, a message’s own still first', () => {
    for (const query of ['slide left', 'fade', 'soft', 'letters', 'fast from below']) {
      const c = messageAnimationChoices(query);
      const found = findAnimations(query, 'in').map((o) => o.animation.id);
      expect(all(c).length, query).toBeGreaterThan(0);
      expect(new Set(all(c)), query).toEqual(new Set(found));
      expect(all(c).length, query).toBeLessThan(
        messageAnimationChoices('').first.length + messageAnimationChoices('').more.length,
      );
      expect(c.first, query).toEqual(messageAnimationChoices('').first.filter((id) => found.includes(id)));
    }
  });

  it('words nothing has: nothing', () => {
    expect(all(messageAnimationChoices('zzzz nothing'))).toEqual([]);
  });
});
