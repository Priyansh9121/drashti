import { describe, expect, it } from 'vitest';
import { answered, changed, shownValue, type Unsaved } from './saved-setting';

/*
 * A setting the main process saves, as its boxes show it (Session 54, Session 53's question 6): a Look's layers and
 * languages, what an Events out address gets. Each box showed what was saved, and a tick changed that: a second
 * tick made before the first was saved changed what was saved before the first, and put the first back.
 */

const HALL = 'placeholder-look:hall:layers';
const SIDE = 'placeholder-look:side:layers';

describe('a setting the main process saves, as its boxes show it', () => {
  it('shows what was saved until a change is made', () => {
    expect(shownValue(['background', 'slide'], null, HALL)).toEqual(['background', 'slide']);
  });

  it('makes a second change, before the first is saved, to what the first left, showing the latest until both are saved', () => {
    const saved = ['background', 'slide', 'messages'];
    // The first tick: Background off, shown at once.
    const one = saved.filter((l) => l !== 'background');
    let unsaved: Unsaved<string[]> | null = changed(null, HALL, one);
    expect(shownValue(saved, unsaved, HALL)).toEqual(['slide', 'messages']);
    // The second, before the first is saved: made to what the first left, never to what was saved before it.
    const two = shownValue(saved, unsaved, HALL).filter((l) => l !== 'messages');
    unsaved = changed(unsaved, HALL, two);
    expect(shownValue(saved, unsaved, HALL)).toEqual(['slide']);
    // The first is saved (what was saved now leaves Background off): the second is still shown.
    unsaved = answered(unsaved, HALL);
    expect(shownValue(one, unsaved, HALL)).toEqual(['slide']);
    // The second is saved: what was saved is shown again, both kept.
    unsaved = answered(unsaved, HALL);
    expect(unsaved).toBeNull();
    expect(shownValue(two, unsaved, HALL)).toEqual(['slide']);
  });

  it('shows what was saved once every change has answered, so a change refused goes back', () => {
    const saved = ['background', 'slide'];
    let unsaved: Unsaved<string[]> | null = changed(null, HALL, ['slide']);
    expect(shownValue(saved, unsaved, HALL)).toEqual(['slide']);
    unsaved = answered(unsaved, HALL);
    expect(shownValue(saved, unsaved, HALL)).toEqual(['background', 'slide']);
  });

  it('never shows one setting’s change as another’s (another group, or the same group in another Look)', () => {
    const unsaved = changed(null, HALL, ['slide']);
    expect(shownValue(['background', 'slide'], unsaved, SIDE)).toEqual(['background', 'slide']);
    // A change to the other starts afresh; the first's answer, coming after, leaves it as it is.
    const side = changed(unsaved, SIDE, ['background']);
    expect(side).toEqual({ key: SIDE, value: ['background'], waiting: 1 });
    expect(answered(side, HALL)).toBe(side);
    expect(answered(side, SIDE)).toBeNull();
  });

  it('keeps a value of none (all of a kirtan’s languages) as a change like any other', () => {
    const unsaved = changed<string[] | null>(null, HALL, null);
    expect(shownValue<string[] | null>(['gu'], unsaved, HALL)).toBeNull();
  });
});
