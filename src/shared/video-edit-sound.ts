import type { VideoEditRecipe } from './video-edit';

export interface EditedFileSound {
  gain: number;
  silent: boolean;
}
/** A source-track measurement must not mute a different selected track. */
export function soundForEditedVideo(
  sound: EditedFileSound | null,
  recipe: Pick<VideoEditRecipe, 'audioTrack'> | null,
): EditedFileSound | null {
  return sound && recipe?.audioTrack !== null && recipe?.audioTrack !== undefined && recipe.audioTrack > 0
    ? { ...sound, silent: false }
    : sound;
}
