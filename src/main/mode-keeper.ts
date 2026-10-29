import type { AccessMode } from '../shared/access-protocol';
import {
  isOperatorMode,
  leaveSimpleRefusal,
  type ModeResult,
  type OperatorMode,
  SIMPLE_ACCESS_REFUSAL,
  startingMode,
} from '../shared/mode';

/*
 * Simple Mode and Pro Mode, as the main process keeps them (PLAN.md section 3; Sessions 20 and 21: a start after a
 * clean quit is Pro Mode's, after an unexpected stop a short while ago the mode it was in), and access by mode
 * (Session 55, Part 19, the owner's decision of 29 Oct 2026): the list's answer says whether this computer's Gmail may
 * use Pro Mode and Simple Mode (Pro access) or Simple Mode only (Simple access).
 *
 * - With Simple access, Drashti is in Simple Mode: at a start, and at the answer that says so (within one check, 15 s,
 *   online), and leaving it is refused whoever asks: the operator window (with the word or not), the View menu (whose
 *   item goes), and so a key or a MIDI pad, which only ever reach those. Everything Simple Mode refuses stays refused
 *   (simple-mode.ts's channels for the window and the phones' API, which Companion uses too; the engine's commands from
 *   anywhere): index.ts asks this keeper's mode for each.
 * - With Pro access, as before. If the access put this computer in Simple Mode, Pro access again brings Pro Mode back
 *   by itself; if the operator chose Simple Mode, it stays. Which it was is kept with the mode, for a restart.
 *
 * The one place the mode changes: index.ts makes one, and hears each change (the menu, the window).
 */

export interface ModeKeeperOptions {
  /** The mode kept from the last run, and whether the access put it there (the library's settings). */
  saved: { mode: unknown; byAccess: unknown };
  /** The last run stopped unexpectedly a short while ago (restart recovery's own answer). */
  recentStop: boolean;
  /** The last run quit cleanly (only for the log's words). */
  cleanQuit?: boolean;
  /** How this computer's Gmail may use Drashti, as the list last said (gate.ts). */
  access: () => AccessMode;
  /** Keep the mode, and whether the access put it there, for the next start. */
  save: (mode: OperatorMode, byAccess: boolean) => void;
  /** The mode changed: the menu is made again and the window told. */
  changed: (mode: OperatorMode) => void;
  /** The access changed, the mode not: the menu is made again (its way back to Pro Mode comes or goes). */
  menu: () => void;
  log: (line: string) => void;
}

/** What View › Switch… did: to Simple Mode at once, the window asked for the word, or refused (Simple access). */
export type MenuSwitch = 'switched' | 'ask' | 'refused';

export class ModeKeeper {
  private current: OperatorMode;
  /** The access put this computer in Simple Mode: Pro access again brings Pro Mode back by itself. */
  private byAccess: boolean;
  /** The access as last heard, so a change is noticed once. */
  private heard: AccessMode;

  constructor(private readonly o: ModeKeeperOptions) {
    const wasIn: OperatorMode = isOperatorMode(o.saved.mode) ? o.saved.mode : 'pro';
    this.current = startingMode({ recentStop: o.recentStop, wasIn });
    // Kept only while the mode it is about is the one restored.
    this.byAccess = this.current === 'simple' && o.saved.byAccess === true;
    this.heard = o.access();
    if (this.heard === 'simple' && this.current === 'pro') {
      this.current = 'simple';
      this.byAccess = true;
      this.o.log('Starting in Simple Mode: this computer’s access is Simple Mode only');
    } else if (this.current === 'simple')
      this.o.log('Starting in Simple Mode, as before the unexpected stop');
    else if (wasIn === 'simple')
      this.o.log(
        o.cleanQuit === false
          ? 'Starting in Pro Mode: the unexpected stop was 3 hours or more ago'
          : 'Starting in Pro Mode after a clean quit',
      );
    if (this.current !== wasIn || this.byAccess !== (o.saved.byAccess === true))
      this.o.save(this.current, this.byAccess);
  }

  /** Simple Mode or Pro Mode, now. */
  get mode(): OperatorMode {
    return this.current;
  }

  /** This computer may use Simple Mode only (the list's last answer said Simple). */
  simpleOnly(): boolean {
    return this.o.access() === 'simple';
  }

  /**
   * The operator window asks: Simple Mode at once; Pro Mode with the word, and never with Simple access (refused, saying
   * why). A choice the operator makes is theirs: Pro access again never undoes it.
   */
  request(wanted: OperatorMode, word: unknown): ModeResult {
    if (wanted === this.current) return { ok: true, mode: this.current };
    if (wanted === 'pro') {
      if (this.simpleOnly()) {
        this.o.log('Pro Mode refused: this computer’s access is Simple Mode only');
        return { ok: false, message: SIMPLE_ACCESS_REFUSAL };
      }
      // The word, typed on purpose; never a PIN (Session 54, E5: roles and PINs are gone).
      const refusal = leaveSimpleRefusal(word);
      if (refusal !== null) return { ok: false, message: refusal };
    }
    this.byAccess = false;
    this.set(wanted, wanted === 'simple' ? 'Switched to Simple Mode' : 'Switched to Pro Mode');
    return { ok: true, mode: this.current };
  }

  /** View › Switch to Simple Mode (at once), or Switch to Pro Mode… (the window asks for the word; never with Simple access). */
  menuSwitch(): MenuSwitch {
    if (this.current === 'pro') {
      this.request('simple', undefined);
      return 'switched';
    }
    if (this.simpleOnly()) {
      this.o.log('Pro Mode refused: this computer’s access is Simple Mode only');
      return 'refused';
    }
    return 'ask';
  }

  /**
   * The list's answer changed this computer's access: Simple access puts it in Simple Mode now (remembering the access
   * did); Pro access again brings Pro Mode back by itself only when the access had put it in Simple Mode. The menu's
   * way back comes or goes either way.
   */
  accessChanged(): void {
    const access = this.o.access();
    if (access === this.heard) return;
    this.heard = access;
    if (access === 'simple' && this.current === 'pro') {
      this.byAccess = true;
      this.set('simple', 'Switched to Simple Mode: this computer’s access is Simple Mode only now');
      return;
    }
    if (access === 'pro' && this.current === 'simple' && this.byAccess) {
      this.byAccess = false;
      this.set('pro', 'Switched back to Pro Mode: this computer has Pro access again');
      return;
    }
    this.o.log(access === 'simple' ? 'Simple access: Pro Mode is not offered' : 'Pro access again');
    this.o.menu();
  }

  private set(next: OperatorMode, line: string): void {
    this.current = next;
    this.o.save(next, this.byAccess);
    this.o.log(line);
    this.o.changed(next);
  }
}
