import type { Session, WebFrameMain } from 'electron';
import type { CaptureGrant } from './live-window-service';

/*
 * The default session's requests for a screen's picture (getDisplayMedia; Session 48). Until then every
 * one was refused, as Electron does with no handler. Now a page is given exactly what the main process
 * decides for that frame (`grant`): the window up as the background, to a screen's page that asked for it,
 * or the stream's picture, to the window for Zoom. Everything else is still refused: no page ever chooses
 * what it captures, and nothing ever captures a display or the sound.
 */
export function applyCaptureRules(
  session: Pick<Session, 'setDisplayMediaRequestHandler'>,
  rules: {
    grant(frame: WebFrameMain | null): CaptureGrant | null;
    log?(line: string): void;
  },
): void {
  session.setDisplayMediaRequestHandler((request, callback) => {
    const frame: WebFrameMain | null = request.frame;
    const grant = rules.grant(frame);
    rules.log?.(`Capture ${grant ? 'granted' : 'refused'} for ${frame?.url ?? 'no frame'}`);
    callback(grant ? { video: grant } : {});
  });
}
