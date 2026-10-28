import { z } from 'zod';
import { describeDisplay } from '../../shared/display-match';
import type { PendingScreens } from '../../shared/keep-screens';
import { idSchema } from '../../shared/model-schema';
import type { DeviceAnswer } from '../../shared/network-api';
import {
  bothSwitches,
  CAMERA_AT_COMPUTER,
  CAMERAS_NOT_LISTED,
  NOT_A_LISTED_CAMERA,
  type RemoteInputs,
  type RemoteScreens,
  type RemoteWindows,
  SCREEN_RECORDING_AT_COMPUTER,
  SWITCH_ASKS_FIRST,
} from '../../shared/network-desktop';
import type { LiveWindowResult, WindowList } from '../../shared/live-window';
import {
  type CameraAccess,
  VIDEO_INPUT_DEVICE_MAX,
  VIDEO_INPUT_NAME_MAX,
  type VideoInputResult,
  type VideoInputsView,
} from '../../shared/video-inputs';
import {
  SCREEN_SWITCHES,
  type ScreenSwitch,
  type ScreenSwitches,
  type ScreenSwitchResult,
  switchFor,
  SWITCH_NAMES,
} from '../../shared/screen-switches';
import type { CoverOptions, ScreensResult, ScreensSnapshot } from '../../shared/screens';
import { GROUP_ROLES, SCALING_MODES } from '../../shared/screens';
import { canvasSizeSchema, displayIdSchema, nameSchema } from '../../shared/screens-schema';
import { ONLY_ON_IN_SIMPLE_MODE } from '../outputs/screen-switches';
import type { NewFromWordsResult } from '../../shared/library';
import type { PlaylistResult } from '../../shared/playlists';
import type { PlaylistChanges } from '../playlists/playlist-ipc';
import { DesktopConsent, type ConsentQuestion } from './desktop-consent';
import { RateLimiter } from './limits';

/*
 * What the main process answers a Remote that sets up the Drashti computer's own things (Session 54, the phone as
 * a full Drashti; docs/api.md): its screens as Screens sets them up (groups, displays, each screen), Keep these
 * screens? answered from the phone with its countdown, and Audience and Stage, turning one off asking first as the
 * window does. Each request has passed the device's kind, the lock and Simple Mode's refusals (network-service.ts)
 * before it comes here; each is checked again here, by the same services the window's requests go through
 * (index.ts gives the very functions its own handlers call), so a phone does nothing the window could not.
 *
 * A phone never agrees to cover the controls: what it sends is never the operator's consent (the window's
 * coverOperator), and an output it would put on the display the controls are on is asked of the computer itself
 * (desktop-consent.ts). Changes from one phone are limited (a screen change opens and closes windows).
 */

/** The computer's screens, as the window's own requests change them (index.ts). */
export interface DesktopScreens {
  snapshot(): ScreensSnapshot;
  /** The display the operator window is on: an output there covers the controls (null: none can). */
  controlsDisplayId(): number | null;
  createGroup(name: unknown): ScreensResult;
  renameGroup(id: unknown, name: unknown): ScreensResult;
  setGroupRole(id: unknown, role: unknown): ScreensResult;
  deleteGroup(id: unknown): ScreensResult;
  /** `options` only ever from the computer's own yes (desktop-consent.ts), never from what a phone sent. */
  assignDisplay(groupId: unknown, displayId: unknown, options?: CoverOptions): ScreensResult;
  updateScreen(id: unknown, patch: unknown, options?: CoverOptions): ScreensResult;
  removeScreen(id: unknown): ScreensResult;
  /** Each output shows its name for a few seconds. */
  identify(): void;
  /** Keep these screens?: the change waiting, keeping it, and going back. */
  pending(): PendingScreens | null;
  keep(): ScreensResult;
  goBack(): ScreensResult;
}

/** Audience and Stage, as the window turns them (outputs/screen-switches.ts). */
export interface DesktopSwitches {
  get(): ScreenSwitches;
  /** Turning it off asks first now: its screens are open and show something. */
  asksFirst(which: ScreenSwitch): boolean;
  turn(which: ScreenSwitch, on: boolean): ScreenSwitchResult;
}

/** The computer's video inputs, as Media's Video inputs and Add a Video Input… change them (video-inputs-service.ts). */
export interface DesktopInputs {
  view(): VideoInputsView;
  access(): CameraAccess;
  /** The cameras the operator window last saw, by name; null before it has said. */
  cameras(): string[] | null;
  add(fields: unknown): VideoInputResult;
  update(id: unknown, fields: unknown): VideoInputResult;
  remove(id: unknown): VideoInputResult;
}

/** Show a Window… (live-window-service.ts): the other apps' windows, and one of those just listed put up. */
export interface DesktopWindows {
  list(): Promise<WindowList>;
  show(id: string): LiveWindowResult;
}

/**
 * The library's changes (Session 54): a presentation made from words, presentations and playlists deleted and put
 * back (a phone's Undo), a playlist made or renamed, and items added (from the library, by id), moved and taken out
 * and put back; each as the window's own request makes it (playlist-ipc.ts, words-ipc.ts, index.ts).
 */
export interface DesktopLibrary {
  newFromWords(name: unknown, words: unknown): NewFromWordsResult;
  removePresentations(ids: unknown): PlaylistResult;
  restorePresentations(ids: unknown): PlaylistResult;
  /** Null until the window's own playlist requests are registered (a moment into the start). */
  playlists(): PlaylistChanges | null;
}

/** The Drashti computer's own things a Remote sets up, as the main process does them for the window. */
export interface DesktopActs {
  screens: DesktopScreens;
  switches: DesktopSwitches;
  inputs: DesktopInputs;
  windows: DesktopWindows;
  /** The library's changes (left out, a test of something else: a phone cannot). */
  library?: DesktopLibrary;
  /** Simple Mode is on (it only turns the screens on). */
  simple(): boolean;
  /** The computer's own box: "Cover the Drashti controls?". True only when the operator agrees there. */
  confirmCover(question: ConsentQuestion): Promise<boolean>;
}

/** What the answers need of the network service. */
export interface DesktopContext {
  /**
   * At the computer's yes, which may come long after the ask: whether that phone may still make the change (Drashti
   * let in, the phone still paired, Simple Mode not refusing it). False: nothing is changed.
   */
  mayStill(deviceId: string, op: DesktopOp): boolean;
  /** The phones read their screens again (an ask began or ended). */
  changed(): void;
  log(message: string): void;
  now(): number;
}

export type DesktopOp =
  | 'screens'
  | 'screens.addGroup'
  | 'screens.renameGroup'
  | 'screens.groupRole'
  | 'screens.deleteGroup'
  | 'screens.useDisplay'
  | 'screens.change'
  | 'screens.remove'
  | 'screens.keep'
  | 'screens.goBack'
  | 'screens.identify'
  | 'switch'
  | 'inputs'
  | 'input.add'
  | 'input.change'
  | 'input.remove'
  | 'windows'
  | 'window.show'
  | 'library.new'
  | 'library.remove'
  | 'library.restore'
  | 'playlist.new'
  | 'playlist.rename'
  | 'playlist.remove'
  | 'playlist.restore'
  | 'playlist.add'
  | 'playlist.move'
  | 'playlist.removeItems'
  | 'playlist.restoreItems';

/** The library's ops (Session 54): each a change the window makes too. */
export const LIBRARY_OPS = [
  'library.new',
  'library.remove',
  'library.restore',
  'playlist.new',
  'playlist.rename',
  'playlist.remove',
  'playlist.restore',
  'playlist.add',
  'playlist.move',
  'playlist.removeItems',
  'playlist.restoreItems',
] as const satisfies readonly DesktopOp[];
export type LibraryOp = (typeof LIBRARY_OPS)[number];

/** The ops that read only (all others are limited per phone; the windows' list too, which takes the computer a while). */
const READS: ReadonlySet<DesktopOp> = new Set(['screens', 'inputs']);

const ok = (body: Record<string, unknown> = {}): DeviceAnswer => ({
  status: 200,
  body: { ok: true, ...body },
});
const deny = (status: number, message: string): DeviceAnswer => ({ status, body: { ok: false, message } });

// What each request may carry, and nothing else: a phone's consent to cover the controls is never among them.
const groupName = z.object({ name: nameSchema }).strict();
const groupRef = z.object({ groupId: idSchema }).strict();
const renamed = z.object({ groupId: idSchema, name: nameSchema }).strict();
const role = z.object({ groupId: idSchema, role: z.enum(GROUP_ROLES) }).strict();
const useDisplay = z.object({ groupId: idSchema, displayId: displayIdSchema }).strict();
const screenRef = z.object({ screenId: idSchema }).strict();
const screenChange = z
  .object({
    screenId: idSchema,
    patch: z
      .object({
        name: nameSchema,
        canvasWidth: canvasSizeSchema,
        canvasHeight: canvasSizeSchema,
        scaling: z.enum(SCALING_MODES),
        enabled: z.boolean(),
        feed: z.enum(['fill', 'key']),
      })
      .partial()
      .strict()
      .refine((p) => Object.keys(p).length > 0, 'nothing to change'),
  })
  .strict();
const nothing = z.object({}).strict();
const fit = z.enum(['fit', 'fill']);
const inputName = z.string().trim().min(1).max(VIDEO_INPUT_NAME_MAX);
const cameraName = z.string().min(1).max(VIDEO_INPUT_DEVICE_MAX);
const inputAdd = z.object({ name: inputName, device: cameraName, fit }).strict();
const inputChange = z
  .object({
    inputId: idSchema,
    name: inputName.optional(),
    device: cameraName.optional(),
    fit: fit.optional(),
  })
  .strict();
const inputRef = z.object({ inputId: idSchema }).strict();
const windowRef = z.object({ id: z.string().min(1).max(200) }).strict();
// The library's (Session 54): names and words as the window's requests take them, things by their ids only, at most
// 50 at once from a phone; what is added to a playlist is a presentation or a file of Media's, never a path.
const libraryName = z.string().trim().min(1).max(200);
const fromWords = z.object({ name: libraryName, words: z.string().min(1).max(200_000) }).strict();
const someIds = z.object({ ids: z.array(idSchema).min(1).max(50) }).strict();
const playlistName = z.object({ name: libraryName }).strict();
const playlistRenamed = z.object({ playlistId: idSchema, name: libraryName }).strict();
const playlistAdd = z
  .object({
    playlistId: idSchema,
    items: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('presentation'), presentationId: idSchema }).strict(),
          z.object({ kind: z.literal('media'), mediaId: idSchema }).strict(),
        ]),
      )
      .min(1)
      .max(50),
    at: z.number().int().min(0).max(100_000).nullable().optional(),
  })
  .strict();
const playlistMove = z
  .object({
    playlistId: idSchema,
    ids: z.array(idSchema).min(1).max(50),
    to: z.number().int().min(0).max(100_000),
  })
  .strict();
const switchTurn = z
  .object({ which: z.enum(SCREEN_SWITCHES), on: z.boolean(), confirmed: z.literal(true).optional() })
  .strict();

/**
 * Whether turning a switch on would open an output over the controls: one of this computer's screens under it,
 * switched off, opening again on the display the operator window is on.
 */
export function opensOverControls(
  snapshot: Pick<ScreensSnapshot, 'groups' | 'status'>,
  which: ScreenSwitch,
  controlsDisplayId: number | null,
): boolean {
  if (controlsDisplayId === null) return false;
  const under = new Set(
    snapshot.groups
      .filter((g) => switchFor(g.role) === which)
      .flatMap((g) => g.screens.filter((s) => s.nodeId === null).map((s) => s.id)),
  );
  return snapshot.status.some(
    (st) => st.state === 'switched-off' && st.displayId === controlsDisplayId && under.has(st.screenId),
  );
}

export class DesktopAnswers {
  private readonly consent: DesktopConsent;
  /** Changes from one phone: two a second, ten at once (each one can open and close windows). */
  private readonly changes: RateLimiter;
  /**
   * The library's from one phone (Session 54): five a second, thirty at once, as a person tapping through a playlist
   * makes them (each a change in the library, never a window); a phone sending more is held back all the same.
   */
  private readonly libraryChanges: RateLimiter;

  constructor(
    private readonly acts: DesktopActs,
    private readonly ctx: DesktopContext,
  ) {
    this.consent = new DesktopConsent({
      confirm: (question) => acts.confirmCover(question),
      now: () => ctx.now(),
      log: (message) => {
        ctx.log(message);
      },
    });
    this.changes = new RateLimiter(2, 10, () => ctx.now());
    this.libraryChanges = new RateLimiter(5, 30, () => ctx.now());
  }

  /** The screens as this phone reads them, its own ask to cover the controls with them. */
  view(deviceId: string): RemoteScreens {
    const snapshot = this.acts.screens.snapshot();
    return {
      displays: snapshot.displays,
      controlsDisplayId: this.acts.screens.controlsDisplayId(),
      // The stream's group is YouTube's card, and stays on the computer.
      groups: snapshot.groups.filter((g) => g.role !== 'stream'),
      status: snapshot.status,
      nodes: snapshot.nodes,
      switches: this.acts.switches.get(),
      asksFirst: bothSwitches((which) => this.acts.switches.asksFirst(which)),
      pending: this.acts.screens.pending(),
      asked: this.consent.forDevice(deviceId),
    };
  }

  answer(op: DesktopOp, args: Record<string, unknown>, device: { id: string }, who: string): DeviceAnswer {
    const limit = (LIBRARY_OPS as readonly DesktopOp[]).includes(op) ? this.libraryChanges : this.changes;
    if (!READS.has(op) && !limit.take(device.id))
      return deny(429, 'Too many changes at once: wait a moment, then try again.');
    const s = this.acts.screens;
    const done = (result: ScreensResult, did: string): DeviceAnswer => {
      if (!result.ok) return deny(409, result.message);
      this.ctx.log(`Network: ${who} ${did}`);
      return ok({ screens: this.view(device.id) });
    };
    const groupWords = (id: string) => {
      const name = s.snapshot().groups.find((g) => g.id === id)?.name;
      return name ? `“${name}”` : 'a screen group';
    };
    switch (op) {
      case 'screens':
        return ok({ screens: this.view(device.id) });
      case 'screens.addGroup': {
        const a = groupName.safeParse(args);
        if (!a.success) return deny(400, 'Give the group a name (up to 80 characters).');
        return done(s.createGroup(a.data.name), 'added a screen group');
      }
      case 'screens.renameGroup': {
        const a = renamed.safeParse(args);
        if (!a.success) return deny(400, 'Give the group a name (up to 80 characters).');
        return done(s.renameGroup(a.data.groupId, a.data.name), 'renamed a screen group');
      }
      case 'screens.groupRole': {
        const a = role.safeParse(args);
        if (!a.success)
          return deny(400, 'A group shows the audience picture, the stage view, or a key and fill pair.');
        return done(
          s.setGroupRole(a.data.groupId, a.data.role),
          `changed what ${groupWords(a.data.groupId)} shows`,
        );
      }
      case 'screens.deleteGroup': {
        const a = groupRef.safeParse(args);
        if (!a.success) return deny(400, 'That group no longer exists.');
        const what = groupWords(a.data.groupId);
        return done(s.deleteGroup(a.data.groupId), `deleted the screen group ${what}`);
      }
      case 'screens.useDisplay': {
        const a = useDisplay.safeParse(args);
        if (!a.success) return deny(400, 'Choose a group and a display.');
        const { groupId, displayId } = a.data;
        // Never with the phone's consent: the window's coverOperator is the operator's alone.
        const result = s.assignDisplay(groupId, displayId);
        const display = s.snapshot().displays.find((d) => d.id === displayId);
        const what = `${groupWords(groupId)} on ${display ? describeDisplay(display) : 'a display'}`;
        if (!result.ok && result.confirm === 'covers-operator')
          return this.askToCover(device.id, who, `to put ${what}`, op, () =>
            s.assignDisplay(groupId, displayId, { coverOperator: true }),
          );
        return done(result, `put ${what}`);
      }
      case 'screens.change': {
        const a = screenChange.safeParse(args);
        if (!a.success)
          return deny(400, 'Canvas sizes are whole numbers from 16 to 16384; names need 1 to 80 characters.');
        const { screenId, patch } = a.data;
        const result = s.updateScreen(screenId, patch);
        const name = s
          .snapshot()
          .groups.flatMap((g) => g.screens)
          .find((sc) => sc.id === screenId)?.name;
        const what = name ? `“${name}”` : 'a screen';
        if (!result.ok && result.confirm === 'covers-operator')
          return this.askToCover(device.id, who, `to turn ${what} on again`, op, () =>
            s.updateScreen(screenId, patch, { coverOperator: true }),
          );
        return done(result, `changed the screen ${what}`);
      }
      case 'screens.remove': {
        const a = screenRef.safeParse(args);
        if (!a.success) return deny(400, 'That screen no longer exists.');
        return done(s.removeScreen(a.data.screenId), 'removed a screen');
      }
      case 'screens.keep':
      case 'screens.goBack': {
        if (!nothing.safeParse(args).success) return deny(400, 'Keep, or Go back: nothing else.');
        const result = op === 'screens.keep' ? s.keep() : s.goBack();
        return done(
          result,
          op === 'screens.keep' ? 'kept the screens' : 'went back to the screens as they were',
        );
      }
      case 'screens.identify':
        s.identify();
        return ok({});
      case 'switch':
        return this.turn(args, device.id, who);
      case 'inputs':
        return ok({ ...this.inputs() });
      case 'input.add':
      case 'input.change':
      case 'input.remove':
        return this.input(op, args, who);
      case 'windows':
        // Looked for in a while: answered by windows(), never here.
        return deny(400, 'Drashti answers that in a moment.');
      case 'window.show': {
        const a = windowRef.safeParse(args);
        if (!a.success) return deny(400, 'Which window?');
        const shown = this.acts.windows.show(a.data.id);
        if (!shown.ok) return deny(409, shown.message);
        this.ctx.log(`Network: ${who} put another app’s window up as the background`);
        return ok({});
      }
      default:
        return this.library(op, args, who);
    }
  }

  /**
   * The library's changes (Session 54), as the window makes them: each answered with the ids it changed, so a phone's
   * Undo puts back what its delete took out (by those ids, as the window's Undo does).
   */
  private library(op: LibraryOp, args: Record<string, unknown>, who: string): DeviceAnswer {
    const library = this.acts.library;
    const playlists = library?.playlists() ?? null;
    if (!library || !playlists) return deny(503, 'Drashti is still starting: try again in a moment.');
    const done = (result: PlaylistResult | NewFromWordsResult, did: string): DeviceAnswer => {
      if (!result.ok) return deny(409, result.message);
      this.ctx.log(`Network: ${who} ${did}`);
      return ok('ids' in result ? { ids: result.ids } : { id: result.id });
    };
    const bad = (words: string) => deny(400, words);
    switch (op) {
      case 'library.new': {
        const a = fromWords.safeParse(args);
        if (!a.success) return bad('Give the presentation a name, and its words.');
        return done(library.newFromWords(a.data.name, a.data.words), 'made a presentation from words');
      }
      case 'library.remove':
      case 'library.restore': {
        const a = someIds.safeParse(args);
        if (!a.success) return bad('Which presentations?');
        return op === 'library.remove'
          ? done(library.removePresentations(a.data.ids), 'deleted presentations')
          : done(library.restorePresentations(a.data.ids), 'put deleted presentations back');
      }
      case 'playlist.new': {
        const a = playlistName.safeParse(args);
        if (!a.success) return bad('A name needs 1 to 200 characters.');
        return done(playlists.create(a.data.name, null, false), 'made a playlist');
      }
      case 'playlist.rename': {
        const a = playlistRenamed.safeParse(args);
        if (!a.success) return bad('A name needs 1 to 200 characters.');
        return done(playlists.rename(a.data.playlistId, a.data.name), 'renamed a playlist');
      }
      case 'playlist.remove':
      case 'playlist.restore': {
        const a = someIds.safeParse(args);
        if (!a.success) return bad('Which playlists?');
        return op === 'playlist.remove'
          ? done(playlists.remove(a.data.ids), 'deleted playlists')
          : done(playlists.restore(a.data.ids), 'put deleted playlists back');
      }
      case 'playlist.add': {
        const a = playlistAdd.safeParse(args);
        if (!a.success) return bad('Add a presentation or something from Media.');
        return done(
          playlists.addItems(a.data.playlistId, a.data.at ?? null, a.data.items),
          'added to a playlist',
        );
      }
      case 'playlist.move': {
        const a = playlistMove.safeParse(args);
        if (!a.success) return bad('Which items, and where to?');
        return done(
          playlists.moveItems(a.data.playlistId, a.data.ids, a.data.to),
          'moved items in a playlist',
        );
      }
      case 'playlist.removeItems':
      case 'playlist.restoreItems': {
        const a = someIds.safeParse(args);
        if (!a.success) return bad('Which items?');
        return op === 'playlist.removeItems'
          ? done(playlists.removeItems(a.data.ids), 'took items out of a playlist')
          : done(playlists.restoreItems(a.data.ids), 'put items back in a playlist');
      }
    }
  }

  /** Media's video inputs, the cameras the computer lists, and whether Drashti may use them. */
  private inputs(): RemoteInputs {
    return {
      inputs: this.acts.inputs.view().inputs,
      access: this.acts.inputs.access(),
      cameras: this.acts.inputs.cameras(),
    };
  }

  /**
   * A video input named, changed or removed as Media does it, its camera one the computer lists now (a phone never
   * names one), or for a change the one it has. The camera's own setting is the computer's to answer.
   */
  private input(
    op: 'input.add' | 'input.change' | 'input.remove',
    args: Record<string, unknown>,
    who: string,
  ) {
    const inputs = this.acts.inputs;
    const listed = (device: string): string | null => {
      if (inputs.access() !== 'granted') return CAMERA_AT_COMPUTER;
      const cameras = inputs.cameras();
      if (cameras === null) return CAMERAS_NOT_LISTED;
      return cameras.includes(device) ? null : NOT_A_LISTED_CAMERA;
    };
    const done = (result: VideoInputResult, did: string): DeviceAnswer => {
      if (!result.ok) return deny(409, result.message);
      this.ctx.log(`Network: ${who} ${did}`);
      return ok({ ...this.inputs() });
    };
    if (op === 'input.add') {
      const a = inputAdd.safeParse(args);
      if (!a.success) return deny(400, 'Give it a name, a camera the computer lists, and Fit or Fill.');
      const refused = listed(a.data.device);
      if (refused) return deny(409, refused);
      return done(inputs.add(a.data), 'named a video input');
    }
    if (op === 'input.change') {
      const a = inputChange.safeParse(args);
      if (!a.success) return deny(400, 'A name, a camera the computer lists, or Fit or Fill.');
      const { inputId, ...fields } = a.data;
      const was = inputs.view().inputs.find((i) => i.id === inputId);
      if (fields.device !== undefined && fields.device !== was?.device) {
        const refused = listed(fields.device);
        if (refused) return deny(409, refused);
      }
      return done(inputs.update(inputId, fields), 'changed a video input');
    }
    const a = inputRef.safeParse(args);
    if (!a.success) return deny(400, 'Which video input?');
    return done(inputs.remove(a.data.inputId), 'removed a video input');
  }

  /**
   * The other apps' windows, as Show a Window… lists them (the list a window is then put up from): by name, never a
   * picture of them. macOS's Screen Recording is the computer's to allow, and said so.
   */
  async windows(device: { id: string }): Promise<DeviceAnswer> {
    if (!this.changes.take(device.id))
      return deny(429, 'Too many changes at once: wait a moment, then try again.');
    const list = await this.acts.windows.list();
    const windows: RemoteWindows = list.ok
      ? { ok: true, windows: list.windows.map(({ id, name }) => ({ id, name })) }
      : {
          ok: false,
          reason: list.reason,
          message: list.reason === 'permission' ? SCREEN_RECORDING_AT_COMPUTER : list.message,
        };
    return ok({ windows });
  }

  /** Audience or Stage off or on, as the window turns it: off asks first (answered on the phone), Simple Mode only on. */
  private turn(args: Record<string, unknown>, deviceId: string, who: string): DeviceAnswer {
    const a = switchTurn.safeParse(args);
    if (!a.success) return deny(400, 'Turn Audience or Stage on or off.');
    const { which, on, confirmed } = a.data;
    const name = SWITCH_NAMES[which];
    const sw = this.acts.switches;
    if (!on && this.acts.simple()) return deny(403, ONLY_ON_IN_SIMPLE_MODE);
    // The window's question, asked on the phone: Off without it changes nothing (and says why).
    if (!on && confirmed !== true && sw.get()[which] && sw.asksFirst(which))
      return { status: 409, body: { ok: false, confirm: 'switch-off', message: SWITCH_ASKS_FIRST } };
    // On again over the controls: the computer agrees first, as for any output a phone puts there.
    if (
      on &&
      !sw.get()[which] &&
      opensOverControls(this.acts.screens.snapshot(), which, this.acts.screens.controlsDisplayId())
    )
      return this.askToCover(deviceId, who, `to turn ${name} on again`, 'switch', () => {
        const turned = sw.turn(which, true);
        return turned.ok ? { ok: true, snapshot: this.acts.screens.snapshot() } : turned;
      });
    const result = sw.turn(which, on);
    if (!result.ok) return deny(409, result.message);
    this.ctx.log(`Network: ${who} turned ${name} ${on ? 'on' : 'off'}`);
    return ok({ switches: result.switches, screens: this.view(deviceId) });
  }

  /**
   * An output the phone would put over the controls: the computer is asked, and `again` (the same change, with the
   * operator's consent) runs only on its yes, while that phone may still make it. 202 while it asks.
   */
  private askToCover(
    deviceId: string,
    who: string,
    what: string,
    op: DesktopOp,
    again: () => ScreensResult,
  ): DeviceAnswer {
    const asked = this.consent.ask(
      deviceId,
      { who, what },
      () => {
        if (!this.ctx.mayStill(deviceId, op))
          return 'Nothing changed: that phone may no longer change the screens.';
        const result = again();
        if (!result.ok) return result.message;
        this.ctx.log(`Network: ${who} covered the controls, as the operator agreed (${what})`);
        return null;
      },
      () => {
        this.ctx.changed();
      },
    );
    if (!asked.asked) return deny(409, asked.message);
    return {
      status: 202,
      body: { ok: true, asked: true, message: asked.message, screens: this.view(deviceId) },
    };
  }
}
