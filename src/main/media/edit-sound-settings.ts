import type { SoundRepo } from '../db/sound';

/** Per-library preferences stay with the source even when a time bar names a prepared copy. */
export function editedSoundSettings(
  repo: Pick<SoundRepo, 'soundOf' | 'setEven'>,
  sourceId: (id: string) => string,
) {
  return {
    read: (id: string) => repo.soundOf(sourceId(id)),
    set: (id: string, on: boolean) => {
      const source = sourceId(id);
      return { sourceId: source, ok: repo.setEven(source, on) };
    },
  };
}
