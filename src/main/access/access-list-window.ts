import { BrowserWindow, type Input, type Rectangle, type WebContents } from 'electron';
import { ACCESS_LIST_TITLE, type AccessListView } from '../../shared/access-list';
import { IPC } from '../../shared/ipc';
import { isShownMenuKey } from '../shown-keys';
import { windowIcon } from '../windows/app-icon';
import { loadPage } from '../windows/renderer';
import { pageAlive, sendToPage } from '../windows/send';
import { secureWebPreferences } from '../windows/web-preferences';

/*
 * The Access List's window (Session 54, E4): a normal window of its own, on the owner's computer only, opened
 * from View › Access List… and brought forward when it is open. It opens as large as 1280 × 800 on the
 * controls' display (as large as the display's work area where that is smaller: CI's is 1024 wide), in the
 * appearance's own colours, and never takes over (never full screen, never kept on top).
 *
 * Keys: the application menu acts on the keys it binds wherever the focus is, and its Undo and Redo act on the
 * operator window (a removal undone there). Here they undo and redo the typing in this window instead, and
 * nothing else; ⌘1 and ⌘2 (View › Audience and Stage, Session 51) stop here, as in the window for Zoom; and on
 * a Mac, ⌘W closes it (Windows' Window › Close does already).
 */

/** What a key does in this window, of those the application menu would otherwise take: or null. */
export type OwnKey = 'undo' | 'redo' | 'close' | 'stop';

export function ownWindowKey(
  input: Pick<Input, 'type' | 'key' | 'meta' | 'control' | 'alt' | 'shift'>,
  platform: string,
): OwnKey | null {
  if (input.type !== 'keyDown') return null;
  if (isShownMenuKey(input, platform)) return 'stop';
  const mac = platform === 'darwin';
  const mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (!mod || input.alt) return null;
  const key = input.key.toLowerCase();
  if (key === 'z') return input.shift ? 'redo' : 'undo';
  if (key === 'y' && !mac && !input.shift) return 'redo';
  if (key === 'w' && mac && !input.shift) return 'close';
  return null;
}

/** The window's size and place: up to 1280 × 800, in the middle of the work area it opens in. */
export function accessListBounds(area: Rectangle): Rectangle {
  const width = Math.min(1280, area.width);
  const height = Math.min(800, area.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}

export interface AccessListWindowDeps {
  /** The work area of the display the operator's controls are on. */
  workArea(): Rectangle;
  /** The appearance's window colour, to open on. */
  background(): string;
  /** One of Drashti's own windows: told of each change of appearance until it closes. */
  track(win: BrowserWindow): void;
  /** It opened (the list is asked), or closed (asked no more). */
  opened(): void;
  closed(): void;
  log(line: string): void;
}

export class AccessListWindow {
  private win: BrowserWindow | null = null;

  constructor(private readonly deps: AccessListWindowDeps) {}

  /** Open it, or bring it forward when it is open. */
  open(): void {
    const open = this.win;
    if (open && !open.isDestroyed()) {
      if (open.isMinimized()) open.restore();
      open.focus();
      return;
    }
    const win = new BrowserWindow({
      show: false,
      ...accessListBounds(this.deps.workArea()),
      minWidth: 640,
      minHeight: 420,
      title: ACCESS_LIST_TITLE,
      backgroundColor: this.deps.background(),
      fullscreenable: false,
      autoHideMenuBar: true,
      ...windowIcon(),
      webPreferences: secureWebPreferences(),
    });
    win.webContents.on('before-input-event', (event, input) => {
      const own = ownWindowKey(input, process.platform);
      if (own === null) return;
      event.preventDefault();
      if (own === 'undo') win.webContents.undo();
      else if (own === 'redo') win.webContents.redo();
      else if (own === 'close') win.close();
    });
    this.win = win;
    this.deps.track(win);
    this.deps.log('The Access List opens');
    win.once('ready-to-show', () => {
      win.show();
    });
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      this.deps.closed();
      this.deps.log('The Access List closed');
    });
    this.deps.opened();
    void loadPage(win, 'access-list');
  }

  /** True for the Access List's own page: the only page its channels answer. */
  isPage(contents: WebContents | null): boolean {
    return contents !== null && pageAlive(this.win) && contents.id === this.win.webContents.id;
  }

  /** Tell its page the list as it is now. */
  send(view: AccessListView): void {
    sendToPage(this.win, IPC.accessList.changed, view);
  }

  /** The window as the main process holds it, for a save dialog to belong to. */
  window(): BrowserWindow | null {
    return pageAlive(this.win) ? this.win : null;
  }

  close(): void {
    const win = this.win;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
