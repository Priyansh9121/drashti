import { describe, expect, it } from 'vitest';
import type { SoundState } from '../../shared/stream';
import { MISSING_GRACE_MS, NO_SOUND_MS, NoSoundWatch } from './no-sound';

/*
 * "No sound" with the time given (MED-1, Session 31): 20 s of quiet on what is encoded while on air or
 * recording; an unplugged microphone after a 3 s grace; gone as soon as sound is back; nothing while
 * neither on air nor recording.
 */

/** A stream that the test moves on a second at a time, as the worker's status comes in. */
function stream(watch = new NoSoundWatch()) {
  let now = 1_000_000;
  let quietMs = 0;
  let input: SoundState = 'on';
  let active = true;
  const log: string[] = [];
  const step = (ms: number, quiet: boolean) => {
    now += ms;
    quietMs = quiet ? quietMs + ms : 0;
    const r = watch.update({ active, quietMs, input, now });
    if (r.changed) log.push(r.now ? r.now.why : 'clear');
    return r.now;
  };
  return {
    log,
    step,
    seconds(n: number, quiet: boolean) {
      let last: ReturnType<typeof step> = null;
      for (let i = 0; i < n; i++) last = step(1000, quiet);
      return last;
    },
    set input(v: SoundState) {
      input = v;
    },
    set active(v: boolean) {
      active = v;
    },
    get now() {
      return now;
    },
  };
}

describe('No sound', () => {
  it('is 20 s of quiet by default, and an unplugged microphone’s grace is 3 s', () => {
    expect(NO_SOUND_MS).toBe(20_000);
    expect(MISSING_GRACE_MS).toBe(3000);
  });

  it('shows after 20 s of quiet on air, not before, and goes as soon as a second is loud', () => {
    const s = stream();
    expect(s.seconds(19, true)).toBeNull();
    const shown = s.seconds(1, true);
    expect(shown).toEqual({ since: s.now, why: 'quiet' });
    expect(s.seconds(30, true)).toEqual(shown);
    expect(s.seconds(1, false)).toBeNull();
    expect(s.log).toEqual(['quiet', 'clear']);
  });

  it('says nothing while neither on air nor recording, and starts counting again from there', () => {
    const s = stream();
    s.active = false;
    expect(s.seconds(60, true)).toBeNull();
    s.active = true;
    // The worker's quiet count is what decides: still quiet, so it shows at once.
    expect(s.seconds(1, true)?.why).toBe('quiet');
    s.active = false;
    expect(s.seconds(1, true)).toBeNull();
    expect(s.log).toEqual(['quiet', 'clear']);
  });

  it('shows an unplugged microphone after a 3 s grace, not at once and not after 20 s', () => {
    const s = stream();
    s.seconds(5, false);
    s.input = 'missing';
    expect(s.step(0, false)).toBeNull();
    expect(s.seconds(1, true)).toBeNull();
    expect(s.seconds(1, true)).toBeNull();
    expect(s.seconds(1, true)).toEqual({ since: s.now, why: 'input' });
    // Plugged in again and heard: gone.
    s.input = 'on';
    expect(s.seconds(1, false)).toBeNull();
    expect(s.log).toEqual(['input', 'clear']);
  });

  it('never shows a microphone that was quiet before it was unplugged at once: the grace still counts', () => {
    const s = stream();
    s.seconds(10, true);
    s.input = 'missing';
    expect(s.step(0, true)).toBeNull();
    expect(s.seconds(2, true)).toBeNull();
    expect(s.seconds(1, true)?.why).toBe('input');
  });

  it('takes a microphone the system blocks, or one that would not start, as unplugged', () => {
    for (const input of ['blocked', 'failed'] as const) {
      const s = stream();
      s.input = input;
      expect(s.step(0, true)).toBeNull();
      expect(s.seconds(2, true)).toBeNull();
      expect(s.seconds(1, true)?.why).toBe('input');
    }
  });

  it('stays quiet while Drashti’s own sound is heard with the microphone unplugged', () => {
    const s = stream();
    s.input = 'missing';
    expect(s.seconds(30, false)).toBeNull();
    expect(s.log).toEqual([]);
  });

  it('can be given a shorter time (tests)', () => {
    const s = stream(new NoSoundWatch(4000));
    expect(s.seconds(3, true)).toBeNull();
    expect(s.seconds(1, true)?.why).toBe('quiet');
  });
});
