import type { Browser, BrowserContext, Page } from '@playwright/test';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { request } from 'node:http';
import type { DeviceKind } from '../../src/shared/network';
import type { PageGlobals } from './helpers';
import { freePort } from './stream-helpers';

/*
 * Phones, tablets and browsers on the local network, for the end-to-end
 * tests: Playwright's own Chromium (Chrome on Android) and WebKit (Safari on
 * an iPhone or iPad), at their sizes, talking to the app's real server on
 * this computer. Codes and tokens are made at run time and never printed.
 */

/** Launch the app with this, so its network listens on this computer only. */
export const NETWORK_ENV = { DRASHTI_TEST_NETWORK_LOCAL: '1' };

/** Turn the app's network on, on a free port; its base address. */
export async function networkOn(win: Page): Promise<{ port: number; base: string }> {
  const port = await freePort();
  await win.evaluate(async (p) => {
    const d = (globalThis as PageGlobals).drashti;
    const set = await d.network.setPort(p);
    if (!set.ok) throw new Error(set.message);
    const on = await d.network.setOn(true);
    if (!on.ok) throw new Error(on.message);
  }, port);
  await expect
    .poll(() => win.evaluate(async () => (await (globalThis as PageGlobals).drashti.network.status()).state))
    .toBe('listening');
  return { port, base: `http://127.0.0.1:${port}` };
}

/** A pairing code from the operator window. */
export function pairingCode(win: Page, kind: DeviceKind, name: string): Promise<string> {
  return win.evaluate(
    async ({ kind, name }) => {
      const r = await (globalThis as PageGlobals).drashti.network.startPairing(kind, name);
      if (!r.ok || !r.status.pairing) throw new Error(r.ok ? 'no code' : r.message);
      return r.status.pairing.code;
    },
    { kind, name },
  );
}

export type Engine = 'chromium' | 'webkit';

/** The devices the tests stand in for: Chrome on an Android phone, Safari on an iPhone and an iPad. */
export const PHONE: Record<Engine, string> = { chromium: 'Pixel 7', webkit: 'iPhone 13' };
export const TABLET = 'iPad (gen 7)';

export interface Device {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/** A browser as a phone (or the named device). axe is injected into pages, so their CSP is bypassed for it. */
export async function device(engine: Engine, name: string = PHONE[engine]): Promise<Device> {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch();
  const context = await browser.newContext({ ...devices[name], bypassCSP: true });
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

/** Pair a device's page through the QR code's address; it ends on its own page. */
export async function pairByQr(page: Page, base: string, code: string, path: string): Promise<void> {
  await page.goto(`${base}/pair#c=${code}`);
  await page.waitForURL(`${base}${path}`);
}

/** A request to the app's API on this computer, as a script would make it; the status and the JSON answer. */
export function apiCall(
  port: number,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          } catch {
            // Not JSON.
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Pair a device of this kind for a script, through the API; its token (never printed). */
export async function pairToken(win: Page, port: number, kind: DeviceKind, name: string): Promise<string> {
  const code = await pairingCode(win, kind, name);
  const paired = await apiCall(port, '/api/v1/pair', { method: 'POST', body: { code } });
  expect(paired.status).toBe(200);
  return String(paired.json['token']);
}
