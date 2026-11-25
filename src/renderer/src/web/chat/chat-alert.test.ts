import { describe, expect, it, vi } from 'vitest';
import { BUZZ_MS, makeAlerts, type AlertPlace } from './chat-alert';

/** Web Audio as far as the chat's sound uses it: what was made, resumed and started, recorded. */
class FakeSound {
  static made: FakeSound[] = [];
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 12;
  destination = { name: 'speaker' };
  resumed = 0;
  started: { at: number; until: number }[] = [];
  silent = 0;
  constructor() {
    FakeSound.made.push(this);
  }
  resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 1 },
      connect: vi.fn(),
    };
  }
  createOscillator() {
    const started = this.started;
    let at = 0;
    return {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: (t: number) => {
        at = t;
      },
      stop: (t: number) => {
        started.push({ at, until: t });
      },
    };
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return {
      buffer: null,
      connect: vi.fn(),
      start: () => {
        this.silent++;
      },
    };
  }
}

/** A phone or computer: its page (for the first tap), whether it vibrates and has a touch screen, and its sound. */
function place(given: { vibrates: boolean; touch: boolean; sound?: boolean }): {
  place: AlertPlace;
  page: EventTarget;
  buzzed: number[][];
} {
  const page = new EventTarget();
  const buzzed: number[][] = [];
  FakeSound.made = [];
  return {
    page,
    buzzed,
    place: {
      target: page,
      vibrate: given.vibrates
        ? (pattern: number[]) => {
            buzzed.push(pattern);
            return true;
          }
        : undefined,
      touchPoints: given.touch ? 5 : 0,
      Sound: given.sound === false ? undefined : (FakeSound as unknown as AlertPlace['Sound']),
    },
  };
}

describe('a new message from someone else: a buzz on Android, a sound on an iPhone, only after a first tap', () => {
  it('does nothing before the person has tapped the page (browsers allow neither): the banner says it', () => {
    const android = place({ vibrates: true, touch: true });
    const alerts = makeAlerts(android.place);
    alerts.arm();
    expect(alerts.alert()).toBe('none');
    expect(android.buzzed).toEqual([]);
    const iphone = place({ vibrates: false, touch: true });
    const quiet = makeAlerts(iphone.place);
    quiet.arm();
    expect(quiet.alert()).toBe('none');
    // No sound is even made before a tap: Safari would keep it silent.
    expect(FakeSound.made).toHaveLength(0);
  });

  it('on an Android phone buzzes a short pattern after the first tap, and makes no sound', () => {
    const android = place({ vibrates: true, touch: true });
    const alerts = makeAlerts(android.place);
    alerts.arm();
    android.page.dispatchEvent(new Event('pointerup'));
    expect(alerts.alert()).toBe('buzz');
    expect(android.buzzed).toEqual([[...BUZZ_MS]]);
    // Short: under half a second in all.
    expect(BUZZ_MS.reduce((a, b) => a + b, 0)).toBeLessThan(500);
    expect(FakeSound.made).toHaveLength(0);
  });

  it('on an iPhone (no vibration for web pages) readies the sound in the first tap itself, then plays a short one', () => {
    const iphone = place({ vibrates: false, touch: true });
    const alerts = makeAlerts(iphone.place);
    alerts.arm();
    iphone.page.dispatchEvent(new Event('touchend'));
    // Made and resumed inside the tap, as Safari requires, with a silent start that unlocks it.
    expect(FakeSound.made).toHaveLength(1);
    const sound = FakeSound.made[0];
    expect(sound?.resumed).toBe(1);
    expect(sound?.silent).toBe(1);
    expect(alerts.alert()).toBe('sound');
    expect(sound?.started).toHaveLength(1);
    const played = sound?.started[0];
    expect(played?.at).toBe(12);
    expect((played?.until ?? 0) - (played?.at ?? 0)).toBeGreaterThan(0.1);
    expect((played?.until ?? 0) - (played?.at ?? 0)).toBeLessThan(0.5);
    // A second tap makes no second sound player.
    iphone.page.dispatchEvent(new Event('click'));
    expect(FakeSound.made).toHaveLength(1);
  });

  it('on a laptop (a vibrate call but no touch screen) plays the sound', () => {
    const laptop = place({ vibrates: true, touch: false });
    const alerts = makeAlerts(laptop.place);
    alerts.arm();
    laptop.page.dispatchEvent(new Event('keydown'));
    expect(alerts.alert()).toBe('sound');
    expect(laptop.buzzed).toEqual([]);
  });

  it('with neither a vibration nor a sound, says none (the banner alone)', () => {
    const bare = place({ vibrates: false, touch: true, sound: false });
    const alerts = makeAlerts(bare.place);
    alerts.arm();
    bare.page.dispatchEvent(new Event('pointerup'));
    expect(alerts.alert()).toBe('none');
  });

  it('a sound the phone paused since (a call, the page put away) is resumed before it plays', () => {
    const iphone = place({ vibrates: false, touch: true });
    const alerts = makeAlerts(iphone.place);
    alerts.arm();
    iphone.page.dispatchEvent(new Event('pointerup'));
    const sound = FakeSound.made[0];
    if (!sound) throw new Error('no sound made');
    sound.state = 'suspended';
    expect(alerts.alert()).toBe('sound');
    expect(sound.resumed).toBe(2);
  });
});
