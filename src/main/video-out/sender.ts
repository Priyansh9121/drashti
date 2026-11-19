import type { VideoOutSender } from './protocol';

/* Red (x30): Syphon on a Mac and Spout on Windows by Drashti's own small program, not yet offered. */

export interface VideoOutPlace {
  standIn: string | null;
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
}

export function videoOutProgram(_place: Omit<VideoOutPlace, 'standIn'>): string | null {
  return null;
}

export function videoOutSender(
  place: VideoOutPlace,
  _exists: (file: string) => boolean = () => false,
): VideoOutSender | null {
  if (place.standIn) return { way: 'stand-in', file: place.standIn };
  return null;
}
