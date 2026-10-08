import { BrowserWindow, type Session, type WebContents, type WebFrameMain } from 'electron';
import { loadPage } from '../windows/renderer';
import { secureWebPreferences } from '../windows/web-preferences';

/*
 * The Program: what the stream shows, drawn off screen by the stream's page
 * with the same renderer as the outputs. It is an offscreen-rendered window
 * (never on a display), drawn at the stream's size and frame rate whatever
 * the displays are doing. Its page captures itself (getDisplayMedia, allowed
 * for its own frame only) and hands the frames on to be encoded.
 *
 * It has a session of its own, the only one that may use a camera or a
 * microphone: what it is allowed can never reach another window (Chromium
 * shares device information between the pages of one session).
 */

export const STREAM_PARTITION = 'persist:drashti-stream';
export const PROGRAM_FPS = 30;

/** True for the address of the stream's page (from disk, or the development server). */
export function isStreamPage(url: string): boolean {
  try {
    const { protocol, pathname } = new URL(url);
    return (protocol === 'file:' || protocol === 'http:') && pathname.endsWith('/stream.html');
  } catch {
    return false;
  }
}

/** What the stream's page may ask for: the camera and a sound input, nothing else. */
export function streamPermissionAllowed(
  permission: string,
  isProgram: boolean,
  url: string,
  mediaTypes: readonly string[] = [],
): boolean {
  return (
    permission === 'media' &&
    isProgram &&
    isStreamPage(url) &&
    mediaTypes.every((t) => t === 'video' || t === 'audio')
  );
}

export interface StreamSessionRules {
  /** True for the Program window's page. */
  isProgram(contents: WebContents | null): boolean;
  /** Every permission asked for and checked (DRASHTI_LOG_PERMISSIONS). */
  log?(line: string): void;
  /** Each capture of the page's own picture, granted or refused: rare, so always kept (Session 18). */
  logCapture?(line: string): void;
}

/**
 * The stream session's rules: the stream's page may use the camera and
 * microphone and capture its own picture; every other request is refused.
 */
export function applyStreamSessionSecurity(session: Session, rules: StreamSessionRules): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = details.requestingUrl;
    const media = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    const allowed = streamPermissionAllowed(permission, rules.isProgram(contents), url, media);
    rules.log?.(`Stream permission ${allowed ? 'granted' : 'refused'}: ${permission} for ${url}`);
    callback(allowed);
  });
  session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    const url = details.requestingUrl ?? contents?.getURL() ?? '';
    const allowed = streamPermissionAllowed(permission, rules.isProgram(contents), url);
    rules.log?.(`Stream permission check ${allowed ? 'passed' : 'failed'}: ${permission} for ${url}`);
    return allowed;
  });
  session.setDisplayMediaRequestHandler((request, callback) => {
    const frame: WebFrameMain | null = request.frame;
    const own =
      frame !== null &&
      frame.parent === null &&
      isStreamPage(frame.url) &&
      BrowserWindow.getAllWindows().some(
        (w) => rules.isProgram(w.webContents) && w.webContents.mainFrame === frame,
      );
    const line = `Stream capture ${own ? 'granted' : 'refused'} for ${frame?.url ?? 'no frame'}`;
    rules.log?.(line);
    rules.logCapture?.(line);
    if (own) callback({ video: frame });
    else callback({});
  });
}

/**
 * The Program window: offscreen, at the stream's size, never shown. What its page says about its
 * capture (lines starting "[program]") goes to `log` (Session 18).
 */
export function createProgramWindow(
  size: { width: number; height: number },
  log?: (line: string) => void,
): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    title: 'Drashti stream',
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      ...secureWebPreferences(),
      partition: STREAM_PARTITION,
      // Drawn off screen. Its frames reach the encoder through the page's own capture, so the
      // painted textures are let go at once: no copy of each frame in the main process.
      offscreen: { useSharedTexture: true },
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.webContents.setFrameRate(PROGRAM_FPS);
  win.webContents.on('paint', (event) => {
    event.texture?.release();
  });
  win.webContents.on('console-message', (details) => {
    if (details.message.startsWith('[program] ')) log?.(details.message.slice(10, 310));
  });
  void loadPage(win, 'stream');
  return win;
}
