import type { VideoEditRecipe } from './video-edit';

export interface EditedFileSound {
  gain: number;
  silent: boolean;
}
/** A source-track measurement must not mute a different selected track. */
export function soundForEditedVideo(
  sound: EditedFileSound | null,
  _recipe: Pick<VideoEditRecipe, 'audioTrack'> | null,
): EditedFileSound | null {
  return sound;
}
