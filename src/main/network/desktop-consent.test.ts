import { describe, expect, it } from 'vitest';
import { ASK_AGAIN_SOON, ASK_WORDS, ASKED_AT_COMPUTER, COMPUTER_BUSY } from '../../shared/network-desktop';
import { ASK_AGAIN_MS, coverBox, DesktopConsent } from './desktop-consent';

/*
 * The computer's own say before a phone covers its controls (Session 54, the phone as a full Drashti): only the
 * computer's yes makes the change, one question at a time, a phone told no waiting before it asks again, and each
 * phone reading how its ask stands. Made-up ids and names.
 */

function setup() {
  let now = 1_000_000;
  const boxes: {
    question: { who: string; what: string };
    answer: (yes: boolean) => void;
    fail: () => void;
  }[] = [];
  const consent = new DesktopConsent({
    confirm: (question) =>
      new Promise<boolean>((resolve, reject) => {
        boxes.push({ question, answer: resolve, fail: () => reject(new Error('no window')) });
      }),
    now: () => now,
    log: () => undefined,
  });
  let changes = 0;
  const changed = () => {
    changes++;
  };
  const later = (ms: number) => {
    now += ms;
  };
  // A moment for the box's answer to arrive.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { consent, boxes, changed, later, settle, changes: () => changes };
}

const QUESTION = { who: 'Remote “Placeholder phone”', what: 'to put “Main Hall” on Display 1' };

describe('the computer’s say before a phone covers its controls', () => {
  it('makes the change only on the computer’s yes, and says how the ask stands meanwhile and after', async () => {
    const { consent, boxes, changed, settle, changes } = setup();
    let made = 0;
    const go = () => {
      made++;
      return null;
    };
    expect(consent.ask('d-1', QUESTION, go, changed)).toEqual({ asked: true, message: ASKED_AT_COMPUTER });
    expect(boxes.map((b) => b.question)).toEqual([QUESTION]);
    expect(consent.busy).toBe(true);
    expect(consent.forDevice('d-1')).toEqual({ state: 'waiting', message: ASK_WORDS.waiting });
    expect(consent.forDevice('d-2')).toBeNull();
    expect(made).toBe(0);
    boxes[0]?.answer(true);
    await settle();
    expect(made).toBe(1);
    expect(consent.busy).toBe(false);
    expect(consent.forDevice('d-1')).toEqual({ state: 'agreed', message: ASK_WORDS.agreed });
    // The phones were told as it was asked, and as it was answered.
    expect(changes()).toBe(2);
  });

  it('changes nothing on a no, or when the box could not be shown', async () => {
    const { consent, boxes, changed, later, settle } = setup();
    let made = 0;
    const go = () => {
      made++;
      return null;
    };
    consent.ask('d-1', QUESTION, go, changed);
    boxes[0]?.answer(false);
    await settle();
    expect(consent.forDevice('d-1')).toEqual({ state: 'refused', message: ASK_WORDS.refused });
    later(ASK_AGAIN_MS);
    consent.ask('d-1', QUESTION, go, changed);
    boxes[1]?.fail();
    await settle();
    expect(made).toBe(0);
    expect(consent.forDevice('d-1')?.state).toBe('refused');
  });

  it('asks one question at a time, whichever phone asks', async () => {
    const { consent, boxes, changed, settle } = setup();
    consent.ask('d-1', QUESTION, () => null, changed);
    expect(consent.ask('d-2', QUESTION, () => null, changed)).toEqual({
      asked: false,
      message: COMPUTER_BUSY,
    });
    expect(consent.ask('d-1', QUESTION, () => null, changed)).toEqual({
      asked: false,
      message: COMPUTER_BUSY,
    });
    expect(boxes).toHaveLength(1);
    boxes[0]?.answer(true);
    await settle();
    expect(consent.ask('d-2', QUESTION, () => null, changed).asked).toBe(true);
  });

  it('makes a phone told no wait before it asks again, so no phone can keep the box up', async () => {
    const { consent, boxes, changed, later, settle } = setup();
    consent.ask('d-1', QUESTION, () => null, changed);
    boxes[0]?.answer(false);
    await settle();
    expect(consent.ask('d-1', QUESTION, () => null, changed)).toEqual({
      asked: false,
      message: ASK_AGAIN_SOON,
    });
    // Another phone may ask meanwhile.
    expect(consent.ask('d-2', QUESTION, () => null, changed).asked).toBe(true);
    boxes[1]?.answer(false);
    await settle();
    later(ASK_AGAIN_MS);
    expect(consent.ask('d-1', QUESTION, () => null, changed).asked).toBe(true);
    expect(boxes).toHaveLength(3);
  });

  it('says when the computer agreed but the change could not be made then', async () => {
    const { consent, boxes, changed, settle } = setup();
    consent.ask('d-1', QUESTION, () => 'That display is not connected any more.', changed);
    boxes[0]?.answer(true);
    await settle();
    expect(consent.forDevice('d-1')).toEqual({
      state: 'failed',
      message: 'That display is not connected any more.',
    });
    consent.ask(
      'd-2',
      QUESTION,
      () => {
        throw new Error('placeholder failure');
      },
      changed,
    );
    boxes[1]?.answer(true);
    await settle();
    // In plain words on the phone; the error's own text goes to the log only (messages.test.ts).
    expect(consent.forDevice('d-2')).toEqual({
      state: 'failed',
      message: 'Drashti could not make that change: try again, or make it on the Drashti computer.',
    });
  });

  it('keeps how an ask ended for a minute, and how one waits for as long as it waits', async () => {
    const { consent, boxes, changed, later, settle } = setup();
    consent.ask('d-1', QUESTION, () => null, changed);
    later(10 * 60_000);
    expect(consent.forDevice('d-1')?.state).toBe('waiting');
    boxes[0]?.answer(true);
    await settle();
    later(59_000);
    expect(consent.forDevice('d-1')?.state).toBe('agreed');
    later(2000);
    expect(consent.forDevice('d-1')).toBeNull();
  });

  it('is the computer’s own box in Screens’ words, Cancel first and kept to, saying how to get the controls back', () => {
    for (const [platform, key] of [
      ['darwin', '⌘⇧U'],
      ['win32', 'Ctrl+Shift+U'],
    ] as const) {
      const box = coverBox(QUESTION, platform);
      expect(box).toMatchObject({
        type: 'question',
        buttons: ['Cancel', 'Cover the controls'],
        defaultId: 0,
        cancelId: 0,
        message: 'Cover the Drashti controls?',
      });
      expect(box.detail).toBe(
        `Remote “Placeholder phone” asks to put “Main Hall” on Display 1: an output would then cover the Drashti controls on this display completely, so you could not see or click them while it shows. To get them back, press ${key} (Uncover the controls): it works even while Drashti is covered, and turns that output off.`,
      );
    }
  });
});
