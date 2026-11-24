import type { Rectangle } from 'electron';
import type { ScreenRole } from '../../shared/screens';
import type { StudioLivePicture, StudioLiveSource } from '../../shared/studio-live';

/*
 * Live behind the Lower Thirds studio's preview (alpha.22, the owner: "the background while selecting the animation
 * should be the one thats live, meaning a video is live, or wallpaper"). While the studio shows Live, and only then,
 * a still of what the screens show now is taken about once a second, each only once the one before is done, and
 * sent to the studio; it stops the moment the studio shows another backdrop or closes (Simple Mode and quitting close
 * it), so with the studio closed it costs nothing.
 *
 * The still is taken from a picture already drawn, as the Screens dashboard's pictures of this computer's outputs are
 * (index.ts, captureLocal): the window of the first audience screen showing on this computer, exactly as the hall
 * sees it; with none here (none set up, or only on nodes), LIVE in the operator window, which draws the same scene.
 * So no video is played a second time for it (the studio's page cannot play one at all: media-src 'none'), and
 * nothing on the screens changes.
 */

/** How long after one still is sent the next is taken. */
export const LIVE_EVERY_MS = 1000;
/** The widest a still is sent: the preview is at most about 900 points wide. */
export const LIVE_WIDTH = 960;
/** Its JPEG quality. */
const LIVE_QUALITY = 75;

export interface StudioLiveDeps {
  /** Take a still now: null when this computer has nothing to take it from. */
  take(): Promise<StudioLivePicture | null>;
  /** To the studio's page. */
  send(picture: StudioLivePicture | null): void;
  /** Its stills stopped: let go of anything taking them held (the operator window kept drawing while covered). */
  release?(): void;
  log(line: string): void;
  everyMs?: number;
}

export class StudioLive {
  private on = false;
  /** Changed at each start and stop: a still taken for an earlier round is never sent. */
  private round = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Stills asked for so far (tests: none once it stops). */
  taken = 0;

  constructor(private readonly deps: StudioLiveDeps) {}

  get watching(): boolean {
    return this.on;
  }

  /** The studio shows Live (true) or another backdrop, or closed (false). */
  watch(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.round++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // release: not yet
    this.deps.log(
      on
        ? 'The Lower Thirds studio shows Live behind its preview: a still about once a second'
        : 'The Lower Thirds studio no longer shows Live: no stills taken',
    );
    if (on) void this.next(this.round);
  }

  private async next(round: number): Promise<void> {
    this.taken++;
    let picture: StudioLivePicture | null;
    try {
      picture = await this.deps.take();
    } catch {
      picture = null;
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
 * (as LIVE draws the first screen's canvas); null with none (Live then takes LIVE's picture in the operator window).
 */
export function hallScreenOf(
  screens: readonly { id: string; groupId: string }[],
  roleOf: (groupId: string) => ScreenRole | null,
  showing: (screenId: string) => boolean,
): string | null {
  return screens.find((s) => roleOf(s.groupId) === 'audience' && showing(s.id))?.id ?? null;
}

/**
 * Where LIVE's picture is in the operator window (`LIVE_RECT_SCRIPT` asks its page): the scene, inside LIVE's box (a
 * zoomed LIVE shows only part of it) and inside the window, in whole points; null when it is not there to see.
 */
export const LIVE_RECT_SCRIPT = `(() => {
  const box = document.querySelector('[data-testid="live-preview"]');
  const scene = box && box.querySelector('[data-testid="scene"]');
  if (!box || !scene) return null;
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
  return { box: r(box), scene: r(scene), view: { width: innerWidth, height: innerHeight } };
})()`;

const isRect = (v: unknown): v is { x: number; y: number; width: number; height: number } =>
  typeof v === 'object' &&
  v !== null &&
  ['x', 'y', 'width', 'height'].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

export function liveRectOf(seen: unknown): Rectangle | null {
  if (typeof seen !== 'object' || seen === null) return null;
  const { box, scene, view } = seen as Record<string, unknown>;
  if (!isRect(box) || !isRect(scene) || typeof view !== 'object' || view === null) return null;
  const { width: vw, height: vh } = view as Record<string, unknown>;
  if (typeof vw !== 'number' || typeof vh !== 'number') return null;
  const left = Math.ceil(Math.max(box.x, scene.x, 0));
  const top = Math.ceil(Math.max(box.y, scene.y, 0));
  const right = Math.floor(Math.min(box.x + box.width, scene.x + scene.width, vw));
  const bottom = Math.floor(Math.min(box.y + box.height, scene.y + scene.height, vh));
  return right - left >= 16 && bottom - top >= 9
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
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
