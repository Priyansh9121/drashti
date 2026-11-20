import type { SoundRepo } from '../db/sound';

/** Per-library preferences stay with the source even when a time bar names a prepared copy. */
export function editedSoundSettings(
  repo: Pick<SoundRepo, 'soundOf' | 'setEven'>,
  _sourceId: (id: string) => string,
) {
  return {
    read: (id: string) => repo.soundOf(id),
    set: (id: string, on: boolean) => ({ sourceId: id, ok: repo.setEven(id, on) }),
  };
}
