import type { MenuItemConstructorOptions } from 'electron';
import { Menu } from 'electron';

export interface MenuActions {
  reloadOperator: () => void;
  /** Only when DRASHTI_DIAGNOSTICS=1: for the manual watchdog check. */
  diagnostics: { crashOperator: () => void; crashOutputs: () => void; runSelfTest: () => void } | null;
}

/** A small application menu: standard edit keys, reload, and optional diagnostics. */
export function installMenu(actions: MenuActions): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'editMenu' },
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
    { role: 'windowMenu' },
  ];
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
