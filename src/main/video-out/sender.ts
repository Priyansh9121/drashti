import type { VideoOutSender } from './protocol';

/*
 * How this computer's Drashti sends its picture to other software (x30). The tests' stand-in receiver when a test
 * names its file (DRASHTI_TEST_VIDEO_OUT_STAND_IN, honoured only when Drashti is not packaged: src/main/switches.ts).
 * Drashti's own small programs for Syphon, Spout or NDI come with the owner's choice of which to build
 * (assister/s59-notes/reports/x30-design.md): until then there is none, and video out cannot be turned on.
 */
export function videoOutSender(place: {
  standIn: string | null;
  platform: NodeJS.Platform;
}): VideoOutSender | null {
  if (place.standIn) return { way: 'stand-in', file: place.standIn };
  return null;
}
