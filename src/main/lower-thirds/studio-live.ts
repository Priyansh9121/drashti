import type { ScreenRole } from '../../shared/screens';
import type { StudioLivePicture, StudioLiveSource } from '../../shared/studio-live';

/*
 * Live behind the Lower Thirds studio's preview (alpha.22, the owner: "the background while selecting the animation
 * should be the one thats live, meaning a video is live, or wallpaper"). While the studio shows Live, and only then,
 * a still of what the screens show now is taken about once a second, each only once the one before is done (or has
 * taken LIVE_TAKE_LIMIT_MS: it then counts as none), and sent to the studio; it stops the moment the studio shows
 * another backdrop or closes (Simple Mode and quitting close it), and pauses while the studio is minimized, so with
 * the studio closed or out of sight it costs nothing.
 *
 * The still is taken from a picture already drawn, as the Screens dashboard's pictures of this computer's outputs are
 * (index.ts, captureLocal): the window of the first audience screen showing on this computer, exactly as the hall
 * sees it. So no video is played a second time for it (the studio's page cannot play one at all: media-src 'none'),
 * and nothing on the screens changes. With no such screen here (none set up, a single display, or only nodes'
 * screens) there is no still, and the studio says "No live picture to show". (LIVE in the operator window was tried
 * as a second source and left out: it is only in the window while its column is scrolled to the top, and opening the
 * studio from the Lower Thirds section scrolls it away: CI Windows, 4 of 4.)
 */

/** How long after one still is sent the next is taken. */
export const LIVE_EVERY_MS = 1000;
/** The longest a still may take before it counts as none (a capture that never comes never stops Live). */
export const LIVE_TAKE_LIMIT_MS = 3000;
/** The widest a still is sent: the preview is at most about 900 points wide. */
export const LIVE_WIDTH = 960;
/** Its JPEG quality. */
const LIVE_QUALITY = 75;

export interface StudioLiveDeps {
  /** Take a still now: null when this computer has nothing to take it from. */
  take(): Promise<StudioLivePicture | null>;
  /** To the studio's page. */
  send(picture: StudioLivePicture | null): void;
  log(line: string): void;
  everyMs?: number;
}

export class StudioLive {
  /** The studio's page asks for Live. */
  private wanted = false;
  /** The studio's window is minimized. */
  private paused = false;
  /** Stills are being taken (wanted, and not paused). */
  private on = false;
  /** Changed at each start and stop: a still taken for an earlier round is never sent. */
  private round = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Stills asked for so far (tests: none once it stops). */
  taken = 0;

  constructor(private readonly deps: StudioLiveDeps) {}

  /** Whether stills are being taken now. */
  get watching(): boolean {
    return this.on;
  }

  /** The studio shows Live (true) or another backdrop (false). */
  watch(on: boolean): void {
    this.wanted = on;
    this.update();
  }

  /** The studio's window minimized (true) or back (false). */
  pause(paused: boolean): void {
    this.paused = paused;
    this.update();
  }

  /** The studio closed (or its page went): nothing wanted, nothing paused. */
  stop(): void {
    this.wanted = false;
    this.paused = false;
    this.update();
  }

  private update(): void {
    const on = this.wanted && !this.paused;
    if (on === this.on) return;
    this.on = on;
    this.round++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deps.log(
      on
        ? 'The Lower Thirds studio shows Live behind its preview: a still about once a second'
        : this.wanted
          ? 'The Lower Thirds studio is minimized: Live pauses, no stills taken'
          : 'The Lower Thirds studio no longer shows Live: no stills taken',
    );
    if (on) void this.next(this.round);
  }

  private async next(round: number): Promise<void> {
    this.taken++;
    let limit: ReturnType<typeof setTimeout> | undefined;
    let picture: StudioLivePicture | null;
    try {
      picture = await Promise.race([
        this.deps.take(),
        new Promise<null>((resolve) => {
          limit = setTimeout(() => {
            resolve(null);
          }, LIVE_TAKE_LIMIT_MS);
        }),
      ]);
    } catch {
      picture = null;
    } finally {
      clearTimeout(limit);
    }
    if (round !== this.round) return;
    this.deps.send(picture);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.next(round);
    }, this.deps.everyMs ?? LIVE_EVERY_MS);
  }
}

/**
 * The screen on this computer Live takes its still from: the first audience screen showing here, in Screens' order
 * (as LIVE draws the first screen's canvas); null with none ("No live picture to show").
 */
export function hallScreenOf(
  screens: readonly { id: string; groupId: string }[],
  roleOf: (groupId: string) => ScreenRole | null,
  showing: (screenId: string) => boolean,
): string | null {
  return screens.find((s) => roleOf(s.groupId) === 'audience' && showing(s.id))?.id ?? null;
}

/** The part of Electron's NativeImage a still needs. */
export interface CapturedImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width: number; quality: 'good' }): CapturedImage;
  toJPEG(quality: number): Buffer;
}

/** A still from a picture taken: a JPEG at most LIVE_WIDTH wide; an empty picture is none. */
export function livePictureOf(
  image: CapturedImage,
  source: StudioLiveSource,
  at: number,
): StudioLivePicture | null {
  if (image.isEmpty()) return null;
  const width = Math.min(LIVE_WIDTH, image.getSize().width);
  const jpeg = image.resize({ width, quality: 'good' }).toJPEG(LIVE_QUALITY);
  return { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, source, at };
}
