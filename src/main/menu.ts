import type { MenuItemConstructorOptions } from 'electron';
import { DECK_ANIMATIONS_LABEL } from './import/deck/deck-setting';
import { Menu } from 'electron';
import type { OperatorAction } from '../shared/keymap';
import { KEYMAP, toAccelerator } from '../shared/keymap';
import type { OperatorMode } from '../shared/mode';
import type { ScreenSwitch, ScreenSwitches } from '../shared/screen-switches';
import { SETUP_TOOLS, TOOLS_MENU, type ToolsMenuItem } from '../shared/setup-tools';
import { type LogPeriod, periodChoices } from '../shared/log-period';
import { CAPTION_TARGET_NAMES, CAPTION_TARGETS, type CaptionTarget } from '../shared/caption-translation';
import type { SpeechLanguage } from '../shared/speech';

/** File › Speaker’s Language's choices (alpha.22), in the Live captions dialog's order. */
const SPEAKER_LANGUAGES: readonly { id: SpeechLanguage | 'auto'; label: string }[] = [
  { id: 'auto', label: 'As Heard (Gujarati, Hindi, Sanskrit or English)' },
  { id: 'gu', label: 'Gujarati' },
  { id: 'hi', label: 'Hindi' },
  { id: 'sa', label: 'Sanskrit' },
  { id: 'en', label: 'English' },
];

const speakerLanguageItem = (s: NonNullable<MenuActions['speakerLanguage']>): MenuItemConstructorOptions => ({
  id: 'speaker-language',
  label: 'Speaker’s Language',
  submenu: SPEAKER_LANGUAGES.map(({ id, label }): MenuItemConstructorOptions => ({
    id: `speaker-language-${id}`,
    label,
    type: 'radio',
    checked: s.language === id,
    click: () => {
      s.choose(id);
    },
  })),
});

/**
 * File › Caption Language (alpha.24, QA24-CAPLANG-2): "Captions in", in the Live captions dialog's order; a
 * translation can be chosen only where it is offered on this computer (2f).
 */
const captionLanguageItem = (c: NonNullable<MenuActions['captionLanguage']>): MenuItemConstructorOptions => ({
  id: 'caption-language',
  label: 'Caption Language',
  submenu: CAPTION_TARGETS.map((id): MenuItemConstructorOptions => ({
    id: `caption-language-${id}`,
    label: CAPTION_TARGET_NAMES[id],
    type: 'radio',
    checked: c.target === id,
    enabled: id === 'same' || c.offered,
    click: () => {
      c.choose(id);
    },
  })),
});

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

/**
 * View › Appearance (Sessions 39–40): Follow the computer and each appearance, as radio items, then the window.
 * Session 60: each family's under its name (a heading that does nothing), in the window's order.
 */
export interface AppearanceItems {
  choices: readonly { id: string; label: string; family?: string }[];
  /** FOLLOW, or the chosen appearance's id. */
  chosen: string;
  choose: (id: string) => void;
  /** Appearance…: the Appearance window, where each is shown as a picture of the operator window. */
  open: () => void;
}

export interface MenuActions {
  /** Simple Mode leaves out backup and restore, and offers the way back to Pro Mode. */
  mode: OperatorMode;
  /** This computer's access is Simple Mode only (Session 55): Simple Mode offers no way back to Pro Mode. */
  simpleOnly?: boolean;
  /** View > Switch to Simple Mode, or Switch to Pro Mode: at once, nothing asked (Session 55, Part 18). */
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
  /**
   * Help › Save Diagnostics (alpha.21, logs (c)): one file on the Desktop to send after a problem, with the log of the
   * period chosen: Today, Yesterday, the last 7 days, or one earlier day kept.
   */
  saveDiagnostics: (period: LogPeriod) => void;
  /** The days the log keeps, newest first (Save Diagnostics › One Day lists the earlier ones); none when left out. */
  logDays?: () => readonly string[];
  /** Help › Report a Problem… (x49, both modes): tell the admin where a problem is and what it is. */
  reportProblem: () => void;
  /** Admin only: separate automatic-report consent, off by default. */
  automaticErrorReports?: (() => void) | null;
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
  /** File › Opening… (Session 55): the photos and lines Drashti opens with, and whether it does. */
  opening: () => void;
  /** File > Live Captions… (Session 55, Part 10; Pro Mode): left out where there is no such choice. */
  liveCaptions?: () => void;
  /**
   * File › Speaker’s Language (alpha.22, Pro Mode): the language live captions listen for, as heard or one
   * language, ticked as it is, chosen as the speakers change. Left out (or null) where there are no live captions.
   */
  speakerLanguage?: {
    language: SpeechLanguage | 'auto';
    choose: (language: SpeechLanguage | 'auto') => void;
  } | null;
  /**
   * File › Caption Language (alpha.24, QA24-CAPLANG-2, Pro Mode): "Captions in", the language the audience screens
   * and the stream show captions in (the speaker's own, or a translation), ticked as it is; a translation choice is
   * disabled while it cannot translate here (`offered`). Left out (or null) where there are no live captions.
   */
  captionLanguage?: {
    target: CaptionTarget;
    offered: boolean;
    choose: (target: CaptionTarget) => void;
  } | null;
  /**
   * Help › Caption and Translation Models… (alpha.22, cap-pack; Pro Mode only): the offline model packs on this
   * computer. Left out where there is no such choice.
   */
  modelPacks?: () => void;
  /** Help > Check for Updates… (Session 14, Pro Mode only). */
  checkForUpdates: () => void;
  /** Help > Keyboard Shortcuts… (Session 25, Pro Mode only): the keys sheet. */
  keyboardShortcuts: () => void;
  /** Help › Drashti Manual… (x37, Session 60; both modes): the manual, first under Help. */
  manual: () => void;
  /** Help > Guides… (Sessions 31–36, both modes): the guides inside Drashti. */
  guides: () => void;
  /**
   * Help › Show Help (alpha.24, helpmenu; both modes): the status bar's Help switch, ticked while it is on (help-menu.ts).
   * Left out (or null): no such item.
   */
  help?: { on: boolean; toggle: () => void } | null;
  /**
   * The Tools menu (Session 60, x36; the owner's "A, More tools + menu"; Pro Mode): Show a Window…, Add a Video Input…,
   * Picture in Picture… and QR code…, then the Lower Thirds studio, the MIDI controller and OSC, each opening its
   * window in the operator window. Left out (or null): no Tools menu.
   */
  tools?: ((item: ToolsMenuItem) => void) | null;
  /**
   * Edit › Simple Mode Features… (alpha.22, Pro Mode only; the owner's "in edit, saying that the features can be
   * brought to simple mode"): the window's on/off switch for each of Pro Mode's tools Simple Mode may have, up to
   * three. Left out (or null): no such item.
   */
  simpleFeatures?: (() => void) | null;
  /** File > Run Ahead of Other Programs (Windows only, Pro Mode; Session 16): null elsewhere. */
  priority: PriorityItem | null;
  /**
   * File > Decks With Their Animations on This Computer (Session 54, C review): ticked when a deck comes in with
   * its animations here; left out where there is no such choice.
   */
  deckAnimations?: { on: boolean; toggle: () => void } | null;
  /**
   * View > Show Books, Templates and Kirtan Details (Session 26a, Pro Mode; Shastra until alpha.15): ticked when
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
 * The Tools menu (Session 60, x36): the setup tools (shared/setup-tools.ts), then a line, then the Lower Thirds
 * studio, the MIDI controller and OSC, as their sections under LIVE have them. Each item's id is `tools-<its id>`.
 */
function toolsMenu(open: (item: ToolsMenuItem) => void): MenuItemConstructorOptions {
  return {
    id: 'tools',
    label: 'Tools',
    submenu: TOOLS_MENU.flatMap((tool, i): MenuItemConstructorOptions[] => [
      ...(i === SETUP_TOOLS.length ? [{ type: 'separator' } as const] : []),
      {
        id: `tools-${tool.id}`,
        label: tool.label,
        click: () => {
          open(tool.id);
        },
      },
    ]),
  };
}

/** A menu's words for a period: each word's first letter a capital, as menus write them. */
const menuWords = (label: string) => label.replace(/\b([a-z])/gu, (m) => m.toUpperCase());

/**
 * Help › Save Diagnostics (alpha.21, logs for 100+ installs (c), the owner's "Yes, that plan"): Today… (its id the one
 * Save Diagnostics… had, save-diagnostics), Yesterday…, The Last 7 Days…, and One Day with each earlier day the log
 * keeps, newest first. Each asks first about crash files, when any are kept, as Save Diagnostics… did.
 */
export function saveDiagnosticsMenu(
  save: (period: LogPeriod) => void,
  days: readonly string[],
  now: number = Date.now(),
): MenuItemConstructorOptions {
  const choices = periodChoices(days, now);
  const id = (p: LogPeriod) => (p === 'today' ? 'save-diagnostics' : `save-diagnostics-${p}`);
  const entry = (c: { period: LogPeriod; label: string }): MenuItemConstructorOptions => ({
    id: id(c.period),
    label: `${menuWords(c.label)}…`,
    click: () => {
      save(c.period);
    },
  });
  const earlier = choices.slice(3);
  return {
    id: 'save-diagnostics-menu',
    label: 'Save Diagnostics',
    submenu: [
      ...choices.slice(0, 3).map(entry),
      ...(earlier.length > 0
        ? [
            {
              id: 'save-diagnostics-day',
              label: 'One Day',
              submenu: earlier.map(entry),
            } as MenuItemConstructorOptions,
          ]
        : []),
    ],
  };
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
              ...(actions.liveCaptions
                ? [{ id: 'live-captions', label: 'Live Captions…', click: actions.liveCaptions }]
                : []),
              ...(actions.speakerLanguage ? [speakerLanguageItem(actions.speakerLanguage)] : []),
              ...(actions.captionLanguage ? [captionLanguageItem(actions.captionLanguage)] : []),
              ...(actions.deckAnimations
                ? [
                    {
                      id: 'deck-animations',
                      label: DECK_ANIMATIONS_LABEL,
                      type: 'checkbox',
                      checked: actions.deckAnimations.on,
                      click: actions.deckAnimations.toggle,
                    } as MenuItemConstructorOptions,
                  ]
                : []),
              { id: 'events-out', label: 'Events Out…', click: actions.eventsOut },
              { id: 'opening', label: 'Opening…', click: actions.opening },
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
        // Simple Mode Features… (alpha.22): Pro Mode's, which tools Simple Mode has; Simple Mode never changes it.
        ...(!simple && actions.simpleFeatures
          ? [
              { type: 'separator' } as MenuItemConstructorOptions,
              {
                id: 'simple-features',
                label: 'Simple Mode Features…',
                click: actions.simpleFeatures,
              } as MenuItemConstructorOptions,
            ]
          : []),
      ],
    },
    {
      label: 'View',
      submenu: [
        // With Simple access (Session 55), no way back to Pro Mode.
        ...(simple && actions.simpleOnly === true
          ? []
          : [
              {
                id: 'switch-mode',
                // Nothing asked either way since Session 55, Part 18: no "…".
                label: simple ? 'Switch to Pro Mode' : 'Switch to Simple Mode',
                click: actions.switchMode,
              } as MenuItemConstructorOptions,
            ]),
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
                label: 'Show Books, Templates and Kirtan Details',
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
                  ...actions.appearance.choices.flatMap((c, i, all): MenuItemConstructorOptions[] => [
                    // A family's name before its first one (Session 60): a heading, never chosen.
                    ...(c.family !== undefined && c.family !== all[i - 1]?.family
                      ? [
                          { type: 'separator' } as MenuItemConstructorOptions,
                          { id: `appearance-family-${String(i)}`, label: c.family, enabled: false },
                        ]
                      : []),
                    {
                      id: `appearance-${c.id}`,
                      label: c.label,
                      type: 'radio',
                      checked: c.id === actions.appearance.chosen,
                      click: () => {
                        actions.appearance.choose(c.id);
                      },
                    },
                  ]),
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
    // Tools (Session 60, x36), between View and Window on the Mac and on Windows; Pro Mode's, as its tools are.
    ...(simple || !actions.tools ? [] : [toolsMenu(actions.tools)]),
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
      // The Drashti Manual (x37, Session 60; the owner's "A, new Manual"): first, in both modes.
      { id: 'manual', label: 'Drashti Manual…', click: actions.manual },
      // The guides inside Drashti, in both modes (Simple Mode is given the operator's and presenter's only).
      { id: 'guides', label: 'Guides…', click: actions.guides },
      // The status bar's Help switch (alpha.24, helpmenu), ticked while it is on; no key of its own, as the switch.
      ...(actions.help
        ? [
            {
              id: 'help-switch',
              label: 'Show Help',
              type: 'checkbox',
              checked: actions.help.on,
              click: actions.help.toggle,
            } as MenuItemConstructorOptions,
          ]
        : []),
      { type: 'separator' },
      // The keys sheet, in both modes since alpha.24 (a25 item 3: Simple Mode's lists the keys that act there). No
      // accelerator: ? is the page's key, and a menu's would get round the guards for fields and dialogs.
      { id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts…', click: actions.keyboardShortcuts },
      { type: 'separator' },
      // Help › Report a Problem… (x49, the owner's Q60-38): in both modes, just above Save Diagnostics….
      { id: 'report-problem', label: 'Report a Problem…', click: actions.reportProblem },
      // Help › Automatic Error Reports… (alpha.21): the access-list owner's alone, on this computer.
      ...(actions.automaticErrorReports
        ? [
            {
              id: 'automatic-error-reports',
              label: 'Automatic Error Reports…',
              click: actions.automaticErrorReports,
            } as MenuItemConstructorOptions,
          ]
        : []),
      saveDiagnosticsMenu(actions.saveDiagnostics, actions.logDays?.() ?? []),
      // Simple Mode never sees updates.
      ...(simple
        ? []
        : [
            { type: 'separator' } as MenuItemConstructorOptions,
            // The offline caption and translation models (alpha.22): an admin's, beside the updates.
            ...(actions.modelPacks
              ? [
                  {
                    id: 'model-packs',
                    label: 'Caption and Translation Models…',
                    click: actions.modelPacks,
                  } as MenuItemConstructorOptions,
                ]
              : []),
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
  /** Help › Save Diagnostics: one file on the Desktop, as on Main (without the library), of the period chosen. */
  saveDiagnostics: (period: LogPeriod) => void;
  /** The days the log keeps, newest first. */
  logDays?: () => readonly string[];
  /** Help › Report a Problem… (x49): handed to the Main the node follows. */
  reportProblem: () => void;
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
      submenu: [
        { id: 'report-problem', label: 'Report a Problem…', click: actions.reportProblem },
        saveDiagnosticsMenu(actions.saveDiagnostics, actions.logDays?.() ?? []),
      ],
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

/**
 * The menu while this computer is not let in, or after Drashti has stopped (Session 54, access by Gmail): Quit, and
 * the editing keys the lock screen's fields need. Nothing else: no show, no library, no window of tools, no devtools.
 */
export function installLockedMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: 'appMenu' } as MenuItemConstructorOptions]
      : [{ label: 'File', submenu: [{ role: 'quit' }] } as MenuItemConstructorOptions]),
    { role: 'editMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
