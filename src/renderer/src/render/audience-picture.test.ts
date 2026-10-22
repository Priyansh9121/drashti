import { describe, expect, it } from 'vitest';
import type { LiveLook } from '../../../shared/looks';
import { DEFAULT_LIVE_GROUP_LOOK, NO_LOOK } from '../../../shared/looks';
import { AUDIENCE_OFF, hallView, PICTURE } from './audience-picture';

/*
 * What a stage layout's audience picture box draws (Session 50): the hall's group, as its own screens do; with
 * Audience off, the same picture, said off (Session 51).
 */

const look: LiveLook = {
  id: 'placeholder-look',
  name: 'Placeholder Look',
  groups: {
    hall: { ...DEFAULT_LIVE_GROUP_LOOK, layers: ['background', 'slide', 'ticker'], languages: ['gu', 'en'] },
    side: { ...DEFAULT_LIVE_GROUP_LOOK, languages: ['hi'] },
    stage: { ...DEFAULT_LIVE_GROUP_LOOK, languages: ['en'], movement: 'bold' },
  },
};

describe('the audience picture box', () => {
  it('draws the hall group’s settings in the live Look, at its screen’s canvas and scaling', () => {
    const hall = { groupId: 'hall', canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' as const };
    const view = hallView(look, hall);
    expect(view).toEqual({
      groupId: 'hall',
      look: look.groups['hall'],
      canvas: { width: 1280, height: 720 },
      scaling: 'fill',
      off: false,
    });
    // The same object the hall's own output draws with (groupLookIn), never a copy that could differ.
    expect(view.look).toBe(look.groups['hall']);
  });

  it('draws every layer and language at 1920 x 1080 with no hall known, or one the Look does not list', () => {
    const everything = {
      groupId: null,
      look: DEFAULT_LIVE_GROUP_LOOK,
      canvas: { width: 1920, height: 1080 },
      scaling: 'fit',
      off: false,
    };
    expect(hallView(look, null)).toEqual(everything);
    expect(hallView(look, undefined)).toEqual(everything);
    expect(
      hallView(NO_LOOK, { groupId: 'hall', canvasWidth: 1920, canvasHeight: 1080, scaling: 'fit' }),
    ).toEqual({ ...everything, groupId: 'hall' });
  });

  // Session 51 (S4-3): the hall's screens closed by Audience off; the box keeps the picture, and says so.
  it('keeps the hall’s picture with Audience off, said off in words', () => {
    const hall = { groupId: 'hall', canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' as const };
    const off = hallView(look, { ...hall, off: true });
    expect(off).toEqual({ ...hallView(look, hall), off: true });
    expect(off.look).toBe(look.groups['hall']);
    expect(hallView(look, { ...hall, off: false }).off).toBe(false);
    expect(AUDIENCE_OFF).toBe('Audience off');
  });

  it('is a 16:9 picture', () => {
    expect(PICTURE.width * 9).toBe(PICTURE.height * 16);
  });
});
