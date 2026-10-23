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

/** What the window's question needs of the outputs and the operator window. */
export interface SwitchQuestionDeps {
  /** The outputs over the display the controls are on now, by screen (keep-screens.ts, coveringScreens). */
  covering(): readonly string[];
  /** Every output window open now, by screen. */
  outputs(): readonly string[];
  /** Show the question on an output, large in its middle, or take it off (null). */
  show(screenId: string, which: ScreenSwitch | null): void;
  /** Tell the operator window whether an output over the controls asks too, when that changes as it asks. */
  covered(covered: boolean): void;
  /** Tell the operator window the answer given on that output: true turns it off, false cancels. */
  answered(yes: boolean): void;
  /** Simple Mode is on: it only turns them on, and never asks. */
  simple(): boolean;
  log(message: string): void;
}

/**
 * The window's question before one goes off (Mod+1, Mod+2 or the top bar's switch), also on an output over the
 * controls (Session 51, S2-2), as Keep these screens? is: with only the one display, the question in the window
 * under that output could not be seen. The window asks, and says so here as it opens and goes; the output over
 * the controls shows it large, and Enter turns it off and Esc cancels. The keys reach the window under it (an
 * output never takes the keyboard), whose dialog then has Turn off focused. Were an output ever to have the
 * keyboard (none does: one over the controls is full screen and never takes it, and windowed outputs never cover
 * the controls), its own Enter or Esc would go to the window, which acts. The window is the one place the question
 * is kept: a phone, the View menu or another window never asks it here.
 */
export class SwitchQuestion {
  private which: ScreenSwitch | null = null;
  /** The outputs showing it now, and the question each shows. */
  private shownOn = new Map<string, ScreenSwitch>();
  /** Whether the window was last told an output over the controls asks too. */
  private told = false;

  constructor(private readonly deps: SwitchQuestionDeps) {}

  /**
   * The window asks "Turn … off?" now, or no longer (null): shown on the output over the controls, or taken off.
   * True when an output over the controls asks too (the window's answer: no message follows it).
   */
  asking(rawWhich: unknown): boolean {
    const which = whichSchema.safeParse(rawWhich);
    this.which = which.success && !this.deps.simple() ? which.data : null;
    this.told = this.follow();
    if (this.told && this.which !== null)
      this.deps.log(
        `Screens: ${switchOffQuestion(this.which)} asked, the output over the controls asking too`,
      );
    return this.told;
  }

  /** The question an output shows now: only one over the controls, while the window asks. */
  questionFor(screenId: string): ScreenSwitch | null {
    return this.which !== null && this.deps.covering().includes(screenId) ? this.which : null;
  }

  /**
   * An output's page loaded (it opened, or loaded again) and asks which screen it is: the question shown on it
   * again if it is over the controls as the window asks, and taken off it when the question goes.
   */
  loaded(screenId: string): void {
    const which = this.questionFor(screenId);
    if (which === null) return;
    this.shownOn.set(screenId, which);
    this.deps.show(screenId, which);
  }

  /**
   * The outputs changed (one opened, closed or moved; the uncover key): the question follows them, and the window
   * is told when an output over the controls starts or stops asking.
   */
  refresh(): void {
    if (this.which === null && this.shownOn.size === 0) return;
    const covered = this.follow();
    if (this.which === null || covered === this.told) return;
    this.told = covered;
    this.deps.covered(covered);
  }

  /**
   * An output's own Enter (true) or Esc (false), were it to have the keyboard: only from the output asking, and
   * only a yes or a no. The window acts on it, as on its own buttons. True when it was taken.
   */
  answer(screenId: string, rawYes: unknown): boolean {
    const which = this.questionFor(screenId);
    if (typeof rawYes !== 'boolean' || which === null) return false;
    this.deps.log(
      `Screens: ${switchOffQuestion(which)} answered on the output over the controls (${rawYes ? 'Enter' : 'Esc'})`,
    );
    this.deps.answered(rawYes);
    return true;
  }

  /** Show it on each open output over the controls and take it off any other; whether any shows it. */
  private follow(): boolean {
    const which = this.which;
    const covering = new Set(which === null ? [] : this.deps.covering());
    const showing = new Map<string, ScreenSwitch>();
    for (const screenId of this.deps.outputs()) {
      const shown = this.shownOn.get(screenId);
      if (which !== null && covering.has(screenId)) {
        showing.set(screenId, which);
        if (shown !== which) this.deps.show(screenId, which);
      } else if (shown !== undefined) this.deps.show(screenId, null);
    }
    this.shownOn = showing;
    return showing.size > 0;
  }
}
