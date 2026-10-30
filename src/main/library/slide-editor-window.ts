import { BrowserWindow, type IpcMainInvokeEvent, type Rectangle, type WebContents } from 'electron';
import { type EventChannel, type EventContract, IPC } from '../../shared/ipc';
import { idSchema } from '../../shared/model-schema';
import {
  type CopiedElements,
  copiedElementsSchema,
  type EditSlidesOpen,
  SLIDE_EDITOR_TITLE,
} from '../../shared/slide-edit';
import { isShownMenuKey } from '../shown-keys';
import { handle } from '../ipc/handle';
import { windowIcon } from '../windows/app-icon';
import { loadPage } from '../windows/renderer';
import { pageAlive, sendToPage } from '../windows/send';
import { secureWebPreferences } from '../windows/web-preferences';

/*
 * The slide editor's window (Session 55, Part 17a). Until then Edit slides covered the operator window, and while it
 * was open the operator window let go of every key of the show (no Next, no Back, no Clear, no Black-out) until the
 * slides were saved or thrown away: a typo mended in the next verse held the show. In a window of its own the show
 * goes on in the operator window, one click away, while the edits wait.
 *
 * Edit slides (and Edit slides… in a menu) opens it on a presentation, at a slide, or brings it forward and tells it
 * which: its page asks first when it has changes to another presentation not saved. It opens as large as the work area
 * of the controls' display allows, up to 1600 × 1000 (CI's work area is 1024 wide), in the appearance's own colours,
 * never full screen and never kept on top. Its page reads and saves slides through the library's channels (main lets
 * the operator window and this page save them); a save there comes back to the operator window as one change for its
 * Undo.
 *
 * Keys: the page has its own (⌘Z and ⌘⇧Z undo and redo its changes, ⌘S saves, zoom, find); ⌘W closes it on a Mac, and
 * the keys the application menu shows for the operator window (⌘1, ⌘2) stop here. Closing it while its page says it
 * has changes not saved, the window stays and its page asks first (then closes it); as Drashti quits, and in Simple
 * Mode, it closes without asking.
 */

/** The window's size and place: as large as the work area allows, up to 1600 × 1000, in its middle. */
export function slideEditorBounds(area: Rectangle): Rectangle {
  const width = Math.min(1600, area.width);
  const height = Math.min(1000, area.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}

export interface SlideEditorDeps {
  /** The work area of the display the operator's controls are on. */
  workArea(): Rectangle;
  /** The appearance's window colour, to open on. */
  background(): string;
  /** One of Drashti's own windows: told of each change of appearance until it closes. */
  track(win: BrowserWindow): void;
  log(line: string): void;
}

export class SlideEditorWindow {
  private win: BrowserWindow | null = null;
  /** Drashti is quitting: the page's question about changes not saved no longer holds the window open. */
  private goingAway = false;
  /** Its page has changes not saved (it says so as they come and go). */
  private dirty = false;
  /** Its page answered its question: close. */
  private mayClose = false;

  constructor(private readonly deps: SlideEditorDeps) {}

  /** Open it on a presentation's slides, or bring it forward and tell it which. */
  open(what: EditSlidesOpen): void {
    const open = this.win;
    if (open && !open.isDestroyed()) {
      if (open.isMinimized()) open.restore();
      open.focus();
      sendToPage(open, IPC.slideEditor.edit, what);
      return;
    }
    const win = new BrowserWindow({
      show: false,
      ...slideEditorBounds(this.deps.workArea()),
      minWidth: 900,
      minHeight: 560,
      title: SLIDE_EDITOR_TITLE,
      backgroundColor: this.deps.background(),
      fullscreenable: false,
      autoHideMenuBar: true,
      ...windowIcon(),
      webPreferences: secureWebPreferences(),
    });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      // The menu's keys for the operator window's switches (⌘1, ⌘2) stop here; ⌘W closes the window on a Mac.
      if (isShownMenuKey(input, process.platform)) {
        event.preventDefault();
        return;
      }
      const mac = process.platform === 'darwin';
      if (mac && input.meta && !input.control && !input.alt && !input.shift && input.key.toLowerCase() === 'w') {
        event.preventDefault();
        win.close();
      }
    });
    // With changes not saved, closing waits for its page's question (as Drashti quits, it closes all the same).
    win.on('close', (event) => {
      if (this.goingAway || this.mayClose || !this.dirty) return;
      event.preventDefault();
      sendToPage(win, IPC.slideEditor.askClose, null);
    });
    this.win = win;
    this.deps.track(win);
    this.deps.log('The slide editor opens');
    win.once('ready-to-show', () => {
      win.show();
    });
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      this.dirty = false;
      this.mayClose = false;
      this.deps.log('The slide editor closed');
    });
    void loadPage(win, 'slide-editor', {
      presentation: what.presentationId,
      ...(what.slideId ? { slide: what.slideId } : {}),
    });
  }

  /** True for the editor's own page. */
  isPage(contents: WebContents | null): boolean {
    return contents !== null && pageAlive(this.win) && contents.id === this.win.webContents.id;
  }

  /** Its window, when it is open and has the keyboard (the application menu's Undo and Redo go to it then). */
  focused(): BrowserWindow | null {
    const win = this.win;
    return win && !win.isDestroyed() && win.isFocused() ? win : null;
  }

  /** Tell its page something, when it is open. */
  send<C extends EventChannel>(channel: C, payload: EventContract[C]): void {
    sendToPage(this.win, channel, payload);
  }

  /** Its page says whether it has changes not saved. */
  setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  /** Its page answered its question (or saved): close it now. */
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

/**
 * The editor's own channels: open it (the operator window), whether it has changes not saved, and close once its
 * question is answered (the editor's page).
 */
export function handleSlideEditor(o: {
  editor: SlideEditorWindow;
  fromOperator: (e: IpcMainInvokeEvent) => boolean;
  /** Whether a presentation is in the library (and so can be edited). */
  exists: (presentationId: string) => boolean;
}): void {
  handle(IPC.slideEditor.open, (e, presentationId, slideId) => {
    if (!o.fromOperator(e)) return { ok: false as const, message: 'Only the operator window can open the slide editor.' };
    const id = idSchema.safeParse(presentationId);
    const slide = idSchema.nullable().safeParse(slideId ?? null);
    if (!id.success || !slide.success || !o.exists(id.data))
      return { ok: false as const, message: 'That presentation is no longer in the library.' };
    o.editor.open({ presentationId: id.data, slideId: slide.data });
    return { ok: true as const };
  });
  handle(IPC.slideEditor.dirty, (e, raw) => {
    if (o.editor.isPage(e.sender)) o.editor.setDirty(raw === true);
    return null;
  });
  handle(IPC.slideEditor.close, (e) => {
    if (o.editor.isPage(e.sender)) o.editor.closeAsked();
    return null;
  });
  // What the editor copied, kept while Drashti runs: it pastes into the next presentation's slides, in a window made
  // for them (as it did between presentations when the editor was in the operator window).
  let copied: CopiedElements | null = null;
  handle(IPC.slideEditor.copy, (e, raw) => {
    if (!o.editor.isPage(e.sender)) return null;
    const parsed = copiedElementsSchema.safeParse(raw);
    if (parsed.success) copied = parsed.data;
    return null;
  });
  handle(IPC.slideEditor.copied, (e) => (o.editor.isPage(e.sender) ? copied : null));
}
