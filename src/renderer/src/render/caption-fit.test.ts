import { describe, expect, it } from 'vitest';
import { fittedCaptionFont } from './caption-fit';

describe('clause caption fitting', () => {
  it('fits the actual widest line while keeping a short line at its chosen size', () => {
    expect(fittedCaptionFont(56, 900, 1_200)).toBe(42);
    expect(fittedCaptionFont(56, 900, 600)).toBe(56);
    expect(fittedCaptionFont(56, 900, 0)).toBe(56);
    expect(fittedCaptionFont(56, 0, 600)).toBe(56);
  });
});
