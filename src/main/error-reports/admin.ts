import { dialog, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import type { ErrorReports } from './service';

/** Native admin control: configuration never crosses renderer IPC and the secret is never displayed. */
export async function manageErrorReports(
  service: ErrorReports,
  parent: BrowserWindow,
  owner: () => boolean,
): Promise<void> {
  if (!owner()) return;
  const status = service.status();
  if (!status.healthy) {
    await dialog.showMessageBox(parent, {
      type: 'error',
      message:
        'Automatic error reports could not read or save their settings. Check this computer’s data folder.',
      detail:
        'Reporting is off. Ask the admin to check this computer’s data folder before setting it up again.',
    });
    return;
  }
  const answer = await dialog.showMessageBox(parent, {
    type: 'question',
    title: 'Automatic Error Reports',
    message: status.enabled
      ? 'Automatic error reports are on for this computer.'
      : 'Automatic error reports are off for this computer.',
    detail:
      'Send error codes, counts, computer and access entry ids, version, system and up to 30 coded log events to your own Sheet and Drive folder. No content, email addresses, passwords, pictures or raw crash files. Up to 10 reports a day; offline reports wait up to 7 days. Nothing sends while streaming or recording. Turning off clears reports waiting here.',
    buttons: [status.enabled ? 'Turn Off' : 'Turn On', 'Set Up…', 'Close'],
    defaultId: 2,
    cancelId: 2,
  });
  if (!owner()) return;
  if (answer.response === 0) {
    if (!service.enable(!status.enabled)) {
      await dialog.showMessageBox(parent, {
        type: 'info',
        message: 'Set up this computer first.',
        detail: 'Choose Set Up… and open the setup file the admin made for this computer.',
      });
    } else if (!status.enabled) {
      void service.wake();
    }
  } else if (answer.response === 1) {
    const picked = await dialog.showOpenDialog(parent, {
      title: 'Open this computer’s error report setup file',
      properties: ['openFile'],
      filters: [{ name: 'Setup file', extensions: ['json'] }],
    });
    const path = picked.filePaths[0];
    if (picked.canceled || !path || !owner()) return;
    let input: unknown;
    try {
      const stat = await fs.stat(path);
      if (!stat.isFile() || stat.size > 4096) throw new Error('size');
      input = JSON.parse(await fs.readFile(path, 'utf8')) as unknown;
    } catch {
      await dialog.showMessageBox(parent, {
        type: 'error',
        message: 'That setup file could not be read. Ask the admin for a new copy, then choose Set Up again.',
      });
      return;
    }
    const configured = service.configure(input);
    await dialog.showMessageBox(parent, {
      type: configured ? 'info' : 'error',
      message: configured
        ? 'This computer is set up. Reports are still off.'
        : 'That setup file does not work.',
      detail: configured
        ? 'Open Automatic Error Reports again and choose Turn On when you are ready. Keep the setup file private; delete it once you have stored its details safely.'
        : 'Ask the admin for a setup file for this computer.',
    });
  }
}
