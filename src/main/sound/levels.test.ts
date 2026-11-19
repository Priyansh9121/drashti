import { describe, expect, it } from 'vitest';
import { FULL_LEVELS } from '../../shared/sound';
import { SOUND_LEVELS_SETTING, SoundLevelsKeeper } from './levels';

/*
 * X33: the operator's Audio and Video levels and mutes as Main keeps them. The levels are kept with the library's
 * settings across a restart; a mute never is, so every start has the sound on.
 */

/** The library's settings in memory, with what was written to them (as index.ts's laterSetting does, at once here). */
function library(kept: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(kept));
  const writes: [string, unknown][] = [];
  return {
    values,
    writes,
    deps: {
      settings: { get: (name: string) => values.get(name) },
      write: (name: string, value: unknown) => {
        writes.push([name, value]);
        values.set(name, value);
      },
    },
  };
}

describe('the operator’s levels and mutes, as Main keeps them (X33)', () => {
  it('first start: Audio and Video at 100 %, sound on', () => {
    expect(new SoundLevelsKeeper(library().deps).levels()).toEqual(FULL_LEVELS);
  });

  it('a level moved plays at once and is kept: after a restart both are as the operator left them, sound on', () => {
    const lib = library();
    const keeper = new SoundLevelsKeeper(lib.deps);
    expect(keeper.setLevel('audio', 0.4)).toEqual({
      ok: true,
      levels: { audio: { level: 0.4, muted: false }, video: { level: 1, muted: false } },
    });
    expect(keeper.setLevel('video', 0.75)).toMatchObject({ ok: true });
    expect(lib.writes.at(-1)).toEqual([SOUND_LEVELS_SETTING, { audio: 0.4, video: 0.75 }]);
    keeper.setMuted('video', true);
    // Drashti starts again (or a restart puts the show back): the levels kept, the mute gone.
    expect(new SoundLevelsKeeper(lib.deps).levels()).toEqual({
      audio: { level: 0.4, muted: false },
      video: { level: 0.75, muted: false },
    });
  });

  it('a mute is never kept: Drashti always starts with the sound on, whatever the settings say', () => {
    const lib = library();
    const keeper = new SoundLevelsKeeper(lib.deps);
    expect(keeper.setMuted('audio', true)).toEqual({
      ok: true,
      levels: { audio: { level: 1, muted: true }, video: { level: 1, muted: false } },
    });
    expect(lib.writes).toEqual([]);
    // A setting edited by hand to say muted: still sound on.
    const edited = library({ [SOUND_LEVELS_SETTING]: { audio: 0.5, video: 0.5, muted: true } });
    expect(new SoundLevelsKeeper(edited.deps).levels()).toEqual({
      audio: { level: 0.5, muted: false },
      video: { level: 0.5, muted: false },
    });
  });

  it('muting keeps the level; sound on again brings it back; each kind is its own', () => {
    const keeper = new SoundLevelsKeeper(library().deps);
    keeper.setLevel('audio', 0.3);
    keeper.setMuted('audio', true);
    expect(keeper.levels().audio).toEqual({ level: 0.3, muted: true });
    expect(keeper.levels().video).toEqual({ level: 1, muted: false });
    // Moved while muted: it stays muted, at its new level.
    keeper.setLevel('audio', 0.6);
    expect(keeper.levels().audio).toEqual({ level: 0.6, muted: true });
    keeper.setMuted('audio', false);
    expect(keeper.levels().audio).toEqual({ level: 0.6, muted: false });
  });

  it('a level is kept in whole percent, 0 to 100 %', () => {
    const lib = library();
    const keeper = new SoundLevelsKeeper(lib.deps);
    keeper.setLevel('video', 0.333);
    expect(keeper.levels().video.level).toBe(0.33);
    keeper.setLevel('video', 0);
    expect(keeper.levels().video.level).toBe(0);
    expect(lib.writes.at(-1)).toEqual([SOUND_LEVELS_SETTING, { audio: 1, video: 0 }]);
  });

  it('refuses what is not a level or a kind, and changes nothing', () => {
    const lib = library();
    const keeper = new SoundLevelsKeeper(lib.deps);
    for (const [kind, level] of [
      ['both', 0.5],
      ['audio', 1.5],
      ['audio', -0.1],
      ['video', Number.NaN],
      ['video', '0.5'],
      [null, 0.5],
    ] as const)
      expect(keeper.setLevel(kind, level), `${String(kind)} ${String(level)}`).toMatchObject({ ok: false });
    for (const [kind, muted] of [
      ['music', true],
      ['audio', 'yes'],
      ['video', 1],
    ] as const)
      expect(keeper.setMuted(kind, muted), `${String(kind)} ${String(muted)}`).toMatchObject({ ok: false });
    expect(keeper.levels()).toEqual(FULL_LEVELS);
    expect(lib.writes).toEqual([]);
  });

  it('a kept setting that is not levels (an older or hand-edited library) starts at 100 % for what it cannot read', () => {
    const kept = (value: unknown) =>
      new SoundLevelsKeeper(library({ [SOUND_LEVELS_SETTING]: value }).deps).levels();
    expect(kept('loud')).toEqual(FULL_LEVELS);
    expect(kept(null)).toEqual(FULL_LEVELS);
    expect(kept({ audio: 'half', video: 0.2 })).toEqual({
      audio: { level: 1, muted: false },
      video: { level: 0.2, muted: false },
    });
    expect(kept({ audio: 7, video: -3 })).toEqual({
      audio: { level: 1, muted: false },
      video: { level: 0, muted: false },
    });
  });
});
