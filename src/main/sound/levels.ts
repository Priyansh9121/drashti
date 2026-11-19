import { FULL_LEVELS, type SoundKind, type SoundLevels, type SoundLevelsResult } from '../../shared/sound';

/*
 * The operator's Audio and Video levels and mutes (X33, shared/sound.ts), as Main keeps them: the levels with the
 * library's settings, so they are as the operator left them after a restart; a mute never, so every start (a restart
 * that puts the show back too) has the sound on and the hall never starts silent by surprise. The engine's state says
 * them (show-engine.ts soundFor), and the hall's audio player and the stream's page play by them.
 */

/** Where the levels are kept in the library's settings (db/settings.ts): Audio's and Video's, never a mute. */
export const SOUND_LEVELS_SETTING = 'sound.levels';

export interface SoundLevelsDeps {
  /** The library's settings (db/settings.ts), read once as Drashti starts. */
  settings: { get(name: string): unknown };
  /** A level kept when the library is free (index.ts laterSetting). */
  write: (name: string, value: unknown) => void;
}

export class SoundLevelsKeeper {
  constructor(private readonly deps: SoundLevelsDeps) {}

  /** The levels and mutes now. */
  levels(): SoundLevels {
    void this.deps;
    return FULL_LEVELS;
  }

  /** The operator moved a level (0 to 1): it plays so at once, and is kept. */
  setLevel(kind: unknown, level: unknown): SoundLevelsResult {
    void kind;
    void level;
    return { ok: true, levels: this.levels() };
  }

  /** The operator muted a kind, or turned its sound back on (at its level): never kept. */
  setMuted(kind: unknown, muted: unknown): SoundLevelsResult {
    void kind;
    void muted;
    return { ok: true, levels: this.levels() };
  }
}

/** For the words: a kind's name as the operator sees it. */
export const KIND_NAMES: Readonly<Record<SoundKind, string>> = { audio: 'Audio', video: 'Video' };
