import { BrowserWindow, type IpcMainInvokeEvent, type Rectangle, type WebContents } from 'electron';
import { z } from 'zod';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import type { EngineState } from '../../shared/engine/state';
import { IPC } from '../../shared/ipc';
import { type LowerThird, type StudioOpen, STUDIO_TITLE } from '../../shared/lower-thirds';
import { idSchema } from '../../shared/model-schema';
import { ownWindowKey } from '../access/access-list-window';
import { handle } from '../ipc/handle';
import { windowIcon } from '../windows/app-icon';
import { loadPage } from '../windows/renderer';
import { pageAlive, sendToPage } from '../windows/send';
import { secureWebPreferences } from '../windows/web-preferences';

/*
 * The Lower Thirds studio's window (Session 55, Part 16): a normal window of its own, opened from the Lower Thirds
 * panel (its Studio button, New… and Edit), brought forward when it is open and told which lower third to open. It
 * opens as large as 1280 × 800 on the controls' display (as large as the work area where that is smaller: CI's is
 * 1024 wide), in the appearance's own colours, and never takes over (never full screen, never kept on top). Its page
 * makes and changes lower thirds, and shows and hides them, through the lower thirds' own channels: never the
 * engine's commands, which only the operator window sends.
 *
 * Keys, as the Access List's window has them (access-list-window.ts): ⌘Z and ⌘⇧Z undo and redo the typing here,
 * ⌘1 and ⌘2 stop here, and ⌘W closes it on a Mac. Closing it while its page says it has changes not saved, the
 * window stays and its page asks first (then closes it); as Drashti quits, and in Simple Mode, it closes without
 * asking.
 */

/** The window's size and place: up to 1280 × 800, in the middle of the work area it opens in. */
export function studioBounds(area: Rectangle): Rectangle {
  const width = Math.min(1280, area.width);
  const height = Math.min(800, area.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}

export interface StudioDeps {
  /** The work area of the display the operator's controls are on. */
  workArea(): Rectangle;
  /** The appearance's window colour, to open on. */
  background(): string;
  /** One of Drashti's own windows: told of each change of appearance until it closes. */
  track(win: BrowserWindow): void;
  log(line: string): void;
}

export class LowerThirdsStudio {
  private win: BrowserWindow | null = null;
  /** Drashti is quitting: the page's question about changes not saved no longer holds the window open. */
  private goingAway = false;
  /** Its page has changes not saved (it says so as they come and go). */
  private dirty = false;
  /** Its page answered its question: close. */
  private mayClose = false;

  constructor(private readonly deps: StudioDeps) {}

  /** Open it on a lower third (or a new one, or as it was), or bring it forward and tell it which. */
  open(what: StudioOpen): void {
    const open = this.win;
    if (open && !open.isDestroyed()) {
      if (open.isMinimized()) open.restore();
      open.focus();
      if (what) sendToPage(open, IPC.lowerThirds.edit, what);
      return;
    }
    const win = new BrowserWindow({
      show: false,
      ...studioBounds(this.deps.workArea()),
      minWidth: 900,
      minHeight: 560,
      title: STUDIO_TITLE,
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
    // With changes not saved, closing waits for its page's question (as Drashti quits, it closes all the same).
    win.on('close', (event) => {
      if (this.goingAway || this.mayClose || !this.dirty) return;
      event.preventDefault();
      sendToPage(win, IPC.lowerThirds.askClose, null);
    });
    this.win = win;
    this.deps.track(win);
    this.deps.log('The Lower Thirds studio opens');
    win.once('ready-to-show', () => {
      win.show();
    });
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      this.dirty = false;
      this.mayClose = false;
      this.deps.log('The Lower Thirds studio closed');
    });
    const query: Record<string, string> =
      what === null ? {} : 'id' in what ? { open: what.id } : { open: 'new' };
    void loadPage(win, 'lower-thirds', query);
  }

  /** True for the studio's own page. */
  isPage(contents: WebContents | null): boolean {
    return contents !== null && pageAlive(this.win) && contents.id === this.win.webContents.id;
  }

  /** Tell its page the lower thirds as they are now. */
  send(list: LowerThird[]): void {
    sendToPage(this.win, IPC.lowerThirds.changed, list);
  }

  /** Its page says whether it has changes not saved. */
  setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  /** Its page answered its question: close it now. */
  closeAsked(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    this.mayClose = true;
    win.close();
  }

  /** Drashti is quitting (the operator said so): closing no longer waits for the page's question. */
  quitting(): void {
    this.goingAway = true;
  }

  /** Closed at once, without asking (Simple Mode, and quitting). */
  close(): void {
    const win = this.win;
    if (win && !win.isDestroyed()) win.destroy();
  }
}

const openSchema = z.union([
  z.null(),
  z.object({ id: idSchema }).strict(),
  z.object({ make: z.literal(true) }).strict(),
]);

/**
 * The studio's own channels: open it (the operator window), and show or hide a lower third as the library has it
 * (the operator window or the studio; Simple Mode refuses them: main/simple-mode.ts).
 */
export function handleStudio(o: {
  studio: LowerThirdsStudio;
  fromOperator: (e: IpcMainInvokeEvent) => boolean;
  get: (id: string) => LowerThird | null;
  engine: { readonly current: EngineState; dispatch(command: EngineCommand): CommandResult };
  log: (line: string) => void;
}): void {
  const notHere = {
    ok: false as const,
    message: 'Only the operator window and the Lower Thirds studio can do that.',
  };
  const mayShow = (e: IpcMainInvokeEvent) => o.fromOperator(e) || o.studio.isPage(e.sender);
  handle(IPC.lowerThirds.studio, (e, raw) => {
    if (!o.fromOperator(e)) return notHere;
    const what = openSchema.safeParse(raw ?? null);
    if (!what.success) return { ok: false as const, message: 'That lower third cannot be opened.' };
    o.studio.open(what.data);
    return { ok: true as const };
  });
  handle(IPC.lowerThirds.show, (e, raw) => {
    if (!mayShow(e)) return notHere;
    const id = idSchema.safeParse(raw);
    const lowerThird = id.success ? o.get(id.data) : null;
    if (!lowerThird) return { ok: false as const, message: 'That lower third no longer exists.' };
    const done = o.engine.dispatch({ type: 'showLowerThird', lowerThird });
    if (!done.ok) return { ok: false as const, message: done.message };
    o.log('Lower thirds: one shown from the studio or the panel');
    return { ok: true as const };
  });
  // The studio's own: whether it has changes not saved, and close once its question is answered.
  handle(IPC.lowerThirds.dirty, (e, raw) => {
    if (o.studio.isPage(e.sender)) o.studio.setDirty(raw === true);
    return null;
  });
  handle(IPC.lowerThirds.close, (e) => {
    if (o.studio.isPage(e.sender)) o.studio.closeAsked();
    return null;
  });
  handle(IPC.lowerThirds.hide, (e) => {
    if (!mayShow(e)) return notHere;
    if (o.engine.current.layers.lowerThird) {
      const done = o.engine.dispatch({ type: 'hideLowerThird' });
      if (!done.ok) return { ok: false as const, message: done.message };
    }
    return { ok: true as const };
  });
}
