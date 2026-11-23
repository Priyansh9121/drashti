import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import type { ToDevice } from '../../src/shared/network';
import { apiCall, device, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { launchApp, operatorPage, operatorReady } from './helpers';

test('paired phones and tablets keep their places and a phone can reload while new feeds wait', async () => {
  const { app } = await launchApp(NETWORK_ENV);
  const opened: WebSocket[] = [];
  const phone = await device('chromium');
  const open = (port: number) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/api/v1/feed`);
      opened.push(ws);
      ws.once('open', () => resolve(ws));
      ws.on('error', reject);
    });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const { port, base } = await networkOn(win);
    await pairByQr(phone.page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveAttribute('data-state', 'online');
    const stage = await apiCall(port, '/api/v1/pair', {
      method: 'POST',
      body: { code: await pairingCode(win, 'stage', 'Placeholder tablet') },
    });
    expect(stage.status).toBe(200);
    const token = stage.json['token'];
    expect(typeof token).toBe('string');
    for (let i = 0; i < 10; i++) await open(port);
    await expect(win.getByTestId('operator-notice')).toContainText(
      'Drashti is busy with new connections. Paired devices keep their places.',
    );
    const tablet = await open(port);
    const welcome = new Promise<ToDevice>((resolve) =>
      tablet.once('message', (data: Buffer) => resolve(JSON.parse(data.toString('utf8')) as ToDevice)),
    );
    tablet.send(JSON.stringify({ type: 'hello', token }));
    expect(await welcome).toMatchObject({ type: 'welcome', device: { kind: 'stage' } });
    await expect(phone.page.getByTestId('connection')).toHaveAttribute('data-state', 'online');
    expect(opened.some((ws) => ws !== tablet && ws.readyState === WebSocket.OPEN)).toBe(true);
    await phone.page.reload();
    await expect(phone.page.getByTestId('connection')).toHaveAttribute('data-state', 'online');
    await open(port);
    await open(port);
    expect(opened.some((ws) => ws !== tablet && ws.readyState === WebSocket.OPEN)).toBe(true);
    await phone.page.goto(`${base}/pair`);
    await expect(phone.page).toHaveURL(`${base}/remote`);
    await expect(phone.page.getByTestId('connection')).toHaveAttribute('data-state', 'online');
    expect((await apiCall(port, '/api/v1/me', { token: String(token) })).status).toBe(200);
  } finally {
    for (const ws of opened) ws.terminate();
    await phone.close();
    await app.close();
  }
});
