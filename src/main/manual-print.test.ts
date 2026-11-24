import { mkdtempSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { printPage, type PrintPage } from './manual-print';

/*
 * The shared printer's own guard (alpha.22, a22-review-print M1): a page whose temporary folder cannot be taken away
 * (Windows' EBUSY or EPERM while something still holds the new file for a moment) fails that print alone; the next
 * page prints. The hidden window is a stand-in here (Electron's own is proven by manual.spec.ts and the print specs).
 */

const { makeWindow, fromPartition } = vi.hoisted(() => ({
  makeWindow: vi.fn(function Window() {
    return {
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        executeJavaScript: vi.fn(() => Promise.resolve(true)),
        printToPDF: vi.fn(() => Promise.resolve(Buffer.from('%PDF-placeholder'))),
      },
      loadFile: vi.fn(() => Promise.resolve()),
      isDestroyed: () => false,
      destroy: vi.fn(),
    };
  }),
  fromPartition: vi.fn(() => ({
    webRequest: { onBeforeRequest: vi.fn() },
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock('electron', () => ({ BrowserWindow: makeWindow, session: { fromPartition } }));
vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>();
  return { ...real, rmSync: vi.fn(real.rmSync) };
});

const temp = mkdtempSync(join(tmpdir(), 'drashti-print-test-'));
afterAll(() => {
  vi.mocked(fs.rmSync).mockRestore();
  fs.rmSync(temp, { recursive: true, force: true });
});

const page = (): PrintPage => ({
  html: '<!doctype html><title>Placeholder</title><p>Placeholder</p>',
  pictures: [],
  tempDir: temp,
  kind: 'pdf',
  title: 'Placeholder',
  footer: 'Placeholder',
});

it('prints the next page after one whose temporary folder could not be taken away (EBUSY): that print alone fails', async () => {
  vi.mocked(fs.rmSync).mockImplementationOnce(() => {
    throw Object.assign(new Error('placeholder: resource busy'), { code: 'EBUSY' });
  });
  await expect(printPage(page())).rejects.toThrow('resource busy');
  const next = await printPage(page());
  expect(next).toEqual({ ok: true, pdf: Buffer.from('%PDF-placeholder') });
  expect(makeWindow).toHaveBeenCalledTimes(2);
});
