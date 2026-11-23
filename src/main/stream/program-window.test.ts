import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  applyStreamSessionSecurity,
  createProgramWindow,
  isStreamPage,
  streamPermissionAllowed,
} from './program-window';

const { made } = vi.hoisted(() => ({
  made: [] as {
    options: { webPreferences?: { offscreen?: unknown } };
    painting: boolean;
    listeners: Map<string, unknown>;
  }[],
}));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function Window(options: { webPreferences?: { offscreen?: unknown } }) {
    const win = { options, painting: true, listeners: new Map<string, unknown>() };
    made.push(win);
    return {
      getContentSize: () => [1920, 1080],
      setContentSize: vi.fn(),
      webContents: {
        setFrameRate: vi.fn(),
        on: (event: string, listener: unknown) => {
          win.listeners.set(event, listener);
        },
        stopPainting: () => {
          win.painting = false;
        },
        startPainting: () => {
          win.painting = true;
        },
      },
    };
  }),
}));
vi.mock('../windows/renderer', () => ({ loadPage: () => Promise.resolve() }));
vi.mock('../windows/web-preferences', () => ({ secureWebPreferences: () => ({}) }));

describe('the stream session’s permissions', () => {
  const page = 'file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/stream.html';

  it('give the camera and a sound input to the stream’s page in the Program window, and nothing else', () => {
    expect(isStreamPage(page)).toBe(true);
    expect(isStreamPage('http://localhost:5173/stream.html')).toBe(true);
    expect(isStreamPage('file:///x/out/renderer/index.html')).toBe(false);
    expect(streamPermissionAllowed('media', true, page, ['video', 'audio'])).toBe(true);
    expect(streamPermissionAllowed('media', true, page)).toBe(true);
    expect(streamPermissionAllowed('media', false, page, ['video'])).toBe(false);
    expect(streamPermissionAllowed('media', true, 'file:///x/out/renderer/index.html', ['video'])).toBe(
      false,
    );
    for (const other of [
      'notifications',
      'geolocation',
      'display-capture',
      'speaker-selection',
      'clipboard-read',
    ])
      expect(streamPermissionAllowed(other, true, page), other).toBe(false);
  });
});

describe('the Program window', () => {
  it('is drawn off screen, and none of its frames reach the main process: its page captures itself (Session 58, C26)', () => {
    made.length = 0;
    createProgramWindow({ width: 1920, height: 1080 });
    expect(made).toHaveLength(1);
    expect(made[0]?.options.webPreferences?.offscreen).toBeTruthy();
    // Without a graphics chip each frame was a whole picture copied into the main process, and the next waited for it.
    expect(made[0]?.painting).toBe(false);
  });
});

it('routes microphone permission to the sound renderer in the original stream session, without granting its camera or display capture', () => {
  const handlers: {
    request?: (
      contents: WebContents,
      permission: string,
      answer: (allowed: boolean) => void,
      details: { requestingUrl: string; mediaTypes: string[] },
    ) => void;
    display?: (request: { frame: { parent: null; url: string } }, answer: (grant: object) => void) => void;
  } = {};
  const session = {
    setPermissionRequestHandler: (next: NonNullable<typeof handlers.request>) => {
      handlers.request = next;
    },
    setPermissionCheckHandler: vi.fn(),
    setDisplayMediaRequestHandler: (next: NonNullable<typeof handlers.display>) => {
      handlers.display = next;
    },
  } as unknown as Session;
  const picture = {} as WebContents,
    sound = {} as WebContents;
  const rules = {
    isProgram: (contents: WebContents | null) => contents === picture,
    isSound: (contents: WebContents | null) => contents === sound,
  };
  applyStreamSessionSecurity(session, rules);
  if (!handlers.request || !handlers.display) throw new Error('The stream session did not install its rules');
  const url = 'file:///generated/stream-sound.html';
  const answer = vi.fn();
  handlers.request(sound, 'media', answer, { requestingUrl: url, mediaTypes: ['audio'] });
  expect(answer).toHaveBeenLastCalledWith(true);
  handlers.request(sound, 'media', answer, { requestingUrl: url, mediaTypes: ['video'] });
  expect(answer).toHaveBeenLastCalledWith(false);
  handlers.request({} as WebContents, 'media', answer, { requestingUrl: url, mediaTypes: ['audio'] });
  expect(answer).toHaveBeenLastCalledWith(false);
  const capture = vi.fn();
  handlers.display({ frame: { parent: null, url } }, capture);
  expect(capture).toHaveBeenCalledWith({});
});
