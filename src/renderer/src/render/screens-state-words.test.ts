import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import { screensStateNote, screensStateWords } from './StageView';

/*
 * What a stage screen says of the audience screens: a stage layout's box of their state, and the Standard stage
 * screen's line beside NOW. With Audience off they show this computer's desktop, whatever is up (Session 51).
 */

const nothing = initialEngineState();
const black = { ...nothing, blackout: true };
const logo = { ...nothing, logo: { id: 'placeholder-logo', name: 'Placeholder logo', elements: [] } };
const showing = {
  ...nothing,
  layers: { ...nothing.layers, background: { kind: 'color' as const, color: '#1f6f8b' } },
};

describe('a stage screen’s words for the audience screens', () => {
  it('says they are off while Audience is off, before black-out, the logo or a picture', () => {
    for (const state of [nothing, black, logo, showing]) {
      expect(screensStateWords(state, true)).toBe('Audience screens off');
      expect(screensStateNote(state, true)).toBe(' · AUDIENCE SCREENS OFF');
    }
  });

  it('keeps its words while they are on', () => {
    expect(screensStateWords(black, false)).toBe('Audience screens black');
    expect(screensStateWords(logo, false)).toBe('Logo on the audience screens');
    expect(screensStateWords(showing, false)).toBe('Audience screens showing');
    expect(screensStateWords(nothing, false)).toBe('Nothing on the audience screens');
    expect(screensStateNote(black, false)).toBe(' · AUDIENCE SCREENS BLACK');
    expect(screensStateNote(logo, false)).toBe(' · LOGO ON THE AUDIENCE SCREENS');
    expect(screensStateNote(showing, false)).toBe('');
    expect(screensStateNote(nothing, false)).toBe('');
  });
});
