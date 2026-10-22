import type { Session, WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  allowHangStacks,
  applySessionSecurity,
  cameraAllowed,
  type CameraPage,
  HANG_STACKS_POLICY,
  isAudioPage,
  isOperatorPage,
  isOutputPage,
  permissionCheckAllowed,
  type PermissionRules,
  screenPictureAllowed,
  secureWebContents,
} from './security';

const RENDERER = 'file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/';
const AUDIO = `${RENDERER}audio.html`;
const OPERATOR = `${RENDERER}index.html`;
const OUTPUT = `${RENDERER}output.html`;

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

  it('gives a screen’s picture only to a page that may capture it now, never a camera or a microphone (Session 48)', () => {
    // getDisplayMedia names no devices; a camera names 'video', a microphone 'audio'.
    expect(screenPictureAllowed('media', [], true)).toBe(true);
    expect(screenPictureAllowed('media', [], false)).toBe(false);
    expect(screenPictureAllowed('media', ['video'], true)).toBe(false);
    expect(screenPictureAllowed('media', ['audio'], true)).toBe(false);
    expect(screenPictureAllowed('media', ['video', 'audio'], true)).toBe(false);
    expect(screenPictureAllowed('media', null, true)).toBe(false);
    expect(screenPictureAllowed('display-capture', [], true)).toBe(false);
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

describe('a camera for a video input (Session 50)', () => {
  const own = (url: string) => url.startsWith(RENDERER) || url.startsWith('http://localhost:5173/');
  const camera = (over: Partial<Parameters<typeof cameraAllowed>[0]> = {}) =>
    cameraAllowed(
      {
        permission: 'media',
        mediaTypes: ['video'],
        page: 'operator',
        url: OPERATOR,
        mainFrame: true,
        ...over,
      },
      own,
    );

  it('is given, alone, to the operator window’s page and to an output’s, each known by its window and its address', () => {
    expect(camera()).toBe(true);
    expect(camera({ page: 'output', url: OUTPUT })).toBe(true);
    // Every output of this computer is an output page: audience, stage (its box of the audience picture), key
    // and fill.
    expect(camera({ page: 'output', url: `${OUTPUT}?screen=s1` })).toBe(true);
    expect(camera({ page: 'output', url: `${OUTPUT}?screen=stage-1` })).toBe(true);
    // In development, from Vite's server.
    expect(camera({ url: 'http://localhost:5173/' })).toBe(true);
    expect(camera({ page: 'output', url: 'http://localhost:5173/output.html' })).toBe(true);
    // The window and its address must agree: the operator window showing an output's page, or the other way.
    expect(camera({ page: 'operator', url: OUTPUT })).toBe(false);
    expect(camera({ page: 'output', url: OPERATOR })).toBe(false);
    expect(isOutputPage(OUTPUT)).toBe(true);
    expect(isOutputPage('file:///x/output.html.evil')).toBe(false);
    expect(isOutputPage('not a url')).toBe(false);
  });

  it('is never given with sound, as sound, as a screen’s picture, or to another page, window or frame', () => {
    // A microphone, a camera with a microphone, nothing named (that is a screen's picture: getDisplayMedia).
    expect(camera({ mediaTypes: ['audio'] })).toBe(false);
    expect(camera({ mediaTypes: ['video', 'audio'] })).toBe(false);
    expect(camera({ mediaTypes: ['audio', 'video'] })).toBe(false);
    expect(camera({ mediaTypes: ['video', 'video'] })).toBe(false);
    expect(camera({ mediaTypes: [] })).toBe(false);
    expect(camera({ mediaTypes: null })).toBe(false);
    expect(camera({ mediaTypes: ['unknown'] })).toBe(false);
    // Any other window (the window for Zoom, the gallery, a PDF's hidden window): not a screen's page.
    expect(camera({ page: null })).toBe(false);
    // A frame inside the page, or a page that is not Drashti's own.
    expect(camera({ mainFrame: false })).toBe(false);
    expect(camera({ url: 'https://example.com/index.html' })).toBe(false);
    expect(camera({ page: 'output', url: 'https://example.com/output.html' })).toBe(false);
    expect(camera({ url: 'file:///Users/someone/Downloads/index.html' })).toBe(false);
    // Only a camera is ever given this way.
    for (const permission of ['display-capture', 'notifications', 'midi', 'speaker-selection', 'unknown'])
      expect(camera({ permission }), permission).toBe(false);
  });

  /** A stand-in for a session: its two handlers, kept to be asked. */
  function stand(rules: PermissionRules) {
    type Request = Parameters<Session['setPermissionRequestHandler']>[0];
    type Check = Parameters<Session['setPermissionCheckHandler']>[0];
    let request: Request = null;
    let check: Check = null;
    const session = {
      setPermissionRequestHandler: (handler: Request) => {
        request = handler;
      },
      setPermissionCheckHandler: (handler: Check) => {
        check = handler;
      },
    } as unknown as Session;
    applySessionSecurity(session, { isOwnPage: own, ...rules });
    const page = (id: number, url: string) => ({ id, getURL: () => url }) as unknown as WebContents;
    const asks = (
      contents: WebContents,
      permission: string,
      details: { mediaTypes?: string[]; isMainFrame?: boolean; requestingUrl?: string },
    ): boolean => {
      const answer: { given?: boolean } = {};
      request?.(
        contents,
        permission as Parameters<NonNullable<Request>>[1],
        (ok) => {
          answer.given = ok;
        },
        {
          isMainFrame: details.isMainFrame ?? true,
          requestingUrl: details.requestingUrl ?? contents.getURL(),
          ...(details.mediaTypes ? { mediaTypes: details.mediaTypes as ('video' | 'audio')[] } : {}),
        },
      );
      if (answer.given === undefined) throw new Error('the request was never answered');
      return answer.given;
    };
    const checks = (
      contents: WebContents | null,
      permission: string,
      details: { mediaType?: 'video' | 'audio' | 'unknown'; isMainFrame?: boolean; requestingUrl?: string },
    ): boolean =>
      check?.(contents, permission as Parameters<NonNullable<Check>>[1], '', {
        ...details,
        isMainFrame: details.isMainFrame ?? true,
      }) ?? false;
    return { page, asks, checks };
  }

  const operatorPage = 1;
  const outputPage = 2;
  const zoomPage = 3;
  const cameraPage = (contents: WebContents | null): CameraPage | null =>
    contents?.id === operatorPage ? 'operator' : contents?.id === outputPage ? 'output' : null;

  it('in the default session on Main: a camera for the screens’ pages and their device names, nothing more', () => {
    const { page, asks, checks } = stand({
      isOperator: (c) => c?.id === operatorPage,
      cameraPage,
      mayCapture: () => false,
    });
    const operator = page(operatorPage, OPERATOR);
    const output = page(outputPage, OUTPUT);
    const zoom = page(zoomPage, `${RENDERER}zoom.html`);
    expect(asks(operator, 'media', { mediaTypes: ['video'] })).toBe(true);
    expect(asks(output, 'media', { mediaTypes: ['video'] })).toBe(true);
    // Its device names (enumerateDevices) are a permission check: the cameras' only.
    expect(checks(operator, 'media', { mediaType: 'video' })).toBe(true);
    expect(checks(output, 'media', { mediaType: 'video', requestingUrl: OUTPUT })).toBe(true);
    expect(checks(operator, 'media', { mediaType: 'audio' })).toBe(false);
    expect(checks(operator, 'media', { mediaType: 'unknown' })).toBe(false);
    expect(checks(operator, 'media', {})).toBe(false);
    expect(checks(null, 'media', { mediaType: 'video', requestingUrl: OPERATOR })).toBe(false);
    // Never a microphone, never with one, never a screen's picture the page was not given.
    expect(asks(operator, 'media', { mediaTypes: ['audio'] })).toBe(false);
    expect(asks(output, 'media', { mediaTypes: ['video', 'audio'] })).toBe(false);
    expect(asks(output, 'media', { mediaTypes: [] })).toBe(false);
    // Never another window, a frame inside the page, or a page that is not Drashti's own.
    expect(asks(zoom, 'media', { mediaTypes: ['video'] })).toBe(false);
    expect(checks(zoom, 'media', { mediaType: 'video' })).toBe(false);
    expect(asks(output, 'media', { mediaTypes: ['video'], isMainFrame: false })).toBe(false);
    expect(checks(output, 'media', { mediaType: 'video', isMainFrame: false, requestingUrl: OUTPUT })).toBe(
      false,
    );
    expect(
      asks(output, 'media', { mediaTypes: ['video'], requestingUrl: 'https://example.com/output.html' }),
    ).toBe(false);
    // MIDI for the operator window stays as it was.
    expect(asks(operator, 'midi', {})).toBe(true);
    expect(asks(output, 'midi', {})).toBe(false);
  });

  it('a Mac: no camera until the system says granted, so macOS never asks before Drashti has said why', () => {
    let granted = false;
    const { page, asks, checks } = stand({ cameraPage, cameraGranted: () => granted });
    const operator = page(operatorPage, OPERATOR);
    const output = page(outputPage, OUTPUT);
    expect(asks(operator, 'media', { mediaTypes: ['video'] })).toBe(false);
    expect(asks(output, 'media', { mediaTypes: ['video'] })).toBe(false);
    // The cameras' names are no question to macOS: Media lists them before it asks.
    expect(checks(operator, 'media', { mediaType: 'video' })).toBe(true);
    // Asked after the page said why, and allowed.
    granted = true;
    expect(asks(operator, 'media', { mediaTypes: ['video'] })).toBe(true);
    expect(asks(output, 'media', { mediaTypes: ['video'] })).toBe(true);
    // Never sound, granted or not.
    expect(asks(output, 'media', { mediaTypes: ['video', 'audio'] })).toBe(false);
  });

  it('nowhere else: a session without the rule (the audio player’s, a node’s) never gives a camera', () => {
    const audio = stand({ isAudioPlayer: (c) => c?.id === operatorPage });
    const node = stand({ isOperator: () => false });
    for (const { page, asks, checks } of [audio, node]) {
      for (const [id, url] of [
        [operatorPage, OPERATOR],
        [outputPage, OUTPUT],
      ] as const) {
        expect(asks(page(id, url), 'media', { mediaTypes: ['video'] })).toBe(false);
        expect(checks(page(id, url), 'media', { mediaType: 'video' })).toBe(false);
      }
    }
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
