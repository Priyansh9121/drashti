import type { MenuItemConstructorOptions } from 'electron';
import { Menu } from 'electron';

export interface MenuActions {
  reloadOperator: () => void;
  /** Edit > Undo: the operator page decides (typing in a field, or the last removal). */
  undo: { accelerator: string | null; run: () => void };
  /** Turns off outputs covering the operator window (the keymap's uncoverControls). */
  uncoverControls: { accelerator: string | null; run: () => void };
  /** Help > Save diagnostics: one file on the Desktop to send after a problem. */
  saveDiagnostics: () => void;
  /** File > Back Up Library… and Restore Library…. */
  backUpLibrary: () => void;
  restoreLibrary: () => void;
  /** Only when DRASHTI_DIAGNOSTICS=1: for the manual watchdog check. */
  diagnostics: { crashOperator: () => void; crashOutputs: () => void; runSelfTest: () => void } | null;
}

/** A small application menu: backups, standard edit keys, reload, and optional diagnostics. */
export function installMenu(actions: MenuActions): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { id: 'backup-library', label: 'Back Up Library…', click: actions.backUpLibrary },
        { id: 'restore-library', label: 'Restore Library…', click: actions.restoreLibrary },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          id: 'undo',
          label: 'Undo',
          ...(actions.undo.accelerator ? { accelerator: actions.undo.accelerator } : {}),
          click: actions.undo.run,
        },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' } as const] : []),
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Operator Window',
          accelerator: 'CmdOrCtrl+R',
          click: actions.reloadOperator,
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        {
          id: 'uncover-controls',
          label: 'Uncover the Controls',
          ...(actions.uncoverControls.accelerator
            ? { accelerator: actions.uncoverControls.accelerator }
            : {}),
          click: actions.uncoverControls.run,
        },
        ...(isMac
          ? [{ type: 'separator' } as const, { role: 'front' } as const]
          : [{ role: 'close' } as const]),
      ],
    },
  ];
  template.push({
    role: 'help',
    submenu: [{ id: 'save-diagnostics', label: 'Save Diagnostics…', click: actions.saveDiagnostics }],
  });
  if (actions.diagnostics) {
    const d = actions.diagnostics;
    template.push({
      label: 'Diagnostics',
      submenu: [
        { label: 'Run Watchdog Self-Test', click: d.runSelfTest },
        { type: 'separator' },
        { label: 'Crash the Operator Window (watchdog test)', click: d.crashOperator },
        { label: 'Crash the Output Windows (watchdog test)', click: d.crashOutputs },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
