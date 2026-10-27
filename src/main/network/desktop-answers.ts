import { z } from 'zod';
import { describeDisplay } from '../../shared/display-match';
import type { PendingScreens } from '../../shared/keep-screens';
import { idSchema } from '../../shared/model-schema';
import type { DeviceAnswer } from '../../shared/network-api';
import { bothSwitches, type RemoteScreens, SWITCH_ASKS_FIRST } from '../../shared/network-desktop';
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

/** The Drashti computer's own things a Remote sets up, as the main process does them for the window. */
export interface DesktopActs {
  screens: DesktopScreens;
  switches: DesktopSwitches;
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
  | 'switch';

/** The ops that change something: limited per phone. */
const READS: ReadonlySet<DesktopOp> = new Set(['screens']);

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
    if (!READS.has(op) && !this.changes.take(device.id))
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
    }
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
