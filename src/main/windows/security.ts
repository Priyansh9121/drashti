import type { Session, WebContents } from 'electron';
import { isAppUrl } from './navigation';
import { rendererDir, devServerUrl } from './renderer';

export interface PermissionRules {
  /**
   * Only for the audio player's own session: true for the audio player's
   * window. Every other session leaves it out and refuses everything.
   */
  isAudioPlayer?(contents: WebContents | null): boolean;
  /**
   * Only for the default session: true for the operator window. It alone may
   * use MIDI (a controller mapped to Next, Back, Clear all...), never SysEx.
   */
  isOperator?(contents: WebContents | null): boolean;
  /**
   * Only for the default session (Session 48): whether a page may ask for a screen's picture now (a screen's
   * page that asked for the window up as the background, or the window for Zoom). What it is given, if
   * anything, the session's capture rules decide (src/main/live-window/capture-rules.ts).
   */
  mayCapture?(contents: WebContents | null): boolean;
  /**
   * Only for the default session on Main (Session 50): which of Drashti's screen pages this is, for a camera
   * (a video input): the operator window's (its LIVE picture, Media's small live pictures of its video inputs)
   * or one of this computer's outputs' (audience, stage and key and fill alike: each draws the hall's picture,
   * a stage screen in its box of the audience picture); null for every other window (the window for Zoom, the
   * gallery, a PDF's hidden window...). A node's session and the audio player's leave it out: they never open
   * a camera.
   */
  cameraPage?(contents: WebContents | null): CameraPage | null;
  /** Tests only: what counts as one of Drashti's own pages (left out: the built renderer's, or Vite's). */
  isOwnPage?(url: string): boolean;
  /** Told about every permission a page checks or asks for (DRASHTI_LOG_PERMISSIONS=1). */
  log?(line: string): void;
}

/** The screen pages that may open a camera in the default session (Session 50). */
export type CameraPage = 'operator' | 'output';

/** True for the address of the audio player's page (from disk, or the development server). */
export function isAudioPage(url: string): boolean {
  try {
    const { protocol, pathname } = new URL(url);
    return (protocol === 'file:' || protocol === 'http:') && pathname.endsWith('/audio.html');
  } catch {
    return false;
  }
}

/** True for the address of the operator window's page (from disk, or the development server). */
export function isOperatorPage(url: string): boolean {
  try {
    const { protocol, pathname } = new URL(url);
    return (
      (protocol === 'file:' || protocol === 'http:') && (pathname.endsWith('/index.html') || pathname === '/')
    );
  } catch {
    return false;
  }
}

/** True for the address of an output's page (from disk, or the development server; Session 50). */
export function isOutputPage(url: string): boolean {
  try {
    const { protocol, pathname } = new URL(url);
    return (protocol === 'file:' || protocol === 'http:') && pathname.endsWith('/output.html');
  } catch {
    return false;
  }
}

/**
 * Whether a page passes a permission check. Two permissions are ever given:
 * the audio player may see the sound outputs and play on the one the
 * operator chose, which Chromium checks as 'speaker-selection' (output
 * devices only, never microphones or cameras); and the operator window may
 * use MIDI controllers ('midi', never 'midiSysex', which could change a
 * device's own settings).
 */
export function permissionCheckAllowed(
  permission: string,
  audioPlayer: boolean,
  url: string,
  operator = false,
): boolean {
  if (permission === 'midi') return operator && isOperatorPage(url);
  return permission === 'speaker-selection' && audioPlayer && isAudioPage(url);
}

/**
 * A request for a screen's picture (getDisplayMedia): Chromium asks it as 'media' naming no devices, where a
 * camera names 'video' and a microphone 'audio' (Session 48, measured). Allowed only to a page that may
 * capture now; never a camera or a microphone.
 */
export function screenPictureAllowed(
  permission: string,
  mediaTypes: readonly string[] | null,
  mayCapture: boolean,
): boolean {
  return permission === 'media' && mediaTypes !== null && mediaTypes.length === 0 && mayCapture;
}

/** A page's request for a camera (or its check, for the cameras' names), as the default session hears it. */
export interface CameraRequest {
  permission: string;
  /** What a request names ('video' for a camera, 'audio' for a microphone); a check's one type; null: none. */
  mediaTypes: readonly string[] | null;
  /** Which screen page its window is (the main process's own record of the window), or null. */
  page: CameraPage | null;
  /** The address of the frame asking. */
  url: string;
  /** Whether that frame is its page's main frame. */
  mainFrame: boolean;
}

/**
 * A camera for a video input (Session 50), and nothing more. Before, only the stream's page (in its own
 * session) could open a camera; in the default session (the operator window and the hall's outputs) every
 * camera was refused. Now a camera is given there only when all of these hold:
 * - it is a camera alone: Chromium names exactly one device, 'video' (a microphone names 'audio', a screen's
 *   picture names none), so sound is never given, alone or with it;
 * - the window asking is one the main process knows as a screen page: the operator window, or one of this
 *   computer's outputs (`page`, from the window's identity, never from what the page says);
 * - the frame asking is that window's main frame, never a frame inside it;
 * - its address is that page's own (index.html for the operator window, output.html for an output) and one of
 *   Drashti's own pages (the built renderer's files, or Vite's server in development).
 * The same answers a permission check, so those pages see the cameras' names (and no microphones').
 */
export function cameraAllowed(
  request: CameraRequest,
  isOwnPage: (url: string) => boolean = ownPage,
): boolean {
  const { permission, mediaTypes, page, url, mainFrame } = request;
  if (permission !== 'media' || page === null || !mainFrame) return false;
  if (mediaTypes?.length !== 1 || mediaTypes[0] !== 'video') return false;
  const right = page === 'operator' ? isOperatorPage(url) : isOutputPage(url);
  return right && isOwnPage(url);
}

/**
 * Permissions: every request (camera, microphone, notifications, ...) is
 * refused on every page, and every check fails, except the one the audio
 * player needs to choose a sound output. The audio player has a session of
 * its own, so what it may see can never reach the other windows (Chromium
 * shares device information between pages of one session).
 */
export function applySessionSecurity(session: Session, rules: PermissionRules = {}): void {
  const own = rules.isOwnPage ?? ownPage;
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = details.requestingUrl || contents.getURL();
    // MIDI for the operator window's own page, never SysEx; a screen's picture to a page that may capture it
    // now (Session 48); a camera alone to a screen's page (Session 50); nothing else is ever asked for and given.
    const media = 'mediaTypes' in details ? (details.mediaTypes ?? []) : null;
    const allowed =
      (permission === 'midi' && (rules.isOperator?.(contents) ?? false) && isOperatorPage(url)) ||
      screenPictureAllowed(permission, media, rules.mayCapture?.(contents) ?? false) ||
      cameraAllowed(
        {
          permission,
          mediaTypes: media,
          page: rules.cameraPage?.(contents) ?? null,
          url,
          mainFrame: details.isMainFrame,
        },
        own,
      );
    rules.log?.(`Permission ${allowed ? 'given' : 'refused'}: ${permission} for ${url}`);
    callback(allowed);
  });
  session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    const url = details.requestingUrl ?? contents?.getURL() ?? '';
    const audioPlayer = rules.isAudioPlayer?.(contents) ?? false;
    const operator = rules.isOperator?.(contents) ?? false;
    const allowed =
      permissionCheckAllowed(permission, audioPlayer, url, operator) ||
      cameraAllowed(
        {
          permission,
          mediaTypes: details.mediaType === undefined ? null : [details.mediaType],
          page: rules.cameraPage?.(contents) ?? null,
          url,
          mainFrame: details.isMainFrame,
        },
        own,
      );
    rules.log?.(`Permission check ${allowed ? 'passed' : 'failed'}: ${permission} for ${url}`);
    return allowed;
  });
}

/** One of our own pages: from the built renderer, or Vite's in development. */
const ownPage = (url: string): boolean =>
  isAppUrl(url, { devServerUrl: devServerUrl(), rendererDir: rendererDir() });

/** The Document-Policy by which a page lets Chromium give its JavaScript's stack when it hangs. */
export const HANG_STACKS_POLICY = 'include-js-call-stacks-in-crash-reports';

/**
 * Our own pages let the watchdog ask where their JavaScript is when they hang (Sessions 31–36, ROB-1).
 * Chromium gives a page's stack only when its response opts in, and a page from a file has no headers of
 * its own, so the session adds the header to each of our pages as it loads (the page itself only, never
 * what it loads). Nothing else about how pages load changes.
 */
export function allowHangStacks(
  session: Pick<Session, 'webRequest'>,
  isOwnPage: (url: string) => boolean = ownPage,
): void {
  session.webRequest.onHeadersReceived(
    { urls: ['<all_urls>'], types: ['mainFrame'] },
    (details, callback) => {
      if (!isOwnPage(details.url)) {
        callback({});
        return;
      }
      callback({ responseHeaders: { ...details.responseHeaders, 'Document-Policy': [HANG_STACKS_POLICY] } });
    },
  );
}

/**
 * No pop-ups, no <webview>, and no navigating away from our own pages: not by a link, nor by a redirect,
 * nor in a frame (Sessions 31–36, SEC-15).
 */
export function secureWebContents(
  contents: WebContents,
  isOwnPage: (url: string) => boolean = ownPage,
): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.on('will-navigate', (event) => {
    if (!isOwnPage(event.url)) event.preventDefault();
  });
  contents.on('will-redirect', (event) => {
    if (!isOwnPage(event.url)) event.preventDefault();
  });
  contents.on('will-frame-navigate', (event) => {
    if (!isOwnPage(event.url)) event.preventDefault();
  });
}
