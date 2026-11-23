import { describe, expect, it } from 'vitest';
import { fittedCaptionFont, prepareCaptionFont } from './caption-fit';

describe('clause caption fitting', () => {
  it('fits the actual widest line while keeping a short line at its chosen size', () => {
    expect(fittedCaptionFont(56, 900, 1_200)).toBe(42);
    expect(fittedCaptionFont(56, 900, 600)).toBe(56);
    expect(fittedCaptionFont(56, 900, 0)).toBe(56);
    expect(fittedCaptionFont(56, 0, 600)).toBe(56);
  });
});

it('restores a reused legacy band to its configured size after a fitted clause', () => {
  const style = { fontSize: '42px' };
  expect(prepareCaptionFont(style, 56, false)).toBe(false);
  expect(style.fontSize).toBe('56px');
  style.fontSize = '42px';
  expect(prepareCaptionFont(style, 70, true)).toBe(true);
  expect(style.fontSize).toBe('70px');
});
