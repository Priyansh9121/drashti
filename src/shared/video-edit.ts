import { z } from 'zod';

/** Edit Video… recipes are source-time values; every prepared showing has its own immutable media ID. */
export interface VideoEditRecipe {
  version: 1;
  trim: { startMs: number | null; endMs: number | null };
  picture: {
    crop: { x: number; y: number; w: number; h: number };
    zoom: number;
    x: number;
    y: number;
    turn: 0 | 90 | 180 | 270;
    flipX: boolean;
    flipY: boolean;
    fill: boolean;
    brightness: number;
    contrast: number;
    colour: number;
  };
  fades: { pictureInMs: number; pictureOutMs: number; soundInMs: number; soundOutMs: number };
  speed: number;
  /** Zero-based audio-stream ordinal, not the container's absolute stream number; null: default first track. */
  audioTrack: number | null;
  noiseReduction: boolean;
  thumbnailMs: number | null;
}

export const PLAIN_VIDEO_EDIT: VideoEditRecipe = {
  version: 1,
  trim: { startMs: null, endMs: null },
  picture: {
    crop: { x: 0, y: 0, w: 1, h: 1 },
    zoom: 1,
    x: 0,
    y: 0,
    turn: 0,
    flipX: false,
    flipY: false,
    fill: false,
    brightness: 0,
    contrast: 0,
    colour: 0,
  },
  fades: { pictureInMs: 0, pictureOutMs: 0, soundInMs: 0, soundOutMs: 0 },
  speed: 1,
  audioTrack: null,
  noiseReduction: false,
  thumbnailMs: null,
};

// Red-first scaffold: validation and source-time parsing follow their failing tests.
export const videoEditRecipeSchema = z.custom<VideoEditRecipe>();
export function parseVideoEditTime(_text: string): number | null {
  return null;
}
export function videoEditNeedsCopy(_recipe: VideoEditRecipe): boolean {
  return false;
}

export interface VideoEditSnapshot {
  mediaId: string;
  revision: number;
  recipe: VideoEditRecipe;
  state: 'ready' | 'preparing' | 'failed';
  readyMediaId: string | null;
  message: string | null;
}

export type VideoEditResult = { ok: true; edit: VideoEditSnapshot } | { ok: false; message: string };
export interface SaveVideoEdit {
  mediaId: string;
  revision: number;
  recipe: VideoEditRecipe;
}
