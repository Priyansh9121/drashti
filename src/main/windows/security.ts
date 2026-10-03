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
   * use MIDI (a controller mapped to Next, Back, macros...), never SysEx.
   */
  isOperator?(contents: WebContents | null): boolean;
  /** Told about every permission a page checks or asks for (DRASHTI_LOG_PERMISSIONS=1). */
  log?(line: string): void;
}

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
 * Permissions: every request (camera, microphone, notifications, ...) is
 * refused on every page, and every check fails, except the one the audio
 * player needs to choose a sound output. The audio player has a session of
 * its own, so what it may see can never reach the other windows (Chromium
 * shares device information between pages of one session).
 */
export function applySessionSecurity(session: Session, rules: PermissionRules = {}): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = details.requestingUrl || contents.getURL();
    // MIDI for the operator window's own page, never SysEx; nothing else is ever asked for and given.
    const allowed = permission === 'midi' && (rules.isOperator?.(contents) ?? false) && isOperatorPage(url);
    rules.log?.(`Permission ${allowed ? 'given' : 'refused'}: ${permission} for ${url}`);
    callback(allowed);
  });
  session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    const url = details.requestingUrl ?? contents?.getURL() ?? '';
    const audioPlayer = rules.isAudioPlayer?.(contents) ?? false;
    const operator = rules.isOperator?.(contents) ?? false;
    const allowed = permissionCheckAllowed(permission, audioPlayer, url, operator);
    rules.log?.(`Permission check ${allowed ? 'passed' : 'failed'}: ${permission} for ${url}`);
    return allowed;
  });
}

/** No pop-ups, no <webview>, and no navigating away from our own pages. */
export function secureWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, { devServerUrl: devServerUrl(), rendererDir: rendererDir() })) event.preventDefault();
  });
}
