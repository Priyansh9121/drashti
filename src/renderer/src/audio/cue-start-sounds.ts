import type { EngineState } from '../../../shared/engine/state';
import type { Sound } from './sounds';

/** The audio thread gates a hard Go; page timers only dispose the already silent old players. */
export function retainCueSounds(
  wanted: Map<string, Sound>,
  current: Iterable<Sound>,
  state: EngineState | null,
  now: number,
): number | null {
  const start = state?.videoStart;
  const bg = state?.layers.background;
  if (
    !state ||
    !start ||
    now >= start.at ||
    state.stopped ||
    state.blackout ||
    state.wallpaper ||
    bg?.kind !== 'media' ||
    bg.media !== 'video' ||
    bg.cueId !== start.id
  )
    return null;
  const fade = { id: start.id, at: start.at, durationMs: 0, from: { ...bg, media: 'video' as const } };
  for (const sound of wanted.values())
    if (
      sound.kind === 'video' &&
      sound.mediaId === bg.mediaId &&
      sound.startedAt === bg.startedAt &&
      !sound.envelope
    )
      wanted.set(sound.key, { ...sound, envelope: { fade, role: 'in' } });
  for (const sound of current)
    if (!sound.prepared && !wanted.has(sound.key) && start.soundIds.includes(sound.mediaId))
      wanted.set(sound.key, { ...sound, envelope: { fade, role: 'out' } });
  return start.at;
}
