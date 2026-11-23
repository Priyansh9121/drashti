import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

interface AutoState {
  enabled: boolean;
  queue: { code: string; events: unknown[] }[];
}
function state(file: string): AutoState | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as AutoState) : null;
}

test('only the admin has automatic reporting; ordinary operators start with no consent or outbox', async () => {
  const run = await launchApp();
  await operatorReady(await operatorPage(run.app));
  expect(
    await run.app.evaluate(({ Menu }) =>
      Boolean(Menu.getApplicationMenu()?.getMenuItemById('automatic-error-reports')),
    ),
  ).toBe(false);
  expect(existsSync(join(run.userData, 'automatic-error-reports', 'state.json'))).toBe(false);
});

test('the admin sets up, separately opts in, captures a crash locally and turns off; development never calls Google', async () => {
  const run = await launchApp({}, undefined, { as: 'owner' });
  const win = await operatorPage(run.app);
  await operatorReady(win);
  expect(
    await run.app.evaluate(({ Menu }) =>
      Boolean(Menu.getApplicationMenu()?.getMenuItemById('automatic-error-reports')),
    ),
  ).toBe(true);
  const file = join(run.userData, 'automatic-error-reports', 'state.json');
  expect(state(file)?.enabled ?? false).toBe(false);
  const setup = join(run.userData, 'placeholder-automatic-setup.json');
  writeFileSync(
    setup,
    JSON.stringify({
      endpoint: 'https://script.google.com/macros/s/placeholder-install/exec',
      installId: 'b'.repeat(32),
      secret: 'd'.repeat(64),
    }),
  );
  // All actual receiver tests use local fakes. This app build must never call a Google host, even with consent.
  await run.app.evaluate(({ dialog, net }, setupFile) => {
    const counter = globalThis as typeof globalThis & { automaticReceiverCalls: number };
    counter.automaticReceiverCalls = 0;
    const original = net.request.bind(net);
    net.request = (...args: Parameters<typeof net.request>) => {
      const target = args[0];
      const url = typeof target === 'string' ? target : (target.url ?? '');
      if (url.includes('script.google')) {
        counter.automaticReceiverCalls++;
        throw new Error('A development app tried to call a real error receiver');
      }
      return original(...args);
    };
    dialog.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false });
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [setupFile] });
  }, setup);
  await chooseMenuItem(run.app, 'automatic-error-reports');
  await expect.poll(() => state(file)?.enabled).toBe(false);
  await run.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false });
  });
  await chooseMenuItem(run.app, 'automatic-error-reports');
  await expect.poll(() => state(file)?.enabled).toBe(true);
  // Exercise the actual main-process crash hook, without a real crash or any network receiver.
  await run.app.evaluate(() => {
    process.emit('uncaughtException', new Error('Placeholder private words placeholder@example.com'));
  });
  await expect.poll(() => state(file)?.queue.length).toBe(1);
  expect(state(file)?.queue[0]?.code).toBe('process-crashed');
  await run.app.evaluate(({ app }) => {
    app.emit(
      'child-process-gone',
      {},
      {
        type: 'Utility',
        reason: 'crashed',
        exitCode: 1,
        serviceName: 'placeholder',
        name: 'Placeholder private utility',
      },
    );
  });
  await expect.poll(() => state(file)?.queue.length).toBe(2);
  expect(state(file)?.queue[1]?.code).toBe('process-crashed');
  expect(
    await run.app.evaluate(
      () => (globalThis as typeof globalThis & { automaticReceiverCalls: number }).automaticReceiverCalls,
    ),
  ).toBe(0);
  const saved = readFileSync(file, 'utf8');
  expect(saved).not.toContain('Placeholder private');
  expect(saved).not.toContain('placeholder@example.com');
  await chooseMenuItem(run.app, 'automatic-error-reports');
  await expect.poll(() => state(file)?.enabled).toBe(false);
  expect(state(file)?.queue).toEqual([]);
  const disabled = readFileSync(file, 'utf8');
  await run.app.close();
  const again = await launchApp({}, run.userData, { as: 'owner' });
  await operatorReady(await operatorPage(again.app));
  expect(state(file)).toMatchObject({ enabled: false, queue: [] });
  // Reloading a configured install never restores consent after the admin turned it off.
  await again.app.evaluate(() => {
    process.emit('uncaughtException', new Error('Placeholder crash after opting out'));
  });
  expect(readFileSync(file, 'utf8')).toBe(disabled);
});
