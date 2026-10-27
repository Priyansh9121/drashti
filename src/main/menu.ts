import type { MenuItemConstructorOptions } from 'electron';
import { Menu } from 'electron';
import type { OperatorAction } from '../shared/keymap';
import { KEYMAP, toAccelerator } from '../shared/keymap';
import type { OperatorMode } from '../shared/mode';
import type { ScreenSwitch, ScreenSwitches } from '../shared/screen-switches';

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

/** View › Appearance (Sessions 39–40): Follow the computer and each appearance, as radio items, then the window. */
export interface AppearanceItems {
  choices: readonly { id: string; label: string }[];
  /** FOLLOW, or the chosen appearance's id. */
  chosen: string;
  choose: (id: string) => void;
  /** Appearance…: the Appearance window, where each is shown as a picture of the operator window. */
  open: () => void;
}

export interface MenuActions {
  /** Simple Mode leaves out backup and restore, and offers the way back to Pro Mode. */
  mode: OperatorMode;
  /** View > Switch to Simple Mode, or Switch to Pro Mode… (which asks for the word in the window). */
  switchMode: () => void;
  /** View > Set Up Screens…: the setup wizard (Pro Mode only). */
  setUpScreens: () => void;
  /** View > Window for Zoom… (Session 48): the stream's picture in a window Zoom can share (Pro Mode only). */
  zoomWindow: () => void;
  /**
   * View › Access List… (Session 54, E4): the owner's window onto the access list, Pro Mode's, on the owner's
   * computer only (null, or left out, everywhere else).
   */
  accessList?: (() => void) | null;
  reloadOperator: () => void;
  /** Edit > Undo: the operator page decides (typing in a field, or the last removal). */
  undo: { accelerator: string | null; run: () => void };
  /** Edit > Redo: typing in a field, or the slide editor's last undone step. */
  redo: { run: () => void };
  /** Turns off outputs covering the operator window (the keymap's uncoverControls). */
  uncoverControls: { accelerator: string | null; run: () => void };
  /** Help > Save diagnostics: one file on the Desktop to send after a problem. */
  saveDiagnostics: () => void;
  /** File > Import from a Link… (Session 25b, Pro Mode): YouTube or Dropbox. */
  importFromLink: () => void;
  /** File > Back Up Library… and Restore Library…. */
  backUpLibrary: () => void;
  restoreLibrary: () => void;
  /** File > Use This Computer as a Node…: asks, then restarts as a node (Pro Mode only). */
  useAsNode: () => void;
  /** File > Scheduled Backups… (Session 14). */
  scheduledBackups: () => void;
  /** File > Events Out… (Session 28). */
  eventsOut: () => void;
  /** File > Drop Folder… (Session 28). */
  dropFolder: () => void;
  /** Help > Check for Updates… (Session 14, Pro Mode only). */
  checkForUpdates: () => void;
  /** Help > Keyboard Shortcuts… (Session 25, Pro Mode only): the keys sheet. */
  keyboardShortcuts: () => void;
  /** Help > Guides… (Sessions 31–36, both modes): the guides inside Drashti. */
  guides: () => void;
  /** File > Run Ahead of Other Programs (Windows only, Pro Mode; Session 16): null elsewhere. */
  priority: PriorityItem | null;
  /**
   * View > Show Shastra, Templates and Kirtan Details (Session 26a, Pro Mode): ticked when
   * the operator window shows them (off to begin with).
   */
  extras: { shown: boolean; toggle: () => void };
  /** View › Show Safe Areas (Sessions 31–36): the slide editor's guides for where words are safe. */
  safeAreas: { shown: boolean; toggle: () => void };
  /** View › Appearance (Pro Mode only). */
  appearance: AppearanceItems;
  /**
   * View › Audience and View › Stage (Session 50, Pro Mode): ticked while on; choosing one turns it off (asking
   * first while its screens show something) or on. They show Mod+1 and Mod+2 (Session 51) without binding them:
   * those are the page's keys, so a press is acted on once, by the page, never by the menu too; under one of the
   * system's own boxes, on the Mac, by the menu, once (see shownKey). A choice within 0.7 s of the last goes by.
   */
  screenSwitches: { on: ScreenSwitches; toggle: (which: ScreenSwitch) => void };
  /** Only when DRASHTI_DIAGNOSTICS=1: for the manual watchdog check. */
  diagnostics: {
    crashOperator: () => void;
    crashOutputs: () => void;
    runSelfTest: () => void;
    openGallery: () => void;
  } | null;
}

/**
 * The keymap's key for an item that shows it and leaves it to the page (the keymap's shownInMenu: ⌘1 and ⌘2
 * beside View › Audience and Stage, Session 51). Electron hands a menu every key the page leaves alone (held, in
 * a field, under a dialog), and a page's key acts once, by the page. Windows' menu shows the key without binding
 * it (registerAccelerator: false), so it acts from the operator window only. The Mac's binds every key it shows:
 * the operator window takes every press of these keys first (useKeymap); Window for Zoom…, whose page has no keys,
 * stops them before its page and the menu see them (shown-keys.ts, its before-input-event); and under one of the
 * system's own boxes (a question, a file dialog) the menu still acts on them, as on a choice: once, since the main
 * process lets a choice of the same item within 0.7 s of the last go by (a held key repeating).
 */
function shownKey(action: OperatorAction): MenuItemConstructorOptions {
  const binding = KEYMAP.find((b) => b.action === action);
  const key = binding?.shownInMenu === true ? binding.keys[0] : undefined;
  return key ? { accelerator: toAccelerator(key), registerAccelerator: false } : {};
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
              { id: 'import-from-link', label: 'Import from a Link…', click: actions.importFromLink },
              { type: 'separator' },
              { id: 'backup-library', label: 'Back Up Library…', click: actions.backUpLibrary },
              { id: 'restore-library', label: 'Restore Library…', click: actions.restoreLibrary },
              { id: 'scheduled-backups', label: 'Scheduled Backups…', click: actions.scheduledBackups },
              { type: 'separator' },
              { id: 'drop-folder', label: 'Drop Folder…', click: actions.dropFolder },
              { id: 'events-out', label: 'Events Out…', click: actions.eventsOut },
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
              {
                id: 'zoom-window',
                label: 'Window for Zoom…',
                click: actions.zoomWindow,
              } as MenuItemConstructorOptions,
              { type: 'separator' } as MenuItemConstructorOptions,
              // This computer's audience screens (key and fill too) and its stage screens, off and on (Session 50),
              // showing their keys (Session 51).
              {
                id: 'screen-switch-audience',
                label: 'Audience',
                type: 'checkbox',
                checked: actions.screenSwitches.on.audience,
                ...shownKey('toggleAudience'),
                click: () => {
                  actions.screenSwitches.toggle('audience');
                },
              } as MenuItemConstructorOptions,
              {
                id: 'screen-switch-stage',
                label: 'Stage',
                type: 'checkbox',
                checked: actions.screenSwitches.on.stage,
                ...shownKey('toggleStage'),
                click: () => {
                  actions.screenSwitches.toggle('stage');
                },
              } as MenuItemConstructorOptions,
              { type: 'separator' } as MenuItemConstructorOptions,
              {
                id: 'show-extras',
                label: 'Show Shastra, Templates and Kirtan Details',
                type: 'checkbox',
                checked: actions.extras.shown,
                click: actions.extras.toggle,
              } as MenuItemConstructorOptions,
              {
                id: 'show-safe-areas',
                label: 'Show Safe Areas',
                type: 'checkbox',
                checked: actions.safeAreas.shown,
                click: actions.safeAreas.toggle,
              } as MenuItemConstructorOptions,
              { type: 'separator' } as MenuItemConstructorOptions,
              // Simple Mode shows the chosen appearance, with no switch (Sessions 39–40).
              {
                id: 'appearance',
                label: 'Appearance',
                submenu: [
                  ...actions.appearance.choices.map((c): MenuItemConstructorOptions => ({
                    id: `appearance-${c.id}`,
                    label: c.label,
                    type: 'radio',
                    checked: c.id === actions.appearance.chosen,
                    click: () => {
                      actions.appearance.choose(c.id);
                    },
                  })),
                  { type: 'separator' },
                  { id: 'appearance-window', label: 'Appearance…', click: actions.appearance.open },
                ],
              } as MenuItemConstructorOptions,
              ...(actions.accessList
                ? [
                    { type: 'separator' } as MenuItemConstructorOptions,
                    { id: 'access-list', label: 'Access List…', click: actions.accessList },
                  ]
                : []),
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
      // The guides inside Drashti, in both modes (Simple Mode is given the operator's and presenter's only).
      { id: 'guides', label: 'Guides…', click: actions.guides },
      { type: 'separator' },
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
        { label: 'Crash the Node’s Window (watchdog test)', click: d.crashWindow },
        { label: 'Crash the Output Windows (watchdog test)', click: d.crashOutputs },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
