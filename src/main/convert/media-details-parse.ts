import type { FileRead } from '../../shared/media-details';

/* Media information's reading of FFmpeg's text (alpha.20, Q60-34 item 1). Red (x47): still to be written. */

export const languageName = (_code: string | null | undefined): string | null => null;

export const topLevelParts = (_line: string): string[] => [];

export function parseMediaDetails(_text: string, _ext: string): FileRead {
  return {
    container: null,
    durationMs: null,
    bitRateKbps: null,
    title: null,
    pictures: [],
    sounds: [],
    captions: [],
    cover: null,
    chapters: 0,
  };
}
