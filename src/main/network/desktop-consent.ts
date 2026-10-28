import { shortcutText } from '../../shared/keymap';
import type { DesktopAsk, DesktopAskView } from '../../shared/network-desktop';
import { ASK_AGAIN_SOON, ASK_WORDS, ASKED_AT_COMPUTER, COMPUTER_BUSY } from '../../shared/network-desktop';

/*
 * The computer's own say before a phone covers its controls (Session 54, the phone as a full Drashti): an output
 * a phone would put on the display the operator window is on would cover the controls, so the computer asks in its
 * own box over the operator window ("Cover the Drashti controls?", as Screens asks it), and only that box's yes
 * goes on. A phone never says yes for it: what a phone sends is never taken as the operator's consent. One question
 * at a time, whichever phone asks; a phone told no waits a little before it may ask again, so nothing a phone sends
 * can keep the box up. Each phone reads how its ask stands with the screens, for a minute after the answer.
 */

/** What the computer's box says: which phone asks, and what would cover the controls. */
export interface ConsentQuestion {
  /** The phone, as the log and the box name it ("Remote “Placeholder phone”"). */
  who: string;
  /** What it asks, in words ("to put “Main Hall” on Display 1 · 1920 × 1080 · 60 Hz"). */
  what: string;
}

/**
 * The computer's box over the operator window, in Screens' own words ("Cover the Drashti controls?", Cover the
 * controls) and how to get them back; Cancel first and kept to, so Enter and Esc never cover them by themselves.
 */
export function coverBox(
  question: ConsentQuestion,
  platform: string,
): {
  type: 'question';
  buttons: [string, string];
  defaultId: number;
  cancelId: number;
  message: string;
  detail: string;
} {
  return {
    type: 'question',
    buttons: ['Cancel', 'Cover the controls'],
    defaultId: 0,
    cancelId: 0,
    message: 'Cover the Drashti controls?',
    detail:
      `${question.who} asks ${question.what}: an output would then cover the Drashti controls on this display ` +
      'completely, so you could not see or click them while it shows. To get them back, press ' +
      `${shortcutText('uncoverControls', platform)} (Uncover the controls): it works even while Drashti is ` +
      'covered, and turns that output off.',
  };
}

export interface ConsentDeps {
  /** The computer's own box, over the operator window: true only when the operator agrees there. */
  confirm(question: ConsentQuestion): Promise<boolean>;
  now(): number;
  log(message: string): void;
}

/** How long a phone told no waits before it may ask again. */
export const ASK_AGAIN_MS = 15_000;
/** How long a phone can read how its ask ended. */
const KEPT_MS = 60_000;

/** Why an ask was not put to the computer: another is up, or this phone was told no a moment ago. */
export interface NotAsked {
  asked: false;
  message: string;
}

interface Outcome {
  state: DesktopAsk;
  message: string;
  at: number;
}

export class DesktopConsent {
  /** The phone whose question is up now, or null. */
  private asking: string | null = null;
  private readonly outcomes = new Map<string, Outcome>();

  constructor(private readonly deps: ConsentDeps) {}

  /** How a phone's ask stands now: while the box is up, and for a minute after its answer; null otherwise. */
  forDevice(deviceId: string): DesktopAskView | null {
    const kept = this.outcomes.get(deviceId);
    if (!kept) return null;
    if (kept.state !== 'waiting' && this.deps.now() - kept.at > KEPT_MS) {
      this.outcomes.delete(deviceId);
      return null;
    }
    return { state: kept.state, message: kept.message };
  }

  /** Whether any phone's question is up on the computer now. */
  get busy(): boolean {
    return this.asking !== null;
  }

  /**
   * Put a phone's ask to the computer. `go` runs only on the computer's yes, and says what came of it (null: the
   * change was made; a message: it could not be, as the screens had changed). Answered at once with whether it
   * was asked; how it ends, the phone reads later (forDevice).
   */
  ask(
    deviceId: string,
    question: ConsentQuestion,
    go: () => string | null,
    changed: () => void,
  ): { asked: true; message: string } | NotAsked {
    if (this.asking !== null) return { asked: false, message: COMPUTER_BUSY };
    const before = this.outcomes.get(deviceId);
    if (before?.state === 'refused' && this.deps.now() - before.at < ASK_AGAIN_MS)
      return { asked: false, message: ASK_AGAIN_SOON };
    this.asking = deviceId;
    this.keep(deviceId, 'waiting', ASK_WORDS.waiting);
    this.deps.log(`Network: ${question.who} asks to cover the Drashti controls (${question.what})`);
    const answered = (yes: boolean) => {
      this.asking = null;
      if (!yes) {
        this.deps.log(`Network: the operator did not agree to ${question.who} covering the controls`);
        this.keep(deviceId, 'refused', ASK_WORDS.refused);
      } else {
        this.deps.log(`Network: the operator agreed to ${question.who} covering the controls`);
        let failed: string | null;
        try {
          failed = go();
        } catch (error) {
          this.deps.log(
            `Network: the change ${question.who} asked for could not be made (${(error as Error).message})`,
          );
          failed = 'Drashti could not make that change: try again, or make it on the Drashti computer.';
        }
        this.keep(deviceId, failed === null ? 'agreed' : 'failed', failed ?? ASK_WORDS.agreed);
      }
      changed();
    };
    // A box that fails to show is no yes.
    this.deps.confirm(question).then(answered, () => {
      answered(false);
    });
    changed();
    return { asked: true, message: ASKED_AT_COMPUTER };
  }

  private keep(deviceId: string, state: DesktopAsk, message: string): void {
    this.outcomes.set(deviceId, { state, message, at: this.deps.now() });
    // Never more than a few hundred kept (each phone's last only).
    if (this.outcomes.size > 500)
      for (const [id, o] of this.outcomes) if (o.state !== 'waiting') this.outcomes.delete(id);
  }
}
