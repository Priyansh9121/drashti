import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { askInOwnPage } from '../convert/hevc-page';
import { openPlaceholderMeeting } from '../live-window/placeholder';

const { windows, calls } = vi.hoisted(() => ({
  windows: [] as { options: { webPreferences: Record<string, unknown> }; url: string }[],
  calls: [] as string[],
}));
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function Window(options: { webPreferences: Record<string, unknown> }) {
    const made = { options, url: '' };
    windows.push(made);
    return { loadURL: async (url: string) => { made.url = url; }, showInactive: vi.fn() };
  }),
  WebContentsView: vi.fn(function View() {
    return { webContents: {
      once: vi.fn(), isDestroyed: () => false, close: vi.fn(),
      loadURL: async (url: string) => { calls.push(url); },
      executeJavaScript: async (script: string) => { calls.push(script); return true; },
    } };
  }),
}));
vi.mock('../convert/plays-hevc', () => ({
  askHevcQuestions: () => {
    calls.push('codec questions');
    return { answer: Promise.resolve(true), kinds: Promise.resolve(null) };
  },
}));

describe('the two non-renderer-folder app documents', () => {
  it('gives the test meeting a strict CSP with only its exact pattern script allowed', async () => {
    windows.length = 0;
    await openPlaceholderMeeting();
    const made = windows[0];
    expect(made).toBeDefined();
    const html = decodeURIComponent(made?.url.split(',').slice(1).join(',') ?? '');
    const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1] ?? '';
    expect(script).not.toBe('');
    const hash = createHash('sha256').update(script).digest('base64');
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/u.exec(html)?.[1] ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(`script-src 'sha256-${hash}'`);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(made?.options.webPreferences).toMatchObject({
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
    });
    expect(made?.options.webPreferences.preload).toBeUndefined();
  });

  it('installs the HEVC probe CSP before asking codec questions, keeping its about:blank identity', async () => {
    calls.length = 0;
    const probe = askInOwnPage('placeholder codec question');
    expect(await probe.answer).toBe(true);
    expect(calls[0]).toBe('about:blank');
    expect(calls[1]).toContain('Content-Security-Policy');
    expect(calls[1]).toContain("default-src 'none'");
    expect(calls[2]).toBe('codec questions');
  });
});
