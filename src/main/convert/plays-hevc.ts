import { HEVC_TYPE } from '../../shared/convert';

/*
 * Whether this computer plays HEVC video (Session 51). Chromium decodes HEVC only where the computer can (most Macs
 * do; Windows needs Microsoft's HEVC extension), and only a window can ask it: the media list asks so to offer
 * Convert (renderer convert-store.ts playsHevc). The main process asks the operator window the same question once
 * it has opened, and each import is told: where it cannot play, HEVC is converted by itself, as any file Drashti
 * cannot play; where it can, it plays as it is.
 */

/** The question, as the media list asks it: Chromium's answer is "probably", "maybe" or nothing. */
export const PLAYS_HEVC_SCRIPT = `document.createElement('video').canPlayType(${JSON.stringify(HEVC_TYPE)})`;

/** Ask a window (`run` runs a script in it): whether it plays HEVC, or null when it cannot be told. */
export async function askPlaysHevc(run: (script: string) => Promise<unknown>): Promise<boolean | null> {
  try {
    const answer = await run(PLAYS_HEVC_SCRIPT);
    return typeof answer === 'string' ? answer !== '' : null;
  } catch {
    return null;
  }
}
