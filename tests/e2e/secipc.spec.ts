import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPC } from '../../src/shared/ipc';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  setUpScreen,
  type PageGlobals,
} from './helpers';

test('assigned main frames retain their APIs and refuse another role or an embedded frame at the native IPC boundary', async () => {
  const { app } = await launchApp();
  const operator = await operatorPage(app);
  await operatorReady(operator);
  await setUpScreen(operator);
  const output = await outputPage(app);
  await outputReady(output);
  const methods = await output.evaluate(() => {
    const bridge = (globalThis as PageGlobals).drashti;
    return {
      media: Object.keys(bridge.media),
      engine: Object.keys(bridge.engine),
      app: Object.keys(bridge.app),
    };
  });
  expect(methods.media).toContain('looks');
  expect(methods.media).toContain('cannotPlay');
  expect(methods.media).not.toContain('remove');
  expect(methods.media).not.toContain('setPlayback');
  expect(methods.engine).toContain('videoCueReady');
  expect(methods.engine).not.toContain('dispatch');
  expect(methods.app).not.toContain('setMode');
  expect(await output.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).toHaveProperty(
    'rev',
  );

  const refused = await app.evaluate(async ({ BrowserWindow, ipcMain }, channel) => {
    type Handler = (event: unknown) => unknown;
    const handler = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get(
      channel,
    );
    const windows = BrowserWindow.getAllWindows();
    const operator = windows.find((win) => win.webContents.getURL().includes('/index.html'));
    const output = windows.find((win) => win.webContents.getURL().includes('/output.html'));
    if (!handler || !operator || !output) throw new Error('Missing native IPC fixture.');
    const denied = async (event: unknown) => {
      try {
        await handler(event);
        return false;
      } catch (error) {
        return error instanceof Error && error.message.includes('Refused');
      }
    };
    return {
      role: await denied({ sender: output.webContents, senderFrame: output.webContents.mainFrame }),
      child: await denied({
        sender: operator.webContents,
        senderFrame: { url: operator.webContents.getURL() },
      }),
    };
  }, IPC.library.listPresentations);
  expect(refused).toEqual({ role: true, child: true });
  expect(
    await operator.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations()),
  ).toHaveLength(2);
  await app.close();
});

test('a folder import reports an outside file link, retains an inside link and honours a later explicit file choice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-secipc-'));
  const folder = join(root, 'selected');
  const outside = join(root, 'outside.txt');
  const blocked = join(folder, 'outside-link.txt');
  mkdirSync(folder);
  writeFileSync(outside, '[Verse]\nPrivate placeholder line.');
  const inside = join(folder, 'inside.txt');
  writeFileSync(inside, '[Verse]\nChosen placeholder line.');
  symlinkSync(outside, blocked, 'file');
  symlinkSync(inside, join(folder, 'inside-link.txt'), 'file');
  const { app } = await launchApp();
  try {
    const operator = await operatorPage(app);
    await operatorReady(operator);
    const report = await operator.evaluate(async (folder) => {
      const library = (globalThis as PageGlobals).drashti.library;
      const result = await library.importPaths([folder], {});
      if (!result.ok) throw new Error(result.message);
      return library.getImportReport(result.run.id);
    }, folder);
    expect(report?.items.find((item) => item.sourcePath === blocked)).toMatchObject({
      name: 'outside-link.txt',
      outcome: 'skipped',
      issues: [{ code: 'outside-import-folder', fix: null }],
    });
    expect(report?.items.filter((item) => item.outcome === 'imported')).toHaveLength(1);
    expect(report?.items.find((item) => item.sourcePath.endsWith('inside-link.txt'))?.outcome).toBe(
      'imported',
    );
    const explicit = await operator.evaluate(async (file) => {
      const library = (globalThis as PageGlobals).drashti.library;
      const result = await library.importPaths([file], {});
      if (!result.ok) throw new Error(result.message);
      return library.getImportReport(result.run.id);
    }, blocked);
    expect(explicit?.items).toEqual([expect.objectContaining({ sourcePath: blocked, outcome: 'imported' })]);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
