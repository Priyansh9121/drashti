import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, type Engine, networkOn, NETWORK_ENV, pairByQr, pairingCode, TABLET } from './devices';
import { expectFits } from './fit';
import { launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Pairing phones through the operator window's Network panel: by the QR
 * code's address (Chrome on Android) and by typing the code (Safari on an
 * iPhone); a code works once; a wrong one is refused; Remove cuts a device
 * off. Codes and tokens are made at run time and never printed.
 */

test('the Network panel turns it on, pairs a phone by QR code and another by typing the code, and removes one', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);

  // On from the panel, which then shows the address and offers pairing.
  await win.getByTestId('open-network').click();
  const panel = win.getByTestId('network-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('network-state')).toContainText('Off');
  const { base } = await networkOn(win);
  await expect(win.getByTestId('network-badge')).toHaveText(/Network on · 0 devices/u);
  await panel.getByTestId('pair-name').fill('Placeholder phone');
  await panel.getByTestId('pair-remote').click();
  await expect(panel.getByTestId('pairing-offer')).toBeVisible();
  await expect(panel.getByTestId('qr-code')).toBeVisible();
  await expectFits(panel, 'the Network panel with a pairing code at 1280 x 720');
  await expectNoSeriousA11yIssues(win, 'the Network panel with a pairing code');
  const code = (await panel.getByTestId('pairing-code').innerText()).replace(/\s/gu, '');

  // A phone pairs by the QR code's address: the code leaves the address at once.
  const android = await device('chromium');
  try {
    await pairByQr(android.page, base, code, '/remote');
    expect(android.page.url()).not.toContain(code);
    const kept = await android.page.evaluate(() => localStorage.getItem('drashti.device') ?? '');
    expect(JSON.parse(kept)).toMatchObject({ name: 'Placeholder phone', kind: 'remote' });
    await expect(panel.getByTestId('device-row')).toHaveCount(1);
    await expect(panel.getByTestId('device-row')).toContainText('Placeholder phone');
    // The same code does not pair a second device.
    const again = await device('webkit');
    await again.page.goto(`${base}/pair`);
    await again.page.getByTestId('pair-code').fill(code);
    await again.page.getByRole('button', { name: 'Pair' }).click();
    await expect(again.page.getByRole('alert')).toContainText('wrong or has expired');
    await again.close();
  } finally {
    await android.close();
  }

  // An iPhone pairs by typing a new code.
  await panel.getByTestId('pair-stage').click();
  const typed = (await panel.getByTestId('pairing-code').innerText()).replace(/\s/gu, '');
  const iphone = await device('webkit');
  try {
    await iphone.page.goto(`${base}/pair`);
    await expectNoSeriousA11yIssues(iphone.page, 'the pairing page on an iPhone');
    await iphone.page.setViewportSize({ width: 375, height: 812 });
    await expectNoSeriousA11yIssues(iphone.page, 'the pairing page at 375 x 812');
    const ipad = await device('webkit', TABLET);
    try {
      await ipad.page.goto(`${base}/pair`);
      await expect(ipad.page.getByTestId('pair-page')).toBeVisible();
      await expectNoSeriousA11yIssues(ipad.page, 'the pairing page on a tablet');
    } finally {
      await ipad.close();
    }
    await iphone.page.getByTestId('pair-code').fill(`${typed.slice(0, 3)} ${typed.slice(3)}`);
    await iphone.page.getByRole('button', { name: 'Pair' }).click();
    await iphone.page.waitForURL(`${base}/stage`);
    await expect(panel.getByTestId('device-row')).toHaveCount(2);
  } finally {
    await iphone.close();
  }

  // Remove asks first, then the device is gone (and cut off: network.spec checks its feed and token).
  const row = panel.getByTestId('device-row').filter({ hasText: 'Placeholder phone' });
  await row.getByTestId('remove-device').click();
  await win.getByTestId('remove-device-confirm').getByRole('button', { name: 'Remove' }).click();
  await expect(panel.getByTestId('device-row')).toHaveCount(1);
  await app.close();
});

for (const engine of ['chromium', 'webkit'] as Engine[]) {
  test(`wrong codes are refused, then rate-limited (${engine})`, async () => {
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const wrong = code === '000000' ? '111111' : '000000';
    const phone = await device(engine);
    try {
      await phone.page.goto(`${base}/pair`);
      await expect(phone.page.getByTestId('pair-page')).toBeVisible();
      await expectNoSeriousA11yIssues(phone.page, `the pairing page (${engine})`);
      for (let i = 0; i < 5; i++) {
        await phone.page.getByTestId('pair-code').fill(wrong);
        await phone.page.getByRole('button', { name: 'Pair' }).click();
        await expect(phone.page.getByRole('alert')).toContainText('wrong or has expired');
      }
      // The sixth try in a minute is refused, the right code too.
      await phone.page.getByTestId('pair-code').fill(code);
      await phone.page.getByRole('button', { name: 'Pair' }).click();
      await expect(phone.page.getByRole('alert')).toContainText('Too many wrong codes');
    } finally {
      await phone.close();
    }
    await app.close();
  });
}
