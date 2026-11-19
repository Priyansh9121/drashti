import {
  cleanLevel,
  SOUND_KINDS,
  type SoundKind,
  type SoundLevels,
  type SoundLevelsResult,
} from '../../shared/sound';

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

const isKind = (kind: unknown): kind is SoundKind => SOUND_KINDS.includes(kind as SoundKind);

/** A kept level of a kind: 0 to 100 % in whole percent, and 100 % for anything else (an older or hand-edited one). */
function keptLevel(kept: unknown, kind: SoundKind): number {
  if (typeof kept !== 'object' || kept === null) return 1;
  return cleanLevel((kept as Partial<Record<SoundKind, unknown>>)[kind]);
}

export class SoundLevelsKeeper {
  private now: SoundLevels;

  constructor(private readonly deps: SoundLevelsDeps) {
    const kept = deps.settings.get(SOUND_LEVELS_SETTING);
    // The levels as they were left; the sound on, always.
    this.now = {
      audio: { level: keptLevel(kept, 'audio'), muted: false },
      video: { level: keptLevel(kept, 'video'), muted: false },
    };
  }

  /** The levels and mutes now. */
  levels(): SoundLevels {
    return this.now;
  }

  /** The operator moved a level (0 to 1): it plays so at once, and is kept. A kind muted stays muted, at it. */
  setLevel(kind: unknown, level: unknown): SoundLevelsResult {
    if (!isKind(kind)) return { ok: false, message: 'Only Audio’s and Video’s levels can be set.' };
    if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1)
      return { ok: false, message: 'A level is from 0 to 100 %.' };
    this.now = { ...this.now, [kind]: { ...this.now[kind], level: cleanLevel(level) } };
    this.deps.write(SOUND_LEVELS_SETTING, { audio: this.now.audio.level, video: this.now.video.level });
    return { ok: true, levels: this.now };
  }

  /** The operator muted a kind, or turned its sound back on (at its level): never kept. */
  setMuted(kind: unknown, muted: unknown): SoundLevelsResult {
    if (!isKind(kind)) return { ok: false, message: 'Only Audio and Video can be muted.' };
    if (typeof muted !== 'boolean') return { ok: false, message: 'Say whether it is muted.' };
    this.now = { ...this.now, [kind]: { ...this.now[kind], muted } };
    return { ok: true, levels: this.now };
  }
}
