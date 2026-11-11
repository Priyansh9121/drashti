import { describe, expect, it } from 'vitest';
import { emptyLayers, nothingUp } from './state';

/*
 * Nothing up at all (Session 56): every layer empty and no timer for the audience. Only then does an import draw a
 * PDF's pages several at once (main/pictures/pdf-pictures.ts).
 */

describe('nothing up', () => {
  it('is so with every layer empty, and not with anything on a layer or a timer for the audience', () => {
    const empty = emptyLayers();
    expect(nothingUp(empty)).toBe(true);
    expect(nothingUp({ ...empty, messages: [{ id: 'm', text: 'Placeholder' }] })).toBe(false);
    expect(nothingUp({ ...empty, slide: {} as never })).toBe(false);
    expect(nothingUp({ ...empty, audio: {} as never })).toBe(false);
    expect(nothingUp({ ...empty, timer: {} as never })).toBe(false);
    expect(nothingUp({ ...empty, timer: null })).toBe(true);
  });
});
