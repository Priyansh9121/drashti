import { describe, expect, it } from 'vitest';
import { MARK, middle } from './Mark';

/*
 * The mark beside a name is drawn flat (Session 26g): each part in its gradient's middle colour, from
 * the icon's own colours (src/main/mark.test.ts keeps MARK and build/icon.svg the same).
 */
describe('the small mark’s flat colours', () => {
  it('are each gradient’s middle colour', () => {
    expect(middle(MARK.colours.tile)).toBe('#44133d');
    expect(middle(MARK.colours.flame)).toBe('#ff9e36');
    expect(middle(MARK.colours.bowl)).toBe('#f7b74f');
  });

  it('are halfway between the stops, rounded, in lower case', () => {
    expect(middle(['#000000', '#ffffff'])).toBe('#808080');
    expect(middle(['#0A0B0C', '#0a0b0c'])).toBe('#0a0b0c');
  });
});
