import type { WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  allowHangStacks,
  HANG_STACKS_POLICY,
  isAudioPage,
  isOperatorPage,
  permissionCheckAllowed,
  secureWebContents,
} from './security';

const AUDIO = 'file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/audio.html';
const OPERATOR = 'file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/index.html';

describe('permissions', () => {
  it('lets only the audio player see and choose sound outputs', () => {
    expect(permissionCheckAllowed('speaker-selection', true, AUDIO)).toBe(true);
    expect(permissionCheckAllowed('speaker-selection', true, 'http://localhost:5173/audio.html')).toBe(true);
    // Another window, or the audio player's window showing any other page, gets nothing.
    expect(permissionCheckAllowed('speaker-selection', false, AUDIO)).toBe(false);
    expect(permissionCheckAllowed('speaker-selection', true, OPERATOR)).toBe(false);
    expect(permissionCheckAllowed('speaker-selection', true, 'https://example.com/audio.html')).toBe(false);
  });

  it('refuses everything else, even to the audio player', () => {
    for (const permission of [
      'media',
      'notifications',
      'geolocation',
      'clipboard-read',
      'display-capture',
      'midi',
      'hid',
      'serial',
      'usb',
      'fullscreen',
      'openExternal',
      'unknown',
    ]) {
      expect(permissionCheckAllowed(permission, true, AUDIO), permission).toBe(false);
      expect(permissionCheckAllowed(permission, false, OPERATOR), permission).toBe(false);
    }
  });

  it('lets only the operator window use MIDI, never SysEx', () => {
    expect(permissionCheckAllowed('midi', false, OPERATOR, true)).toBe(true);
    expect(permissionCheckAllowed('midi', false, 'http://localhost:5173/', true)).toBe(true);
    // Not another window, not another page in the operator window, never SysEx.
    expect(permissionCheckAllowed('midi', false, OPERATOR, false)).toBe(false);
    expect(permissionCheckAllowed('midi', true, AUDIO, false)).toBe(false);
    expect(permissionCheckAllowed('midi', false, OPERATOR.replace('index.html', 'output.html'), true)).toBe(
      false,
    );
    expect(permissionCheckAllowed('midi', false, 'https://example.com/index.html', true)).toBe(false);
    expect(permissionCheckAllowed('midiSysex', false, OPERATOR, true)).toBe(false);
    expect(isOperatorPage(OPERATOR)).toBe(true);
    expect(isOperatorPage('file:///x/index.html.evil')).toBe(false);
  });

  it('knows the audio page by its address', () => {
    expect(isAudioPage(AUDIO)).toBe(true);
    expect(isAudioPage(`${AUDIO}?x=1`)).toBe(true);
    expect(isAudioPage('file:///x/audio.html.evil')).toBe(false);
    expect(isAudioPage('not a url')).toBe(false);
  });
});

describe('navigating (Sessions 31–36, SEC-15)', () => {
  /** A stand-in for a window's web contents: fire an event at it, and see whether a handler stopped it. */
  function stand() {
    const emitter = new EventEmitter();
    const contents = Object.assign(emitter, {
      setWindowOpenHandler: () => undefined,
    }) as unknown as WebContents;
    const fire = (name: string, url: string): boolean => {
      let stopped = false;
      emitter.emit(name, { url, preventDefault: () => (stopped = true) }, url);
      return stopped;
    };
    return { contents, fire };
  }

  it('stops a link, a redirect and a frame going anywhere but our own pages', () => {
    const { contents, fire } = stand();
    secureWebContents(contents, (url) => url.startsWith('file:///app/out/renderer/'));
    for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
      expect(fire(name, 'https://example.com/'), `${name} off the app`).toBe(true);
      expect(fire(name, 'file:///elsewhere/index.html'), `${name} to another file`).toBe(true);
      expect(fire(name, 'file:///app/out/renderer/index.html'), `${name} to our own page`).toBe(false);
    }
  });
});

describe("a hung page's JavaScript stack (Sessions 31–36, ROB-1)", () => {
  it('lets our own pages, and only them, give it: the header on the page itself, never on what it loads', () => {
    type Listener = (
      details: { url: string; responseHeaders?: Record<string, string[]> },
      callback: (response: { responseHeaders?: Record<string, string[]> }) => void,
    ) => void;
    let filter: unknown = null;
    let listener: Listener | null = null;
    const session = {
      webRequest: {
        onHeadersReceived: (f: unknown, l: Listener) => {
          filter = f;
          listener = l;
        },
      },
    };
    allowHangStacks(session as unknown as Parameters<typeof allowHangStacks>[0], (url) => url === OPERATOR);
    expect(filter).toEqual({ urls: ['<all_urls>'], types: ['mainFrame'] });
    const answer = (url: string) => {
      let response: { responseHeaders?: Record<string, string[]> } | null = null;
      listener?.({ url, responseHeaders: { 'Content-Type': ['text/html'] } }, (r) => (response = r));
      return response;
    };
    expect(answer(OPERATOR)).toEqual({
      responseHeaders: { 'Content-Type': ['text/html'], 'Document-Policy': [HANG_STACKS_POLICY] },
    });
    expect(answer('https://example.com/')).toEqual({});
    expect(HANG_STACKS_POLICY).toBe('include-js-call-stacks-in-crash-reports');
  });
});
