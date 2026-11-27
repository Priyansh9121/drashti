import type { App, Session, WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { applySessionSecurity, secureWebContents } from './security';
import { installElectronHardening } from './electron-hardening';
import { applyStreamSessionSecurity } from '../stream/program-window';
import { isAppUrl } from './navigation';

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }));

const ROOT = 'file:///app/out/renderer/';
const own = (url: string) => isAppUrl(url, { rendererDir: '/app/out/renderer' });
const page = (name: string, id = 1) =>
  ({ id, getURL: () => `${ROOT}${name}.html` }) as unknown as WebContents;
type RequestHandler = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
type CheckHandler = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;
type CaptureHandler = NonNullable<Parameters<Session['setDisplayMediaRequestHandler']>[0]>;
type DeviceHandler = NonNullable<Parameters<Session['setDevicePermissionHandler']>[0]>;

function sessionStand() {
  let request: RequestHandler | undefined;
  let check: CheckHandler | undefined;
  let capture: CaptureHandler | undefined;
  let device: DeviceHandler | undefined;
  const session = {
    setPermissionRequestHandler: (handler: RequestHandler) => {
      request = handler;
    },
    setPermissionCheckHandler: (handler: CheckHandler) => {
      check = handler;
    },
    setDisplayMediaRequestHandler: (handler: CaptureHandler) => {
      capture = handler;
    },
    setDevicePermissionHandler: (handler: DeviceHandler) => {
      device = handler;
    },
  } as unknown as Session;
  return {
    session,
    handlers: () => ({ request, check, capture, device }),
    asks(
      contents: WebContents,
      permission: Parameters<RequestHandler>[1],
      details: Partial<Parameters<RequestHandler>[3]> = {},
    ) {
      const callback = vi.fn();
      request?.(contents, permission, callback, {
        requestingUrl: contents.getURL(),
        isMainFrame: true,
        ...details,
      });
      expect(callback).toHaveBeenCalledOnce();
      return callback.mock.calls[0]?.[0] as boolean;
    },
    checks(
      contents: WebContents | null,
      permission: Parameters<CheckHandler>[1],
      details: Partial<Parameters<CheckHandler>[3]> = {},
    ) {
      return check?.(contents, permission, '', {
        requestingUrl: contents?.getURL() ?? '',
        isMainFrame: true,
        ...details,
      });
    },
  };
}

describe('E-01: permission decisions bind the app main frame as well as window identity', () => {
  const operator = page('index');
  const audio = page('audio', 2);
  const zoom = page('zoom', 3);
  function defaults() {
    const stand = sessionStand();
    applySessionSecurity(stand.session, {
      isOwnPage: own,
      isOperator: (contents) => contents === operator,
      isAudioPlayer: (contents) => contents === audio,
      mayCapture: (contents) => contents === zoom,
    });
    return stand;
  }

  it('keeps the existing operator MIDI, speaker selection and Zoom capture grants', () => {
    const stand = defaults();
    expect(stand.asks(operator, 'midi')).toBe(true);
    expect(stand.checks(operator, 'midi')).toBe(true);
    expect(stand.checks(audio, 'speaker-selection')).toBe(true);
    expect(stand.asks(zoom, 'media', { mediaTypes: [] })).toBe(true);
    expect(stand.asks(zoom, 'media', { mediaTypes: ['audio'] })).toBe(false);
    expect(stand.asks(operator, 'midiSysex')).toBe(false);
  });

  it.each(['http://example.invalid/index.html', 'file:///elsewhere/index.html'])(
    'refuses operator MIDI request/check from an unowned URL: %s',
    (requestingUrl) => {
      const stand = defaults();
      expect(stand.asks(operator, 'midi', { requestingUrl })).toBe(false);
      expect(stand.checks(operator, 'midi', { requestingUrl })).toBe(false);
    },
  );

  it('refuses MIDI from a child frame even when it names the operator page', () => {
    const stand = defaults();
    expect(stand.asks(operator, 'midi', { isMainFrame: false })).toBe(false);
    expect(stand.checks(operator, 'midi', { isMainFrame: false })).toBe(false);
  });

  it.each(['http://example.invalid/audio.html', 'file:///elsewhere/audio.html'])(
    'refuses speaker selection from an unowned URL: %s',
    (requestingUrl) => {
      expect(defaults().checks(audio, 'speaker-selection', { requestingUrl })).toBe(false);
    },
  );

  it('refuses speaker selection from an app child frame', () => {
    expect(defaults().checks(audio, 'speaker-selection', { isMainFrame: false })).toBe(false);
  });

  it('refuses screen-picture permission for child frames and foreign requesting pages', () => {
    const stand = defaults();
    expect(stand.asks(zoom, 'media', { mediaTypes: [], isMainFrame: false })).toBe(false);
    expect(
      stand.asks(zoom, 'media', {
        mediaTypes: [],
        requestingUrl: 'http://example.invalid/zoom.html',
      }),
    ).toBe(false);
  });

  function program() {
    const stand = sessionStand();
    const contents = page('stream');
    applyStreamSessionSecurity(stand.session, {
      isProgram: (c) => c === contents,
      isOwnPage: own,
    });
    return { ...stand, contents };
  }

  it('keeps Program camera, microphone and self-capture permission on its own main page', () => {
    const stand = program();
    expect(stand.asks(stand.contents, 'media', { mediaTypes: ['audio', 'video'] })).toBe(true);
    expect(stand.asks(stand.contents, 'media', { mediaTypes: [] })).toBe(true);
    expect(stand.checks(stand.contents, 'media', { mediaType: 'audio' })).toBe(true);
    expect(stand.checks(stand.contents, 'media', { mediaType: 'video' })).toBe(true);
  });

  it.each(['http://example.invalid/stream.html', 'file:///elsewhere/stream.html'])(
    'refuses Program devices from an unowned requesting URL: %s',
    (requestingUrl) => {
      const stand = program();
      expect(
        stand.asks(stand.contents, 'media', {
          requestingUrl,
          mediaTypes: ['audio', 'video'],
        }),
      ).toBe(false);
      expect(stand.checks(stand.contents, 'media', { requestingUrl, mediaType: 'audio' })).toBe(false);
    },
  );

  it('refuses Program devices from child frames and unknown device checks', () => {
    const stand = program();
    expect(
      stand.asks(stand.contents, 'media', {
        isMainFrame: false,
        mediaTypes: ['audio'],
      }),
    ).toBe(false);
    expect(stand.checks(stand.contents, 'media', { isMainFrame: false, mediaType: 'audio' })).toBe(false);
    expect(stand.checks(stand.contents, 'media', { mediaType: 'unknown' })).toBe(false);
  });
});

describe('E-02: renderers cannot change the document attached to a privileged WebContents', () => {
  it('preserves the exact-page main-frame reload used by window recovery', () => {
    const url = `${ROOT}index.html#security-placeholder`;
    const contents = Object.assign(new EventEmitter(), {
      getURL: () => url,
      setWindowOpenHandler: vi.fn(),
    });
    secureWebContents(contents as unknown as WebContents, own);
    for (const eventName of ['will-navigate', 'will-frame-navigate']) {
      const preventDefault = vi.fn();
      contents.emit(eventName, { url, isMainFrame: true, preventDefault });
      expect(preventDefault, eventName).not.toHaveBeenCalled();
    }
  });

  it.each(['will-navigate', 'will-redirect', 'will-frame-navigate'])(
    'refuses %s even for another packaged app page',
    (eventName) => {
      const contents = Object.assign(new EventEmitter(), {
        getURL: () => `${ROOT}gallery.html`,
        setWindowOpenHandler: vi.fn(),
      });
      secureWebContents(contents as unknown as WebContents);
      for (const url of [
        `${ROOT}audio.html`,
        `${ROOT}output.html`,
        `${ROOT}index.html`,
        'file:///elsewhere/index.html',
        'https://example.invalid/',
        'about:blank',
        'data:text/html,placeholder',
        'javascript:void(0)',
      ]) {
        const preventDefault = vi.fn();
        contents.emit(eventName, { url, preventDefault });
        expect(preventDefault, url).toHaveBeenCalledOnce();
      }
    },
  );

  it('denies popup creation and webview attachment', () => {
    const setWindowOpenHandler = vi.fn();
    const contents = Object.assign(new EventEmitter(), { setWindowOpenHandler });
    secureWebContents(contents as unknown as WebContents);
    const open = setWindowOpenHandler.mock.calls[0]?.[0] as () => unknown;
    expect(open()).toEqual({ action: 'deny' });
    const preventDefault = vi.fn();
    contents.emit('will-attach-webview', { preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});

describe('E-03: every session starts with no permissions', () => {
  it('denies requests, checks, devices and display capture in a newly created partition', () => {
    const app = new EventEmitter();
    installElectronHardening(app as unknown as App);
    const stand = sessionStand();
    app.emit('session-created', stand.session);
    const handlers = stand.handlers();
    expect(handlers.request).toBeTypeOf('function');
    expect(handlers.check).toBeTypeOf('function');
    expect(handlers.capture).toBeTypeOf('function');
    expect(handlers.device).toBeTypeOf('function');
    for (const permission of [
      'media',
      'notifications',
      'midi',
      'speaker-selection',
      'usb',
      'serial',
      'hid',
      'clipboard-read',
      'openExternal',
      'unknown',
    ] as const) {
      expect(stand.asks(page('index'), permission)).toBe(false);
      expect(stand.checks(page('index'), permission)).toBe(false);
    }
    expect(handlers.device?.({} as Parameters<DeviceHandler>[0])).toBe(false);
    const callback = vi.fn();
    handlers.capture?.({} as Parameters<CaptureHandler>[0], callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith({});
  });

  it('lets Main install only the existing role-specific grants after the baseline', () => {
    const app = new EventEmitter();
    installElectronHardening(app as unknown as App);
    const stand = sessionStand();
    app.emit('session-created', stand.session);
    const operator = page('index');
    applySessionSecurity(stand.session, { isOwnPage: own, isOperator: (c) => c === operator });
    expect(stand.asks(operator, 'midi')).toBe(true);
    expect(stand.asks(operator, 'media', { mediaTypes: ['audio'] })).toBe(false);
    expect(stand.checks(page('audio'), 'speaker-selection')).toBe(false);
  });
});
