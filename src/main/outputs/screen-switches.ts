import { z } from 'zod';
import type { EngineState } from '../../shared/engine/state';
import {
  asksFirst as asksFirstFor,
  openUnder,
  SCREEN_SWITCHES,
  SWITCH_NAMES,
  SWITCH_OFF_WORDS,
  switchOffQuestion,
  TURN_OFF,
  type ScreenSwitch,
  type ScreenSwitches,
  type ScreenSwitchResult,
} from '../../shared/screen-switches';
import type { ScreensSnapshot } from '../../shared/screens';

/*
 * Audience and Stage (Session 50), as the main process runs them. Off closes this computer's output windows the
 * switch covers, so their displays go back to the computer; on opens them again where they were (the output
 * manager does both). Nothing else changes: the engine, LIVE, the other switch's screens, the stream and
 * recording, and nodes' screens carry on. Both are on at every start, as nothing is saved.
 *
 * Every request is checked here. Simple Mode may only turn them on (a volunteer gives a screen back to the hall,
 * never takes it away); with roles on, an operator may turn them either way, so a volunteer can give the
 * projector back to the laptop in a hurry (not an admin's channel). Turning one off from the View menu asks
 * first while its screens show something, as the window's switches and keys do.
 */

/** What the switches need of the output windows (output-manager.ts). */
export interface SwitchedOutputs {
  switches(): ScreenSwitches;
  /** True when it changed. */
  setSwitch(which: ScreenSwitch, on: boolean): boolean;
}

export interface ScreenSwitchDeps {
  outputs: SwitchedOutputs;
  /** Simple Mode is on: it only turns them on. */
  simple(): boolean;
  /** The groups and how each of this computer's screens stands: which windows a switch would close. */
  screens(): Pick<ScreensSnapshot, 'groups' | 'status'>;
  /** The show now: whether the hall's screens show anything. */
  state(): EngineState;
  log(message: string): void;
}

export const ONLY_ON_IN_SIMPLE_MODE = 'Simple Mode only turns the screens on. Pro Mode turns them off.';
const NOT_A_SWITCH = 'Turn Audience or Stage on or off.';

const whichSchema = z.enum(SCREEN_SWITCHES);

/** The screens a switch covers, as the log says them. */
const covered: Record<ScreenSwitch, string> = {
  audience: 'the hall’s screens on this computer (key and fill too)',
  stage: 'the stage screens on this computer',
};

export class ScreenSwitchService {
  private readonly listeners = new Set<(switches: ScreenSwitches) => void>();
  /** The View menu's question is open: one at a time. */
  private asking = false;

  constructor(private readonly deps: ScreenSwitchDeps) {}

  get(): ScreenSwitches {
    return this.deps.outputs.switches();
  }

  /** Told after each change (the operator window, the View menu's ticks, the phones). */
  onChanged(listener: (switches: ScreenSwitches) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A request to turn one off or on, checked: Simple Mode only turns them on. */
  turn(rawWhich: unknown, rawOn: unknown): ScreenSwitchResult {
    const which = whichSchema.safeParse(rawWhich);
    if (!which.success || typeof rawOn !== 'boolean') return { ok: false, message: NOT_A_SWITCH };
    if (!rawOn && this.deps.simple()) return { ok: false, message: ONLY_ON_IN_SIMPLE_MODE };
    if (this.deps.outputs.setSwitch(which.data, rawOn)) {
      this.deps.log(
        rawOn
          ? `Screens: ${SWITCH_NAMES[which.data]} turned on: ${covered[which.data]} open again`
          : `Screens: ${SWITCH_NAMES[which.data]} turned off: ${covered[which.data]} closed, their displays the computer’s until it is on again`,
      );
      const now = this.get();
      for (const listener of this.listeners) listener(now);
    }
    return { ok: true, switches: this.get() };
  }

  /** Whether turning it off asks first now: while its screens on this computer are open and show something. */
  asksFirst(which: ScreenSwitch): boolean {
    return asksFirstFor(which, openUnder(this.deps.screens(), which), this.deps.state());
  }

  /**
   * The View menu's item: on at once; off after `ask` says yes while its screens show something. Chosen again
   * while it asks, nothing happens. Simple Mode's menu has neither item; there it could only turn one on.
   */
  async toggle(which: ScreenSwitch, ask: (which: ScreenSwitch) => Promise<boolean>): Promise<void> {
    if (this.asking) return;
    if (!this.get()[which]) {
      this.turn(which, true);
      return;
    }
    if (this.deps.simple()) return;
    if (this.asksFirst(which)) {
      this.asking = true;
      try {
        if (!(await ask(which))) return;
      } finally {
        this.asking = false;
      }
    }
    this.turn(which, false);
  }
}

/**
 * The View menu's own box before one goes off (Session 51, S2-7): the window's question in its words and case,
 * Cancel first and kept to, so Enter and Esc never turn the screens off by themselves.
 */
export function switchOffBox(which: ScreenSwitch): {
  type: 'question';
  buttons: [string, string];
  defaultId: number;
  cancelId: number;
  message: string;
  detail: string;
} {
  return {
    type: 'question',
    buttons: ['Cancel', TURN_OFF],
    defaultId: 0,
    cancelId: 0,
    message: switchOffQuestion(which),
    detail: `${SWITCH_OFF_WORDS[which]} The show carries on.`,
  };
}
