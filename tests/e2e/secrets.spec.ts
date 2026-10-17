import { expect, test } from '@playwright/test';
import { createHash, randomInt } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiCall, NETWORK_ENV, networkOn, pairingCode } from './devices';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { filesUnder, findSecrets } from './secrets';

/*
 * The secrets of the local network and of roles (Session 31, SEC-8): a phone's token, the poster link's
 * token, a pairing code and both PINs are kept nowhere Drashti writes: its data folder (library, logs,
 * settings, Chromium's profile), the Diagnostics it saves, or a backup. Drashti keeps only a token's
 * SHA-256 and a PIN's scrypt hash. Every secret here is made at run time and never printed.
 */

/** A 12-digit PIN, made now. */
const pin = () => String(100_000_000_000 + randomInt(899_999_999_999));

test('no phone token, poster token, pairing code or PIN is kept in the data folder, the log, Diagnostics or a backup (Session 31, SEC-8)', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { port } = await networkOn(win);
  // A pairing code no file holds already: six digits could be in some file by chance.
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = await pairingCode(win, 'remote', 'Placeholder phone');
    if (findSecrets(filesUnder(userData), [{ label: 'the code', value: code, digits: true }]).length === 0)
      break;
  }
  const paired = await apiCall(port, '/api/v1/pair', { method: 'POST', body: { code } });
  expect(paired.status).toBe(200);
  const deviceToken = String(paired.json['token']);
  expect(deviceToken.length).toBeGreaterThan(20);
  // The phone uses its token, as a remote does.
  expect((await apiCall(port, '/api/v1/status', { token: deviceToken })).status).toBe(200);
  const posterToken = await win.evaluate(async () => {
    const r = await (globalThis as PageGlobals).drashti.network.makePoster();
    if (!r.ok || !r.status.poster) throw new Error('no poster link');
    return r.status.poster.url.split('#k=')[1] ?? '';
  });
  expect(posterToken.length).toBeGreaterThan(20);
  // Both PINs at their longest; setting them leaves the admin's unlocked for a while (the backup needs it).
  const admin = pin();
  let operator = pin();
  while (operator === admin) operator = pin();
  const set = await win.evaluate((pins) => (globalThis as PageGlobals).drashti.roles.setPins(pins), {
    admin,
    operator,
  });
  expect(set.ok).toBe(true);

  // Diagnostics and a backup.
  const desktop = mkdtempSync(join(tmpdir(), 'drashti-secrets-desktop-'));
  const backups = mkdtempSync(join(tmpdir(), 'drashti-secrets-backups-'));
  await app.evaluate(
    ({ app: electronApp, dialog }, { desk, into }) => {
      electronApp.setPath('desktop', desk);
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
      dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: true });
    },
    { desk: desktop, into: backups },
  );
  await chooseMenuItem(app, 'save-diagnostics');
  await expect(win.getByRole('alert').filter({ hasText: 'Diagnostics saved on the Desktop' })).toBeVisible();
  await chooseMenuItem(app, 'backup-library');
  await expect(win.getByRole('alert').filter({ hasText: 'Library backed up to' })).toBeVisible();
  await app.close();

  const all = filesUnder(userData, desktop, backups);
  // The search covers what matters: the log, the library, the roles, the Diagnostics and the backup.
  expect(all.some((f) => f.endsWith('drashti.log'))).toBe(true);
  expect(all.some((f) => f.endsWith('roles.json'))).toBe(true);
  expect(filesUnder(desktop).length).toBe(1);
  expect(filesUnder(backups).some((f) => f.endsWith('drashti.sqlite'))).toBe(true);
  expect(
    findSecrets(all, [
      { label: 'the phone’s token', value: deviceToken },
      { label: 'the poster link’s token', value: posterToken },
      { label: 'the pairing code', value: code, digits: true },
      { label: 'the admin PIN', value: admin, digits: true },
      { label: 'the operator PIN', value: operator, digits: true },
    ]),
  ).toEqual([]);
  // And the search does read the library: the phone's token is kept there as its SHA-256, by design.
  const hash = createHash('sha256').update(deviceToken).digest('hex');
  expect(
    findSecrets(all, [{ label: 'its hash', value: hash }]).some((f) => f.includes('drashti.sqlite')),
  ).toBe(true);
});
