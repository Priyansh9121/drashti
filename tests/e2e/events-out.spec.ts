import { expect, test, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_REFUSAL } from '../../src/shared/roles';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Events out (Session 28, decision 20): an admin adds an address on this computer and ticks what it gets;
 * Next reaches it within a second, signed two ways (checked here with node:crypto, apart from Drashti's own
 * code), with ids and kinds only until "Include the words" is ticked; a retry keeps its id; a 410 turns the
 * address off; a receiver that never answers changes neither slide changes nor quitting; Simple Mode and a
 * locked admin cannot open it. The receiver is this test, on 127.0.0.1 (the test guard refuses anywhere
 * else). The secret is made by Drashti as the test runs, and searched for in its files afterwards.
 */

const MARKER = 'Zqxeventsmarker';

type Mode = 'ok' | 'fail-once' | 'gone' | 'hang';
interface Got {
  at: number;
  headers: IncomingHttpHeaders;
  body: string;
  type: string;
  data: Record<string, unknown>;
}

async function receiver(): Promise<{
  url: string;
  got: Got[];
  setMode: (m: Mode) => void;
  close: () => Promise<void>;
}> {
  const got: Got[] = [];
  let mode: Mode = 'ok';
  const failed = new Set<string>();
  const hung: ServerResponse[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(body) as { type: string; data: Record<string, unknown> };
      got.push({ at: Date.now(), headers: req.headers, body, type: parsed.type, data: parsed.data });
      const id = String(req.headers['webhook-id']);
      if (mode === 'hang') {
        hung.push(res);
        return;
      }
      if (mode === 'gone') res.writeHead(410).end();
      else if (mode === 'fail-once' && !failed.has(id)) {
        failed.add(id);
        res.writeHead(503).end();
      } else res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/hook/drashti`,
    got,
    setMode: (m) => {
      mode = m;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Standard Webhooks' check and the GitHub-style header's, as a receiver would make them. */
function signedBy(secret: string, g: Got): { standard: boolean; githubStyle: boolean } {
  const id = String(g.headers['webhook-id']);
  const ts = String(g.headers['webhook-timestamp']);
  const key = Buffer.from(secret.replace(/^whsec_/u, ''), 'base64');
  const want = `v1,${createHmac('sha256', key).update(`${id}.${ts}.${g.body}`).digest('base64')}`;
  const github = `sha256=${createHmac('sha256', secret).update(g.body).digest('hex')}`;
  return {
    standard: String(g.headers['webhook-signature']).split(' ').includes(want),
    githubStyle: g.headers['x-drashti-signature-256'] === github,
  };
}

/** Every file under `dir` holding `needle`. */
function filesHolding(dir: string, needle: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const s = statSync(path);
    if (s.isDirectory()) found.push(...filesHolding(path, needle));
    else if (s.size < 50_000_000 && readFileSync(path).includes(needle)) found.push(path);
  }
  return found;
}

const dispatch = (win: Page, command: Record<string, unknown>) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

async function placeholderSlides(win: Page): Promise<string> {
  return win.evaluate(async (marker) => {
    const made = await (globalThis as PageGlobals).drashti.library.newFromWords(
      'Placeholder events',
      `Placeholder first line ${marker}\n\nPlaceholder second line ${marker}\n\nPlaceholder third line ${marker}\n\nPlaceholder fourth line ${marker}`,
    );
    if (!made.ok) throw new Error(made.message);
    return made.id;
  }, MARKER);
}

async function addAddress(win: Page, url: string): Promise<string> {
  const dialog = win.getByTestId('events-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('events-url').fill(url);
  await dialog.getByTestId('events-add').click();
  const secret = (await dialog.getByTestId('events-secret-value').textContent()) ?? '';
  expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]+=*$/u);
  // A window sees the host, never the path.
  await expect(dialog.getByTestId('events-host-0')).toHaveText(new URL(url).host);
  await expect(dialog).not.toContainText('/hook/drashti');
  return secret;
}

test('an address on this computer gets each slide within a second of Next, signed, ids only until the words are ticked; a retry keeps its id; a 410 turns it off', async () => {
  test.setTimeout(120_000);
  const r = await receiver();
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await win.setViewportSize({ width: 1280, height: 860 });
    await operatorReady(win);
    const presentationId = await placeholderSlides(win);

    // Nothing is on by default: the show goes on and nothing is sent.
    await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
    await chooseMenuItem(app, 'events-out');
    const secret = await addAddress(win, r.url);
    const dialog = win.getByTestId('events-dialog');
    await dispatch(win, { type: 'next' });
    await win.waitForTimeout(500);
    expect(r.got).toHaveLength(0);

    await dialog.getByTestId('events-kind-slide.changed-0').check();
    await dialog.getByTestId('events-kind-blackout.changed-0').check();
    await expect(dialog.getByTestId('events-words-slide.changed-0')).not.toBeChecked();
    await expectNoSeriousA11yIssues(win, 'Events out');
    // Next: there within a second.
    const t0 = Date.now();
    await dispatch(win, { type: 'next' });
    await expect.poll(() => r.got.find((g) => g.type === 'slide.changed')).toBeTruthy();
    const first = r.got.find((g) => g.type === 'slide.changed');
    if (!first) throw new Error('no slide.changed');
    expect(first.at - t0).toBeLessThan(1000);
    expect(first.data).toMatchObject({ presentationId, slideIndex: 2, repeat: false });
    expect(signedBy(secret, first)).toEqual({ standard: true, githubStyle: true });
    expect(first.body).not.toContain(MARKER);

    // Include the words: now they come.
    await dialog.getByTestId('events-words-slide.changed-0').check();
    await dispatch(win, { type: 'goLive', presentationId, slideIndex: 1 });
    await expect.poll(() => r.got.filter((g) => g.type === 'slide.changed').length).toBe(2);
    expect(r.got.at(-1)?.body).toContain(MARKER);
    expect(r.got.at(-1)?.data['slideIndex']).toBe(1);

    // A receiver that fails once: tried again at once, with the same id and a fresh signature.
    r.setMode('fail-once');
    const before = r.got.length;
    await dispatch(win, { type: 'setBlackout', on: true });
    await expect.poll(() => r.got.length).toBe(before + 2);
    const [tried, again] = r.got.slice(before);
    expect(tried?.type).toBe('blackout.changed');
    expect(again?.headers['webhook-id']).toBe(tried?.headers['webhook-id']);
    if (again) expect(signedBy(secret, again).standard).toBe(true);

    // Send a test: said in words.
    r.setMode('ok');
    await dialog.getByTestId('events-test-0').click();
    await expect(dialog.getByTestId('events-test-result-0')).toHaveText(
      'The receiver answered 204: events reach it.',
    );

    // A 410: the address is turned off, the operator told, and nothing more goes to it.
    r.setMode('gone');
    await dispatch(win, { type: 'setBlackout', on: false });
    await expect(win.getByRole('alert').filter({ hasText: 'said it is gone' })).toBeVisible();
    await expect(dialog.getByTestId('events-address-0')).toContainText('Off');
    const sent = r.got.length;
    await dispatch(win, { type: 'next' });
    await win.waitForTimeout(1000);
    expect(r.got).toHaveLength(sent);

    await app.close();
    // The secret and the address's path are nowhere in Drashti's files as written: only encrypted.
    expect(filesHolding(userData, secret)).toEqual([]);
    expect(filesHolding(userData, '/hook/drashti')).toEqual([]);
  } finally {
    await app.close().catch(() => undefined);
    await r.close();
  }
});

test('a receiver that never answers changes neither slide changes nor quitting', async () => {
  test.setTimeout(120_000);
  const r = await receiver();
  r.setMode('hang');
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const presentationId = await placeholderSlides(win);
    await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
    /** How long each of 12 slide changes takes the main process, there and back (the middle one). */
    const changes = async () => {
      const ms: number[] = [];
      for (let i = 0; i < 12; i++) {
        const index = i % 4;
        ms.push(
          await win.evaluate(
            async ({ id, index: slideIndex }) => {
              const t = performance.now();
              await (globalThis as PageGlobals).drashti.engine.dispatch({
                type: 'goLive',
                presentationId: id,
                slideIndex,
              });
              return performance.now() - t;
            },
            { id: presentationId, index },
          ),
        );
      }
      return ms.sort((a, b) => a - b)[6] ?? 0;
    };
    const without = await changes();
    await chooseMenuItem(app, 'events-out');
    await addAddress(win, r.url);
    await win.getByTestId('events-dialog').getByTestId('events-kind-slide.changed-0').check();
    await win.getByTestId('events-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const withHung = await changes();
    // The receiver has them, unanswered.
    await expect.poll(() => r.got.length).toBeGreaterThan(0);
    expect(withHung).toBeLessThan(without + 25);
    const t = Date.now();
    await app.close();
    expect(Date.now() - t).toBeLessThan(10_000);
  } finally {
    await app.close().catch(() => undefined);
    await r.close();
  }
});

test('Simple Mode and a locked admin cannot open events out, nor read them', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // Roles on, admin locked.
    const set = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.roles.setPins({ admin: '481526', operator: '937402' }),
    );
    expect(set.ok).toBe(true);
    await win.getByTestId('role-chip').click();
    await expect(win.getByTestId('role-chip')).toHaveAttribute('data-role', 'operator');
    await chooseMenuItem(app, 'events-out');
    const prompt = win.getByTestId('admin-pin');
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Cancel' }).click();
    await win.waitForTimeout(500);
    await expect(win.getByTestId('events-dialog')).toHaveCount(0);
    await win.evaluate(() => {
      (globalThis as PageGlobals).drashti.roles.setAdminAsker(() => Promise.resolve(false));
    });
    const locked = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      return { view: await d.events.view(), add: await d.events.add('http://127.0.0.1:9/x', false) };
    });
    expect(locked.view).toEqual({ available: false, message: ADMIN_REFUSAL, addresses: [] });
    expect(locked.add).toEqual({ ok: false, message: ADMIN_REFUSAL });

    // Simple Mode: no File menu, and the main process refuses.
    await win.getByRole('button', { name: 'Simple Mode' }).click();
    await expect
      .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
      .toBe('simple');
    expect(
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('events-out') ?? null),
    ).toBeNull();
    const simple = await win.evaluate(() => (globalThis as PageGlobals).drashti.events.view());
    expect(simple.message === SIMPLE_MODE_REFUSAL || simple.message === ADMIN_REFUSAL).toBe(true);
    expect(simple.addresses).toEqual([]);
  } finally {
    await app.close().catch(() => undefined);
  }
});
