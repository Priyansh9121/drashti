import type { AudioLayer } from '../../../../shared/engine/state';

/*
 * What an audio playlist's row does on the phone (Session 54, D5 review), as the window's Music panel's Play and
 * Pause do (music/MusicPanel.tsx): Pause while that playlist plays; while it is paused, Play goes on where it was
 * (POST /api/v1/music/play with no playlist: the music service plays on from the pause); any other playlist, Play
 * starts it from its first track. Until then the playing row's Play started it again from its first track.
 */

export type MusicRowAction = 'play' | 'pause' | 'resume';

export function musicRowAction(playlistId: string, audio: AudioLayer | null | undefined): MusicRowAction {
  if (audio?.music?.playlistId !== playlistId) return 'play';
  return audio.pausedAtMs === undefined ? 'pause' : 'resume';
}
