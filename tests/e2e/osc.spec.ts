import { createSocket, type Socket } from 'node:dgram';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { LAYER_NAMES } from '../../src/shared/engine/state';
import type { OscSettings } from '../../src/shared/osc';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  launchApp,
  openSection,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';

// Real UDP, on localhost only; placeholder content; no HTTP server or token is needed.
const oscString = (s: string) => {
  const bytes = Buffer.from(s + '\0', 'ascii');
  return Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
};
const packet = (address: string, args: (string | number | boolean)[] = []) => {
  const tags =
    ',' +
    args.map((a) => (typeof a === 'string' ? 's' : typeof a === 'boolean' ? (a ? 'T' : 'F') : 'i')).join('');
  return Buffer.concat([
    oscString('/drashti/' + address),
    oscString(tags),
    ...args.flatMap((a) => {
      if (typeof a === 'string') return [oscString(a)];
      if (typeof a === 'boolean') return [];
      const bytes = Buffer.alloc(4);
      bytes.writeInt32BE(a);
      return [bytes];
    }),
  ]);
};
const bundle = (...messages: Buffer[]) =>
  Buffer.concat([
    oscString('#bundle'),
    Buffer.from('0000000000000001', 'hex'),
    ...messages.flatMap((m) => {
      const length = Buffer.alloc(4);
      length.writeInt32BE(m.length);
      return [length, m];
    }),
  ]);

async function bind(port = 0): Promise<{ socket: Socket; port: number }> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, '127.0.0.1', () => {
      socket.off('error', reject);
      resolve();
    });
  });
  return { socket, port: socket.address().port };
}
const close = (socket: Socket) =>
  new Promise<void>((resolve) => {
    socket.close(() => resolve());
  });
const send = (socket: Socket, port: number, bytes: Buffer) =>
  new Promise<void>((resolve, reject) => {
    socket.send(bytes, port, '127.0.0.1', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
const status = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.osc.status());
const state = async (win: Page) =>
  (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state;
const configure = (win: Page, settings: OscSettings) =>
  win.evaluate((s) => (globalThis as PageGlobals).drashti.osc.configure(s), settings);

async function action(
  win: Page,
  socket: Socket,
  port: number,
  address: string,
  args: (string | number | boolean)[] = [],
) {
  const before = (await status(win)).actions;
  await send(socket, port, packet(address, args));
  await expect
    .poll(async () => (await status(win)).actions, { message: 'OSC action ' + address })
    .toBe(before + 1);
}

async function refused(win: Page, socket: Socket, port: number, bytes: Buffer) {
  const before = await status(win);
  await send(socket, port, bytes);
  await expect.poll(async () => (await status(win)).dropped).toBe(before.dropped + 1);
  expect((await status(win)).actions).toBe(before.actions);
}

test('OSC on localhost runs every supported show action, rejects bad packets and unlisted senders, and releases its port when off', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const source = await bind();
  const reserved = await bind();
  const port = reserved.port;
  await close(reserved.socket);
  try {
    await operatorReady(win);
    const off = await status(win);
    expect(off.settings.enabled).toBe(false);
    expect(off.state).toBe('off');
    expect(await configure(win, { enabled: false, port, senders: ['127.0.0.1'] })).toMatchObject({
      ok: true,
    });
    const proof = await bind(port);
    await close(proof.socket);
    await openSection(win, 'osc');
    await win.getByTestId('open-osc').click();
    const dialog = win.getByTestId('osc-dialog');
    await dialog.getByTestId('osc-port').fill(String(port));
    await dialog.getByTestId('osc-enabled').click();
    await dialog.getByTestId('osc-save').click();
    await expect(dialog.getByTestId('osc-state')).toHaveText('Listening for listed senders');
    await expectNoSeriousA11yIssues(win, 'OSC control settings', '[data-testid="osc-dialog"]');
    await dialog.getByRole('button', { name: 'Close OSC', exact: true }).click();
    await expect(win.getByTestId('osc-badge')).toHaveText('OSC on');
    // OSC operates independently: the authenticated HTTP network stays off throughout.
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.network.status())).toMatchObject({
      on: false,
      state: 'off',
    });
    await setUpScreen(win);
    const output = await outputPage(app);
    const show = await setUpPlaceholderShow(win);
    const items = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.playlists.items(id),
      show.playlistId,
    );
    const welcome = items.find(
      (item) => item.kind === 'presentation' && item.presentationId === show.welcomeId,
    );
    expect(welcome).toBeTruthy();
    const timerId = (await state(win)).timers.find((t) => t.name === 'Sabha starts in')?.id ?? '';
    const templateId = await win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.messages.list()).find((m) => m.name === 'Car parking')
          ?.id ?? '',
    );
    expect(timerId).not.toBe('');
    expect(templateId).not.toBe('');

    await action(win, source.socket, port, 'slide', [show.kirtanId, 0]);
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder chorus line');
    await action(win, source.socket, port, 'next');
    expect((await state(win)).layers.slide?.slideIndex).toBe(1);
    await action(win, source.socket, port, 'back');
    expect((await state(win)).layers.slide?.slideIndex).toBe(0);
    await action(win, source.socket, port, 'slide', [show.kirtanId, 2]);
    expect((await state(win)).layers.slide?.slideIndex).toBe(2);
    await action(win, source.socket, port, 'previous');
    expect((await state(win)).layers.slide?.slideIndex).toBe(1);
    await action(win, source.socket, port, 'item', [show.playlistId, welcome?.id ?? '']);
    expect((await state(win)).live.presentationId).toBe(show.welcomeId);
    await action(win, source.socket, port, 'next-item');
    expect((await state(win)).live.presentationId).toBe(show.kirtanId);
    await action(win, source.socket, port, 'previous-item');
    expect((await state(win)).live.presentationId).toBe(show.welcomeId);
    for (const layer of LAYER_NAMES) {
      await action(win, source.socket, port, 'clear/' + layer);
      const layers = (await state(win)).layers;
      if (layer === 'messages') expect(layers[layer]).toHaveLength(0);
      else expect(layers[layer]).toBeNull();
    }
    await action(win, source.socket, port, 'slide', [show.kirtanId, 0]);
    await action(win, source.socket, port, 'clear/all');
    expect((await state(win)).layers.slide).toBeNull();
    await action(win, source.socket, port, 'put-back');
    expect((await state(win)).layers.slide?.presentationId).toBe(show.kirtanId);
    await action(win, source.socket, port, 'blackout', [true]);
    expect((await state(win)).blackout).toBe(true);
    await action(win, source.socket, port, 'blackout', [false]);
    expect((await state(win)).blackout).toBe(false);
    await action(win, source.socket, port, 'blackout');
    expect((await state(win)).blackout).toBe(true);
    await action(win, source.socket, port, 'wallpaper', [1]);
    expect((await state(win)).wallpaper).toBe(true);
    await action(win, source.socket, port, 'wallpaper', [0]);
    expect((await state(win)).wallpaper).toBe(false);
    await action(win, source.socket, port, 'wallpaper');
    expect((await state(win)).wallpaper).toBe(true);
    await action(win, source.socket, port, 'timers/start', [timerId]);
    expect((await state(win)).timers.find((t) => t.id === timerId)?.startedAt).not.toBeNull();
    await action(win, source.socket, port, 'timers/pause', [timerId]);
    expect((await state(win)).timers.find((t) => t.id === timerId)?.startedAt).toBeNull();
    await action(win, source.socket, port, 'timers/reset', [timerId]);
    expect((await state(win)).timers.find((t) => t.id === timerId)?.elapsedMs).toBe(0);
    await action(win, source.socket, port, 'timers/show', [timerId]);
    expect((await state(win)).layers.timer?.timerId).toBe(timerId);
    await action(win, source.socket, port, 'timers/hide');
    expect((await state(win)).layers.timer).toBeNull();
    await action(win, source.socket, port, 'messages/show', [templateId, 'plate', 'Placeholder 12']);
    expect((await state(win)).layers.messages[0]?.text).toContain('Placeholder 12');
    await action(win, source.socket, port, 'messages/hide', [templateId]);
    expect((await state(win)).layers.messages).toHaveLength(0);
    await action(win, source.socket, port, 'stage-message', ['Placeholder stage call', 'large', true]);
    expect((await state(win)).stageMessage).toBe('Placeholder stage call');
    expect((await state(win)).stageCall).toMatchObject({ size: 'large', flash: true });
    await action(win, source.socket, port, 'stage-message/clear');
    expect((await state(win)).stageMessage).toBeNull();

    await refused(win, source.socket, port, bundle(packet('next'), packet('unknown')));
    await refused(win, source.socket, port, Buffer.alloc(4));
    await refused(win, source.socket, port, packet('macros/run', ['retired']));
    expect(await configure(win, { enabled: true, port, senders: ['127.0.0.2'] })).toMatchObject({ ok: true });
    await refused(win, source.socket, port, packet('next'));
    expect(await configure(win, { enabled: true, port, senders: ['127.0.0.1'] })).toMatchObject({ ok: true });
    const beforeBundle = (await status(win)).actions;
    await send(source.socket, port, bundle(packet('blackout', [true]), packet('blackout', [false])));
    await expect.poll(async () => (await status(win)).actions).toBe(beforeBundle + 2);
    expect((await state(win)).blackout).toBe(false);
    await win.getByTestId('osc-badge').click();
    await dialog.getByTestId('osc-off').click();
    await expect(dialog.getByTestId('osc-state')).toHaveText('OSC is off');
    const released = await bind(port);
    await close(released.socket);
    await send(source.socket, port, packet('blackout', [true]));
    expect((await state(win)).blackout).toBe(false);
  } finally {
    await close(source.socket);
    await app.close();
  }
});

test('OSC reports a busy port, resumes only an explicitly enabled setting, closes on quit, and retains Simple Mode bounds', async () => {
  const first = await launchApp();
  let app = first.app;
  let win = await operatorPage(app);
  const source = await bind();
  const blocker = await bind();
  const port = blocker.port;
  let blocked = true;
  try {
    await operatorReady(win);
    expect(await configure(win, { enabled: true, port, senders: ['127.0.0.1'] })).toMatchObject({
      ok: false,
    });
    expect(await status(win)).toMatchObject({ state: 'failed', settings: { enabled: true, port } });
    await close(blocker.socket);
    blocked = false;
    expect(await configure(win, { enabled: true, port, senders: ['127.0.0.1'] })).toMatchObject({ ok: true });
    await app.close();
    const released = await bind(port);
    await close(released.socket);
    ({ app } = await relaunchApp(first.userData));
    win = await operatorPage(app);
    await operatorReady(win);
    await expect.poll(async () => (await status(win)).state).toBe('listening');
    expect((await status(win)).settings).toMatchObject({ enabled: true, port });
    await action(win, source.socket, port, 'blackout', [true]);
    expect((await state(win)).blackout).toBe(true);
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'))).toMatchObject(
      { ok: true },
    );
    expect(await configure(win, { enabled: false, port, senders: ['127.0.0.1'] })).toMatchObject({
      ok: false,
    });
    await refused(win, source.socket, port, packet('stage-message', ['Placeholder refused']));
    expect((await state(win)).stageMessage).toBeNull();
    await action(win, source.socket, port, 'blackout', [false]);
    expect((await state(win)).blackout).toBe(false);
    await expect(win.getByTestId('osc-badge')).toHaveText('OSC on');
  } finally {
    if (blocked) await close(blocker.socket);
    await close(source.socket);
    await app.close();
  }
  const released = await bind(port);
  await close(released.socket);
});
