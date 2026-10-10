import type { MenuItemConstructorOptions } from 'electron';
import { Menu } from 'electron';
import type { OperatorMode } from '../shared/mode';

/** The main process's priority on Windows (Session 16): ticked is above normal, the default. */
export interface PriorityItem {
  ahead: boolean;
  toggle: () => void;
}

const priorityItem = (p: PriorityItem): MenuItemConstructorOptions => ({
  id: 'run-ahead',
  label: 'Run Ahead of Other Programs',
  type: 'checkbox',
  checked: p.ahead,
  click: p.toggle,
});

export interface MenuActions {
  /** Simple Mode leaves out backup and restore, and offers the way back to Pro Mode. */
  mode: OperatorMode;
  /** View > Switch to Simple Mode, or Switch to Pro Mode… (which asks for the word in the window). */
  switchMode: () => void;
  /** View > Set Up Screens…: the setup wizard (Pro Mode only). */
  setUpScreens: () => void;
  reloadOperator: () => void;
  /** Edit > Undo: the operator page decides (typing in a field, or the last removal). */
  undo: { accelerator: string | null; run: () => void };
  /** Edit > Redo: typing in a field, or the slide editor's last undone step. */
  redo: { run: () => void };
  /** Turns off outputs covering the operator window (the keymap's uncoverControls). */
  uncoverControls: { accelerator: string | null; run: () => void };
  /** Help > Save diagnostics: one file on the Desktop to send after a problem. */
  saveDiagnostics: () => void;
  /** File > Back Up Library… and Restore Library…. */
  backUpLibrary: () => void;
  restoreLibrary: () => void;
  /** File > Use This Computer as a Node…: asks, then restarts as a node (Pro Mode only). */
  useAsNode: () => void;
  /** File > Roles and PINs… (Session 14): the admin PIN and the operator PIN (Pro Mode only). */
  rolesAndPins: () => void;
  /** File > Scheduled Backups… (Session 14). */
  scheduledBackups: () => void;
  /** Help > Check for Updates… (Session 14, Pro Mode only). */
  checkForUpdates: () => void;
  /** Help > Keyboard Shortcuts… (Session 25, Pro Mode only): the keys sheet. */
  keyboardShortcuts: () => void;
  /** File > Run Ahead of Other Programs (Windows only, Pro Mode, admin; Session 16): null elsewhere. */
  priority: PriorityItem | null;
  /** Only when DRASHTI_DIAGNOSTICS=1: for the manual watchdog check. */
  diagnostics: {
    crashOperator: () => void;
    crashOutputs: () => void;
    runSelfTest: () => void;
    openGallery: () => void;
  } | null;
}

/**
 * A small application menu: backups, standard edit keys, reload, the mode,
 * and optional diagnostics. Built again when the mode changes.
 */
export function installMenu(actions: MenuActions): void {
  const isMac = process.platform === 'darwin';
  const simple = actions.mode === 'simple';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    // Simple Mode cannot back up or restore the library.
    ...(simple
      ? []
      : [
          {
            label: 'File',
            submenu: [
              { id: 'backup-library', label: 'Back Up Library…', click: actions.backUpLibrary },
              { id: 'restore-library', label: 'Restore Library…', click: actions.restoreLibrary },
              { id: 'scheduled-backups', label: 'Scheduled Backups…', click: actions.scheduledBackups },
              { type: 'separator' },
              { id: 'roles-and-pins', label: 'Roles and PINs…', click: actions.rolesAndPins },
              { type: 'separator' },
              { id: 'use-as-node', label: 'Use This Computer as a Node…', click: actions.useAsNode },
              ...(actions.priority
                ? [{ type: 'separator' } as MenuItemConstructorOptions, priorityItem(actions.priority)]
                : []),
            ],
          } as MenuItemConstructorOptions,
        ]),
    {
      label: 'Edit',
      submenu: [
        {
          id: 'undo',
          label: 'Undo',
          ...(actions.undo.accelerator ? { accelerator: actions.undo.accelerator } : {}),
          click: actions.undo.run,
        },
        {
          id: 'redo',
          label: 'Redo',
          // The keys the standard Redo item has on each system.
          accelerator: isMac ? 'Shift+Command+Z' : 'Ctrl+Y',
          click: actions.redo.run,
        },
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
          id: 'switch-mode',
          label: simple ? 'Switch to Pro Mode…' : 'Switch to Simple Mode',
          click: actions.switchMode,
        },
        // Simple Mode never shows the setup wizard.
        ...(simple
          ? []
          : [
              {
                id: 'set-up-screens',
                label: 'Set Up Screens…',
                click: actions.setUpScreens,
              } as MenuItemConstructorOptions,
            ]),
        { type: 'separator' },
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
    submenu: [
      // The keys sheet, Pro Mode's (Simple Mode keeps its key line). No accelerator: ? is the page's key,
      // and a menu's would get round the guards for fields and dialogs.
      ...(simple
        ? []
        : [
            {
              id: 'keyboard-shortcuts',
              label: 'Keyboard Shortcuts…',
              click: actions.keyboardShortcuts,
            } as MenuItemConstructorOptions,
            { type: 'separator' } as MenuItemConstructorOptions,
          ]),
      { id: 'save-diagnostics', label: 'Save Diagnostics…', click: actions.saveDiagnostics },
      // Simple Mode never sees updates.
      ...(simple
        ? []
        : [
            { type: 'separator' } as MenuItemConstructorOptions,
            { id: 'check-for-updates', label: 'Check for Updates…', click: actions.checkForUpdates },
          ]),
    ],
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
        { id: 'component-gallery', label: 'Component Gallery', click: d.openGallery },
        { role: 'toggleDevTools' },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** What a node's menu does (Session 17 added Help and, with DRASHTI_DIAGNOSTICS=1, Diagnostics). */
export interface NodeMenuActions {
  /** File > Run Ahead of Other Programs (Windows only; Session 16): null elsewhere. */
  priority: PriorityItem | null;
  /** Help > Save Diagnostics…: one file on the Desktop, as on Main (without the library). */
  saveDiagnostics: () => void;
  /** Only when DRASHTI_DIAGNOSTICS=1: the node's watchdog self-test and the manual crash buttons. */
  diagnostics: {
    runSelfTest: () => void;
    crashWindow: () => void;
    crashOutputs: () => void;
  } | null;
}

/**
 * A node's menu (Session 13): no show, no library; editing keys for its fields, and its window; on
 * Windows how high Drashti runs (Session 16); Save Diagnostics, and the watchdog self-test with
 * diagnostics on (Session 17).
 */
export function installNodeMenu(actions: NodeMenuActions): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    ...(actions.priority
      ? [{ label: 'File', submenu: [priorityItem(actions.priority)] } as MenuItemConstructorOptions]
      : []),
    { role: 'editMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ id: 'save-diagnostics', label: 'Save Diagnostics…', click: actions.saveDiagnostics }],
    },
  ];
  if (actions.diagnostics) {
    const d = actions.diagnostics;
    template.push({
      label: 'Diagnostics',
      submenu: [
        { id: 'run-watchdog-self-test', label: 'Run Watchdog Self-Test', click: d.runSelfTest },
        { type: 'separator' },
        { label: "Crash the Node's Window (watchdog test)", click: d.crashWindow },
        { label: 'Crash the Output Windows (watchdog test)', click: d.crashOutputs },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
