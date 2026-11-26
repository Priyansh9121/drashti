import { KEYMAP, type OperatorAction, SHOW_F_KEYS } from './keymap';

/*
 * Every Drashti window's own keys, beyond the operator window's show keys (KEYMAP, keymap.ts): the manual's
 * "Every other window’s keys" (docs/manual/keys.md) is written from this list, and a unit test
 * (src/main/keys-manual.test.ts) checks the manual names each one as the computer writes it (`keyText`), in a column
 * for Windows, a Mac with Apple silicon and a Mac with Intel (alpha.24, the owner's "in drashti manual, log all
 * shortcuts for all apps … mac intel … mac silicon … windows"). Each window's handler stays where it is (the slide
 * editor's, the Access List's `ownWindowKey`, the menu's roles); the editor's buttons write their keys from here.
 *
 * Keys are written as KEYMAP writes them: "Mod+S" is Cmd+S on a Mac and Ctrl+S on Windows, "Alt" is Option on a Mac,
 * "Ctrl" is the Control key itself on both (a Mac's ⌃), and a modifier alone ("Shift", "Alt") is held while
 * dragging or with the arrows. `mac` and `windows` replace `keys` on that computer, and an empty list means it has
 * no key there. Apple silicon and Intel Macs take the same keys: only their F-row differs (the manual says how).
 */

/** The manual's sections for these keys, each a `###` heading in docs/manual/keys.md, in its order. */
export const KEY_WINDOWS = [
  'The operator window, in Pro Mode and Simple Mode',
  'Lists: the library, playlists, Media, audio and lower thirds',
  'Moving round any window: dialogs, menus, tabs and dividers',
  'LIVE’s time bar, and the audio’s',
  'Chat, Messages and the stage timers',
  'The slide editor',
  'Typing a slide’s words',
  'The words editor: New… and Words of …',
  'Start, end and markers, and Trim',
  'Edit Video…',
  'The picture editor and cropping',
  'Stage layouts',
  'Adjust the picture',
  'The Sabha flow and Picture in Picture…',
  'The Access List and the Lower Thirds studio',
  'The screens’ own questions',
  'The menu bar',
  'A keyboard on a phone or tablet',
] as const;
export type KeyWindow = (typeof KEY_WINDOWS)[number];

export interface WindowKey {
  window: KeyWindow;
  /** What it does: the manual's row says it in these words. */
  what: string;
  /** Its keys on both computers, as KEYMAP writes them. */
  keys: readonly string[];
  /** On a Mac instead ([] for none). */
  mac?: readonly string[];
  /** On Windows instead ([] for none). */
  windows?: readonly string[];
}

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

/**
 * An operator action's keys, from KEYMAP itself: the menu bar shows some of the operator window's keys (Audience,
 * Stage, Uncover the controls, Undo), and only the keymap names them (menu-keys.test.ts: no other file writes F12 or
 * Mod+1 and Mod+2), so they can never differ.
 */
const keymapKeys = (action: OperatorAction): readonly string[] =>
  KEYMAP.find((b) => b.action === action)?.keys ?? [];
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** The slide editor's own keys, as its window acts on them (editor/SlideEditor.tsx's keydown) and its buttons show. */
export const EDITOR_KEYS = {
  save: ['Mod+S', 'Mod+Enter'],
  find: ['Mod+F'],
  undo: ['Mod+Z'],
  redo: { mac: ['Mod+Shift+Z'], windows: ['Ctrl+Y', 'Mod+Shift+Z'] },
  outdent: ['Shift+Tab'],
  indent: ['Tab'],
} as const;

/** A key of the slide editor's, as it acts on this computer (EDITOR_KEYS' first is the one its button shows). */
export function editorKeys(name: keyof typeof EDITOR_KEYS, platform: string): readonly string[] {
  const keys = EDITOR_KEYS[name];
  return 'mac' in keys ? (platform === 'darwin' ? keys.mac : keys.windows) : keys;
}

const UNDO_REDO_TYPING = {
  keys: ['Mod+Z', 'Mod+Shift+Z'],
  windows: ['Mod+Z', 'Mod+Shift+Z', 'Ctrl+Y'],
} as const;

export const WINDOW_KEYS: readonly WindowKey[] = [
  // The operator window: its show keys are KEYMAP's; these are its own besides.
  {
    window: 'The operator window, in Pro Mode and Simple Mode',
    what: 'Put up a row by its number: type it, then Enter (Esc forgets it, Backspace takes a digit back)',
    keys: [...DIGITS, 'Enter', 'Escape', 'Backspace'],
  },
  {
    window: 'The operator window, in Pro Mode and Simple Mode',
    what: 'Switch to Simple Mode or Pro Mode, with the keyboard on the switch: Enter twice',
    keys: ['Enter'],
  },

  {
    window: 'Lists: the library, playlists, Media, audio and lower thirds',
    what: 'Choose every row',
    keys: ['Mod+A'],
  },
  {
    window: 'Lists: the library, playlists, Media, audio and lower thirds',
    what: 'Put the row up, or fold a presentation’s slides',
    keys: ['Enter'],
  },
  {
    window: 'Lists: the library, playlists, Media, audio and lower thirds',
    what: 'The row’s right-click menu',
    keys: ['Shift+F10', 'ContextMenu'],
    mac: ['Shift+F10'],
  },
  {
    window: 'Lists: the library, playlists, Media, audio and lower thirds',
    what: 'Renaming: keep the new name, or leave it as it was',
    keys: ['Enter', 'Escape'],
  },
  {
    window: 'Lists: the library, playlists, Media, audio and lower thirds',
    what: 'The library’s search: open the first found, or empty the box; then close the library',
    keys: ['Enter', 'Escape'],
  },
  {
    window: 'Lists: the library, playlists, Media, audio and lower thirds',
    what: 'Find in a playlist or in the audio: the next found, the one before, close it',
    keys: ['Enter', 'Shift+Enter', 'Escape'],
  },
  {
    window: 'Lists: the library, playlists, Media, audio and lower thirds',
    what: 'A video’s frames in Media: one back or on, the first, the last',
    keys: ['ArrowLeft', 'ArrowRight', 'Home', 'End'],
  },

  {
    window: 'Moving round any window: dialogs, menus, tabs and dividers',
    what: 'Move through the window, part by part, and back',
    keys: ['Tab', 'Shift+Tab'],
  },
  {
    window: 'Moving round any window: dialogs, menus, tabs and dividers',
    what: 'Press the button or switch the keyboard is on',
    keys: ['Enter'],
  },
  {
    window: 'Moving round any window: dialogs, menus, tabs and dividers',
    what: 'Close a dialog, a menu or a tooltip',
    keys: ['Escape'],
  },
  {
    window: 'Moving round any window: dialogs, menus, tabs and dividers',
    what: 'In an open menu: up and down, the first, the last, and choose',
    keys: ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Space'],
  },
  {
    window: 'Moving round any window: dialogs, menus, tabs and dividers',
    what: 'Tabs, and choices of one: the next, the one before, the first, the last',
    keys: [...ARROWS, 'Home', 'End'],
  },
  {
    window: 'Moving round any window: dialogs, menus, tabs and dividers',
    what: 'A divider between panels: move it (four times as far with Shift), to its ends, back to its size',
    keys: [...ARROWS, 'Shift', 'Home', 'End', 'Enter'],
  },

  { window: 'LIVE’s time bar, and the audio’s', what: 'Back 5 seconds', keys: ['ArrowLeft', 'ArrowDown'] },
  { window: 'LIVE’s time bar, and the audio’s', what: 'On 5 seconds', keys: ['ArrowRight', 'ArrowUp'] },
  { window: 'LIVE’s time bar, and the audio’s', what: 'Back or on 30 seconds', keys: ['PageDown', 'PageUp'] },
  { window: 'LIVE’s time bar, and the audio’s', what: 'To the start or the end', keys: ['Home', 'End'] },
  {
    window: 'LIVE’s time bar, and the audio’s',
    what: 'One frame back or on (a video, in Pro Mode)',
    keys: ['Alt+ArrowLeft', 'Alt+ArrowRight'],
  },
  { window: 'LIVE’s time bar, and the audio’s', what: 'Let go of a drag, moving nothing', keys: ['Escape'] },

  { window: 'Chat, Messages and the stage timers', what: 'Chat: send', keys: ['Enter'] },
  { window: 'Chat, Messages and the stage timers', what: 'Chat: a new line', keys: ['Shift+Enter'] },
  { window: 'Chat, Messages and the stage timers', what: 'Chat: leave the box', keys: ['Escape'] },
  {
    window: 'Chat, Messages and the stage timers',
    what: 'Messages: show the message typed',
    keys: ['Enter'],
  },
  {
    window: 'Chat, Messages and the stage timers',
    what: 'A stage timer’s time: keep it, or put it back',
    keys: ['Enter', 'Escape'],
  },

  {
    window: 'The slide editor',
    what: 'The show’s F-keys: Clear all to Clear ticker, Oops and the Wallpaper act on the screens',
    keys: SHOW_F_KEYS,
  },
  { window: 'The slide editor', what: 'Save', keys: EDITOR_KEYS.save },
  {
    window: 'The slide editor',
    what: 'Find (in Find: the next found, the one before)',
    keys: [...EDITOR_KEYS.find, 'Enter', 'Shift+Enter'],
  },
  {
    window: 'The slide editor',
    what: 'Zoom in, zoom out, the whole slide',
    keys: ['Mod+=', 'Mod+-', 'Mod+0'],
  },
  { window: 'The slide editor', what: 'Undo', keys: EDITOR_KEYS.undo },
  { window: 'The slide editor', what: 'Redo', keys: EDITOR_KEYS.redo.mac, windows: EDITOR_KEYS.redo.windows },
  {
    window: 'The slide editor',
    what: 'Close the editor (it asks first when something is not saved)',
    keys: ['Mod+W'],
  },
  {
    window: 'The slide editor',
    what: 'A step back: fold what is over the slide, close Find, stop typing, choose nothing, then close',
    keys: ['Escape'],
  },
  {
    window: 'The slide editor',
    what: 'Move the chosen thing a pixel; with Shift, ten',
    keys: [...ARROWS, 'Shift'],
  },
  {
    window: 'The slide editor',
    what: 'Choose the next thing, or the one before',
    keys: ['Tab', 'Shift+Tab'],
  },
  { window: 'The slide editor', what: 'Type in the chosen text box', keys: ['Enter'] },
  { window: 'The slide editor', what: 'Delete what is chosen', keys: ['Delete', 'Backspace'] },
  { window: 'The slide editor', what: 'Choose everything', keys: ['Mod+A'] },
  { window: 'The slide editor', what: 'Bold, italic, underline', keys: ['Mod+B', 'Mod+I', 'Mod+U'] },
  { window: 'The slide editor', what: 'Duplicate', keys: ['Mod+D'] },
  { window: 'The slide editor', what: 'Cut, copy, paste', keys: ['Mod+X', 'Mod+C', 'Mod+V'] },
  { window: 'The slide editor', what: 'Paste in the same place', keys: ['Mod+Shift+V'] },
  {
    window: 'The slide editor',
    what: 'The chosen thing’s right-click menu',
    keys: ['Shift+F10', 'ContextMenu'],
    mac: ['Shift+F10'],
  },
  { window: 'The slide editor', what: 'While dragging: place freely, without snapping', keys: ['Alt'] },
  {
    window: 'The slide editor',
    what: 'While dragging a corner or the turn handle: keep the proportions; turn in steps of 15 degrees',
    keys: ['Shift'],
  },

  {
    window: 'Typing a slide’s words',
    what: 'Undo or redo the typing',
    keys: ['Mod+Z', 'Mod+Shift+Z', 'Mod+Y'],
  },
  { window: 'Typing a slide’s words', what: 'A new line', keys: ['Enter', 'Shift+Enter'] },
  {
    window: 'Typing a slide’s words',
    what: 'A list’s line further in, or back out',
    keys: [...EDITOR_KEYS.indent, ...EDITOR_KEYS.outdent],
  },
  { window: 'Typing a slide’s words', what: 'Bold, italic, underline', keys: ['Mod+B', 'Mod+I', 'Mod+U'] },

  { window: 'The words editor: New… and Words of …', what: 'Save the words', keys: ['Mod+Enter'] },
  { window: 'The words editor: New… and Words of …', what: 'Close it (it asks first)', keys: ['Escape'] },

  {
    window: 'Start, end and markers, and Trim',
    what: 'The start, or the end, here (at the play head)',
    keys: ['I', 'O'],
  },
  {
    window: 'Start, end and markers, and Trim',
    what: 'The chosen handle a tenth of a second back or on; with Shift, a second',
    keys: [...ARROWS, 'Shift'],
  },
  {
    window: 'Start, end and markers, and Trim',
    what: 'The chosen handle to the start or the end',
    keys: ['Home', 'End'],
  },

  { window: 'Edit Video…', what: 'Go to the time typed', keys: ['Enter'] },
  { window: 'Edit Video…', what: 'Close it', keys: ['Escape'] },

  {
    window: 'The picture editor and cropping',
    what: 'Hold for before: the picture as it was, while held',
    keys: ['Space', 'Enter'],
  },
  {
    window: 'The picture editor and cropping',
    what: 'Move the crop box; with Shift, its right side or its bottom',
    keys: [...ARROWS, 'Shift'],
  },

  {
    window: 'Stage layouts',
    what: 'Move the chosen box a pixel; with Shift, ten',
    keys: [...ARROWS, 'Shift'],
  },
  {
    window: 'Stage layouts',
    what: 'Make the chosen box larger or smaller',
    keys: ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+ArrowUp', 'Alt+ArrowDown'],
  },
  { window: 'Stage layouts', what: 'Choose the next box, or the one before', keys: ['Tab', 'Shift+Tab'] },
  { window: 'Stage layouts', what: 'Choose no box', keys: ['Escape'] },
  { window: 'Stage layouts', what: 'Delete the chosen box', keys: ['Delete', 'Backspace'] },
  { window: 'Stage layouts', what: 'Undo', keys: ['Mod+Z'] },
  {
    window: 'Stage layouts',
    what: 'While dragging: no snapping; keep the proportions',
    keys: ['Alt', 'Shift'],
  },

  {
    window: 'Adjust the picture',
    what: 'Move the chosen corner a pixel; with Shift, ten',
    keys: [...ARROWS, 'Shift'],
  },
  { window: 'Adjust the picture', what: 'Keep the number typed', keys: ['Enter'] },
  { window: 'Adjust the picture', what: 'Undo, redo', keys: ['Mod+Z', 'Mod+Shift+Z'] },

  {
    window: 'The Sabha flow and Picture in Picture…',
    what: 'The Sabha flow’s zoom: keep the size typed, or put it back',
    keys: ['Enter', 'Escape'],
  },
  {
    window: 'The Sabha flow and Picture in Picture…',
    what: 'Picture in Picture…: the choices, with the arrows; close it',
    keys: [...ARROWS, 'Escape'],
  },

  {
    window: 'The Access List and the Lower Thirds studio',
    what: 'Undo or redo the typing',
    ...UNDO_REDO_TYPING,
  },
  {
    window: 'The Access List and the Lower Thirds studio',
    what: 'Close the window',
    keys: ['Mod+W'],
  },
  {
    window: 'The Access List and the Lower Thirds studio',
    what: 'The Access List: search it',
    keys: ['Mod+F'],
  },
  {
    window: 'The Access List and the Lower Thirds studio',
    what: 'The Access List’s rows: up, down, ten at a time, the first, the last',
    keys: ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'],
  },
  {
    window: 'The Access List and the Lower Thirds studio',
    what: 'The studio’s search: empty the box, or go down into what it found',
    keys: ['Escape', 'ArrowDown'],
  },

  {
    window: 'The screens’ own questions',
    what: 'Say yes: keep these screens, or turn that screen off',
    keys: ['Enter'],
  },
  {
    window: 'The screens’ own questions',
    what: 'Say no: go back, or leave that screen on',
    keys: ['Escape'],
  },

  { window: 'The menu bar', what: 'Edit › Undo', keys: keymapKeys('undo') },
  { window: 'The menu bar', what: 'Edit › Redo', keys: ['Mod+Shift+Z'], windows: ['Ctrl+Y'] },
  { window: 'The menu bar', what: 'Edit › Cut, Copy, Paste', keys: ['Mod+X', 'Mod+C', 'Mod+V'] },
  { window: 'The menu bar', what: 'Edit › Paste and Match Style', keys: [], mac: ['Mod+Alt+Shift+V'] },
  { window: 'The menu bar', what: 'Edit › Select All', keys: ['Mod+A'] },
  {
    window: 'The menu bar',
    what: 'View › Audience, View › Stage',
    keys: [...keymapKeys('toggleAudience'), ...keymapKeys('toggleStage')],
  },
  { window: 'The menu bar', what: 'View › Reload Operator Window', keys: ['Mod+R'] },
  { window: 'The menu bar', what: 'View › Full screen', keys: ['F11'], mac: ['Ctrl+Mod+F'] },
  { window: 'The menu bar', what: 'Window › Minimize', keys: ['Mod+M'] },
  {
    window: 'The menu bar',
    what: 'Window › Uncover the Controls (even when Drashti is not the active app)',
    keys: keymapKeys('uncoverControls'),
  },
  { window: 'The menu bar', what: 'Window › Close', keys: ['Ctrl+W'], mac: [] },
  {
    window: 'The menu bar',
    what: 'Drashti › Hide Drashti, Hide Others',
    keys: [],
    mac: ['Mod+H', 'Mod+Alt+H'],
  },
  { window: 'The menu bar', what: 'Quit Drashti (it asks first)', keys: ['Mod+Q'], windows: ['Alt+F4'] },
  { window: 'The menu bar', what: 'Show the menu bar', keys: [], windows: ['Alt'] },

  {
    window: 'A keyboard on a phone or tablet',
    what: 'Look closer: zoom in, zoom out, the whole picture',
    keys: ['=', '-', '0'],
  },
  {
    window: 'A keyboard on a phone or tablet',
    what: 'Look closer: the page before or after (zoomed in, the arrows move round)',
    keys: ['ArrowLeft', 'ArrowRight'],
  },
  { window: 'A keyboard on a phone or tablet', what: 'Look closer: close it', keys: ['Escape'] },
];

/** A window key's keys on this computer: its own `mac` or `windows`, else `keys`. */
export function keysOn(entry: WindowKey, platform: string): readonly string[] {
  return (platform === 'darwin' ? entry.mac : entry.windows) ?? entry.keys;
}
