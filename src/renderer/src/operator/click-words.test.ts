import { describe, expect, it } from 'vitest';
import type { SlideLayer } from '../../../shared/engine/state';
import { clickWords } from './StatusLine';

/* LIVE's line says which of a deck's clicks is up (Session 54, C2); any other slide says nothing more. */

const layer = (steps: number, step?: number): SlideLayer => ({
  presentationId: 'p',
  slideIndex: 0,
  shownAt: 1000,
  notes: '',
  ...(step === undefined ? {} : { step }),
  slide: {
    id: 's',
    width: 1920,
    height: 1080,
    background: null,
    elements: [],
    deck: {
      steps: Array.from({ length: steps }, (_, i) => ({
        clipId: `c${String(i)}`,
        clipMs: 500,
        lastId: `l${String(i)}`,
      })),
      media: [],
    },
  },
});

describe('LIVE’s line for a deck’s slide (Session 54, C2)', () => {
  it('says the click up, or how many are to come', () => {
    expect(clickWords(layer(3, 0))).toBe(' · 2 clicks to come');
    expect(clickWords(layer(2))).toBe(' · 1 click to come');
    expect(clickWords(layer(3, 2))).toBe(' · click 2 of 2');
    expect(clickWords(layer(1, 0))).toBe('');
    expect(clickWords(null)).toBe('');
  });
});
