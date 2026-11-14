/** Types for scripts/fetch-ffmpeg.mjs (the FFmpeg Drashti bundles; Session 58: CI's Linux build follows its version). */
export const FFMPEG_VERSION: string;
export const FFMPEG_BUILDS: Record<string, { url: string; sha256: string; member: string; exe: string }>;
export function fetchFfmpeg(target: string): Promise<string>;
