import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioLivePicture } from '../../../../shared/studio-live';
import type { ChosenWallpaper } from '../../../../shared/wallpapers';
import {
  BACKDROP_KEY,
  BACKDROP_NAMES,
  BACKDROPS,
  backdropDraw,
  DEFAULT_BACKDROP,
  isBackdrop,
  NO_LIVE,
  NO_WALLPAPER,
  rememberBackdrop,
  rememberedBackdrop,
  TILE_BACKDROP,
  watchesLive,
} from './backdrop';

/*
 * Behind the Lower Thirds studio's preview (alpha.22, the owner: "give wallpaper a default and another option of live
 * as well to see how lower thirds looks"): Wallpaper first and by default (the hall's chosen wallpaper; plain dark
 * with "No wallpaper chosen" when there is none), Live (what the screens show now, as the main process's still
 * says), then Dark and Light; the choice remembered on this computer, as the studio's other choices are.
 */

const WALL: ChosenWallpaper = {
  id: 'w1',
  name: 'Placeholder wall',
  pictures: ['m1'],
  secondsEach: 10,
  fadeMs: 1000,
  since: 0,
};
const LOOKS = { m1: { zoom: 1.2 } as never };
const still = (source: 'screen' | 'live', at = 1): StudioLivePicture => ({
  url: `data:image/jpeg;base64,${source}`,
  source,
  at,
});

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(k: string): string | null {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.items.set(k, v);
  }
  removeItem(k: string): void {
    this.items.delete(k);
  }
}

describe('the studio’s backdrop', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: new MemoryStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers Wallpaper, Live, Dark and Light, in that order, Wallpaper the default', () => {
    expect(BACKDROPS).toEqual(['wallpaper', 'live', 'dark', 'light']);
    expect(BACKDROPS.map((b) => BACKDROP_NAMES[b])).toEqual(['Wallpaper', 'Live', 'Dark', 'Light']);
    expect(DEFAULT_BACKDROP).toBe('wallpaper');
    expect(isBackdrop('picture')).toBe(false);
  });

  it('opens on Wallpaper on a new install, and on the one chosen after that (on this computer)', () => {
    expect(rememberedBackdrop()).toBe('wallpaper');
    rememberBackdrop('live');
    expect(storage.getItem(`drashti.ui.${BACKDROP_KEY}`)).toBe('"live"');
    expect(rememberedBackdrop()).toBe('live');
    rememberBackdrop('light');
    expect(rememberedBackdrop()).toBe('light');
    // One remembered from before (Picture went) or nonsense: Wallpaper.
    storage.setItem(`drashti.ui.${BACKDROP_KEY}`, '"picture"');
    expect(rememberedBackdrop()).toBe('wallpaper');
    storage.setItem(`drashti.ui.${BACKDROP_KEY}`, '{not json');
    expect(rememberedBackdrop()).toBe('wallpaper');
  });

  it('Wallpaper draws the hall’s chosen wallpaper with its pictures’ looks; with none, plain dark and the words', () => {
    expect(backdropDraw('wallpaper', { wallpaper: WALL, pictures: LOOKS }, undefined)).toEqual({
      kind: 'wallpaper',
      wallpaper: WALL,
      pictures: LOOKS,
    });
    for (const none of [null, undefined, { ...WALL, pictures: [] }])
      expect(backdropDraw('wallpaper', { wallpaper: none, pictures: {} }, undefined)).toEqual({
        kind: 'plain',
        colour: '#1f2937',
        words: NO_WALLPAPER,
      });
    expect(NO_WALLPAPER).toBe('No wallpaper chosen');
  });

  it('Live follows the live picture: black until the first still, then each still as it comes, wherever it was taken', () => {
    const hall = { wallpaper: WALL, pictures: LOOKS };
    expect(backdropDraw('live', hall, undefined)).toEqual({ kind: 'plain', colour: '#000000' });
    expect(backdropDraw('live', hall, still('screen', 1))).toEqual({
      kind: 'live',
      picture: still('screen', 1),
    });
    expect(backdropDraw('live', hall, still('live', 2))).toEqual({ kind: 'live', picture: still('live', 2) });
    // Nothing on this computer to take it from: black, and says so.
    expect(backdropDraw('live', hall, null)).toEqual({ kind: 'plain', colour: '#000000', words: NO_LIVE });
    expect(watchesLive('live')).toBe(true);
    for (const b of ['wallpaper', 'dark', 'light']) expect(watchesLive(b)).toBe(false);
  });

  it('Dark and Light are plain; the template tiles keep their own plain backdrop', () => {
    const hall = { wallpaper: WALL, pictures: LOOKS };
    expect(backdropDraw('dark', hall, still('screen'))).toEqual({ kind: 'plain', colour: '#1f2937' });
    expect(backdropDraw('light', hall, still('screen'))).toEqual({ kind: 'plain', colour: '#e5e7eb' });
    expect(TILE_BACKDROP.kind).toBe('plain');
  });
});
