import { BrowserWindow, type WebContents, type WebFrameMain } from 'electron';
import { ZOOM_WINDOW_TITLE, type ZoomProgram } from '../../shared/zoom';
import { IPC } from '../../shared/ipc';
import { windowIcon } from '../windows/app-icon';
import { loadPage } from '../windows/renderer';
import { pageAlive } from '../windows/send';
import { secureWebPreferences } from '../windows/web-preferences';
import { type Place, placeFor, readPlace, writePlace } from './zoom-place';

/*
 * The window for Zoom (Session 48): the stream's picture, exactly, in a normal window of its own titled
 * "Drashti for Zoom", for Zoom's Share Screen. It shows the Program's own frames (the page the stream
 * encodes, captured as the stream's page captures itself), so the camera opens once and Zoom and YouTube
 * see the same picture, live or not: while it is open it holds the Program open, as the preview does. Nothing
 * of Drashti's own is drawn over the picture, and it has no sound (Zoom's microphone is the mixer's input).
 *
 * It never takes over: never full screen, never kept on top, never maximised over a display. It keeps 16:9 as
 * it is resized, opens at 1280 × 720 on the controls' display, and remembers its size and place on this
 * computer. Closing it changes nothing else; it is never opened again by itself after a restart.
 */

export interface ZoomWindowDeps {
  /** The Program's page and size, once open and ready. */
  program(): { frame: WebFrameMain; width: number; height: number } | null;
  /** Keep the Program open while the window is (or let it go). */
  holdProgram(on: boolean): void;
  /** The displays' work areas now, and the one the operator's controls are on. */
  workAreas(): { all: Place[]; controls: Place };
  /** Where its size and place are kept (this computer's own folder). */
  placeFile: string;
  log(line: string): void;
}

export class ZoomWindow {
  private win: BrowserWindow | null = null;
  private seen = 0;

  constructor(private readonly deps: ZoomWindowDeps) {}

  /** Open it, or bring it forward when it is open. */
  open(): void {
    const open = this.win;
    if (open && !open.isDestroyed()) {
      if (open.isMinimized()) open.restore();
      open.focus();
      return;
    }
    const { all, controls } = this.deps.workAreas();
    const place = placeFor(readPlace(this.deps.placeFile), all, controls);
    const win = new BrowserWindow({
      show: false,
      ...place,
      useContentSize: true,
      minWidth: 320,
      minHeight: 180,
      title: ZOOM_WINDOW_TITLE,
      backgroundColor: '#000000',
      fullscreenable: false,
      maximizable: false,
      autoHideMenuBar: true,
      ...windowIcon(),
      webPreferences: {
        ...secureWebPreferences(),
        // Zoom shares it while it is behind other windows: its picture keeps moving.
        backgroundThrottling: false,
      },
    });
    win.setAspectRatio(16 / 9);
    win.setContentBounds(place);
    this.win = win;
    this.deps.holdProgram(true);
    this.deps.log('The window for Zoom opens');
    const keep = () => {
      if (!win.isDestroyed() && !win.isMinimized()) writePlace(this.deps.placeFile, win.getContentBounds());
    };
    win.on('resized', keep);
    win.on('moved', keep);
    win.on('close', keep);
    win.once('ready-to-show', () => {
      win.show();
    });
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      this.deps.holdProgram(false);
      this.deps.log('The window for Zoom closed');
    });
    void loadPage(win, 'zoom');
  }

  /** True for the window for Zoom's page. */
  isZoomPage(contents: WebContents | null): boolean {
    return contents !== null && pageAlive(this.win) && contents.id === this.win.webContents.id;
  }

  /** What its page's request for a screen's picture is given: the Program's own page, nothing else. */
  grantFor(frame: WebFrameMain | null): WebFrameMain | null {
    if (!frame || !pageAlive(this.win)) return null;
    const own = this.win.webContents.mainFrame;
    if (frame.processId !== own.processId || frame.routingId !== own.routingId) return null;
    return this.deps.program()?.frame ?? null;
  }

  /** The Program as the window's page captures it now, or null while it is not ready. */
  program(): ZoomProgram | null {
    const program = this.deps.program();
    if (!program) return null;
    return { width: program.width, height: program.height, at: this.seen };
  }

  /** The Program became ready, was resized or went: the window's page captures it afresh. */
  programChanged(): void {
    this.seen++;
    if (pageAlive(this.win)) this.win.webContents.send(IPC.zoom.programChanged, this.program());
  }

  close(): void {
    const win = this.win;
    this.win = null;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
