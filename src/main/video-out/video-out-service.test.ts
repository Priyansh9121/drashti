import type { MessagePortMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { VideoOutSettings, VideoOutStatus } from '../../shared/video-out';
import type { FromVideoOutWorker, ToVideoOutWorker, VideoOutSender } from './protocol';
import type { VideoOutWorker } from './spawn';
import {
  NAME_MESSAGE,
  RESTART_MS,
  RESTARTS,
  STOP_KILL_MS,
  STOPPED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  VideoOutService,
} from './video-out-service';

/*
 * Video out's setting and its process in the main process (x30), with the stream's page, the process and the clock
 * stood in for. Nothing here sends a picture anywhere.
 */

const STAND_IN: VideoOutSender = { way: 'stand-in', file: 'seen.json' };

class FakeWorker implements VideoOutWorker {
  readonly sent: ToVideoOutWorker[] = [];
  readonly ports: MessagePortMain[] = [];
  readonly kill = vi.fn();
  private message: ((m: FromVideoOutWorker) => void) | null = null;
  private exit: ((code: number) => void) | null = null;

  send(message: ToVideoOutWorker): void {
    this.sent.push(message);
  }
  sendFrames(port: MessagePortMain): void {
    this.ports.push(port);
  }
  onMessage(listener: (m: FromVideoOutWorker) => void): void {
    this.message = listener;
  }
  onExit(listener: (code: number) => void): void {
    this.exit = listener;
  }
  say(m: FromVideoOutWorker): void {
    this.message?.(m);
  }
  ends(code = 1): void {
    this.exit?.(code);
  }
}

/** A stand-in port, and its close as a spy of its own. */
function fakePort() {
  const close = vi.fn();
  return { port: { close } as unknown as MessagePortMain, close };
}

function rig({
  kept,
  sender = STAND_IN,
  ready = true,
}: { kept?: unknown; sender?: VideoOutSender | null; ready?: boolean } = {}) {
  let stored: unknown = kept;
  const workers: FakeWorker[] = [];
  const holds: boolean[] = [];
  const paired: MessagePortMain[] = [];
  const channels: {
    port1: MessagePortMain;
    port2: MessagePortMain;
    close1: ReturnType<typeof vi.fn>;
    close2: ReturnType<typeof vi.fn>;
  }[] = [];
  const said: VideoOutStatus[] = [];
  const timers: { run: () => void; ms: number; at: number }[] = [];
  const page = { ready };
  let now = 1_000_000;
  const service = new VideoOutService({
    readSetting: () => stored,
    writeSetting: (value: VideoOutSettings) => {
      stored = value;
    },
    sender: () => sender,
    holdProgram: (on) => {
      holds.push(on);
    },
    pairProgram: (port) => {
      if (!page.ready) return false;
      paired.push(port);
      return true;
    },
    channel: () => {
      const a = fakePort();
      const b = fakePort();
      channels.push({ port1: a.port, port2: b.port, close1: a.close, close2: b.close });
      return { port1: a.port, port2: b.port };
    },
    spawnWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    log: vi.fn(),
    changed: (status) => {
      said.push(status);
    },
    now: () => now,
    later: (run, ms) => {
      timers.push({ run, ms, at: now });
    },
  });
  /** Run the timers due by `ms` from now. */
  const pass = (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at + t.ms <= now);
    for (const t of due) timers.splice(timers.indexOf(t), 1);
    for (const t of due) t.run();
  };
  return { service, workers, holds, paired, channels, said, timers, page, pass, stored: () => stored };
}

const frames = (n: number, width = 1920, height = 1080): FromVideoOutWorker => ({
  type: 'status',
  status: { frames: n, dropped: 0, size: { width, height }, error: null },
});

describe('video out is off until someone turns it on (x30)', () => {
  it('starts with nothing kept: off, named Drashti, no process, nothing held or paired', () => {
    const r = rig();
    r.service.start();
    expect(r.service.status()).toEqual({
      settings: { on: false, name: 'Drashti' },
      state: 'off',
      way: 'stand-in',
      frames: 0,
      size: null,
      message: null,
    });
    expect(r.workers).toHaveLength(0);
    expect(r.holds).not.toContain(true);
    expect(r.paired).toHaveLength(0);
  });

  it('reads a kept setting it cannot understand as off', () => {
    for (const kept of [{ on: 'yes' }, { on: true, name: '' }, { on: true, name: 'a/b' }, 'on', 7, null]) {
      const r = rig({ kept });
      r.service.start();
      expect(r.service.status().state, JSON.stringify(kept)).toBe('off');
      expect(r.workers).toHaveLength(0);
    }
  });

  it('refuses a name other software could not show, changing nothing', () => {
    const r = rig();
    r.service.start();
    for (const name of ['', '   ', 'a/b', 'Hall #1', ' x'.repeat(30), '-Drashti']) {
      expect(r.service.set({ on: true, name })).toEqual({ ok: false, message: NAME_MESSAGE });
    }
    expect(r.workers).toHaveLength(0);
    expect(r.stored()).toBeUndefined();
    // Letters of any script with their vowel signs, digits, spaces and a few marks are fine.
    expect(r.service.set({ on: false, name: 'દ્રષ્ટિ Hall (2)' }).ok).toBe(true);
  });
});

describe('turned on, video out sends the stream’s picture from its own process (x30)', () => {
  it('keeps the stream’s page open, starts the process with this computer’s way and the name, and pairs a port', () => {
    const r = rig();
    r.service.start();
    const result = r.service.set({ on: true, name: 'Hall' });
    expect(result).toMatchObject({
      ok: true,
      status: { state: 'starting', settings: { on: true, name: 'Hall' } },
    });
    expect(r.stored()).toEqual({ on: true, name: 'Hall' });
    expect(r.holds.at(-1)).toBe(true);
    expect(r.workers).toHaveLength(1);
    const w = r.workers[0];
    expect(w?.sent).toEqual([{ type: 'start', sender: STAND_IN, name: 'Hall' }]);
    // One port to the stream's page, its pair to the process.
    expect(r.channels).toHaveLength(1);
    expect(r.paired).toEqual([r.channels[0]?.port2]);
    expect(w?.ports).toEqual([r.channels[0]?.port1]);
    // The first frames out: sending, at their size.
    w?.say(frames(3));
    expect(r.service.status()).toMatchObject({
      state: 'sending',
      frames: 3,
      size: { width: 1920, height: 1080 },
    });
  });

  it('pairs the stream’s page when it is ready, and again each time it loads', () => {
    const r = rig({ ready: false });
    r.service.start();
    r.service.set({ on: true, name: 'Drashti' });
    // Not ready: the pair let go at once, nothing handed to the process.
    expect(r.channels[0]?.close1).toHaveBeenCalled();
    expect(r.channels[0]?.close2).toHaveBeenCalled();
    expect(r.workers[0]?.ports).toEqual([]);
    r.page.ready = true;
    r.service.programChanged();
    expect(r.paired).toEqual([r.channels[1]?.port2]);
    expect(r.workers[0]?.ports).toEqual([r.channels[1]?.port1]);
    // The page loaded again (after a crash): a new port, the same process.
    r.service.programChanged();
    expect(r.workers).toHaveLength(1);
    expect(r.workers[0]?.ports).toEqual([r.channels[1]?.port1, r.channels[2]?.port1]);
  });

  it('is on again after a restart when it was left on, and pairs nothing while off', () => {
    const first = rig();
    first.service.start();
    first.service.set({ on: true, name: 'Hall' });
    const again = rig({ kept: first.stored() });
    again.service.start();
    expect(again.workers).toHaveLength(1);
    expect(again.workers[0]?.sent[0]).toEqual({ type: 'start', sender: STAND_IN, name: 'Hall' });
    const off = rig({ kept: { on: false, name: 'Hall' } });
    off.service.start();
    off.service.programChanged();
    expect(off.workers).toHaveLength(0);
    expect(off.channels).toHaveLength(0);
  });

  it('starts afresh under a new name, the stream’s page held all along (never let go and opened again)', () => {
    const r = rig();
    r.service.set({ on: true, name: 'Hall' });
    const held = r.holds.length;
    r.service.set({ on: true, name: 'Sabha hall' });
    expect(r.workers).toHaveLength(2);
    expect(r.workers[0]?.sent.at(-1)).toEqual({ type: 'stop' });
    expect(r.workers[1]?.sent).toEqual([{ type: 'start', sender: STAND_IN, name: 'Sabha hall' }]);
    expect(r.holds.slice(held)).not.toContain(false);
    expect(r.paired).toHaveLength(2);
  });

  it('says to the operator window when what it shows changes, not for each frame counted', () => {
    const r = rig();
    r.service.start();
    r.service.set({ on: true, name: 'Drashti' });
    const before = r.said.length;
    r.workers[0]?.say(frames(1));
    expect(r.said).toHaveLength(before + 1);
    r.workers[0]?.say(frames(31));
    r.workers[0]?.say(frames(61));
    expect(r.said).toHaveLength(before + 1);
    r.workers[0]?.say(frames(62, 1280, 720));
    expect(r.said).toHaveLength(before + 2);
    expect(r.said.at(-1)).toMatchObject({ state: 'sending', size: { width: 1280, height: 720 } });
  });
});

describe('turned off, nothing of video out is left (x30)', () => {
  it('asks the process to stop, ends it if it has not gone, lets the stream’s page go and keeps the setting off', () => {
    const r = rig();
    r.service.set({ on: true, name: 'Drashti' });
    const w = r.workers[0];
    w?.say(frames(5));
    const result = r.service.set({ on: false, name: 'Drashti' });
    expect(result).toMatchObject({ ok: true, status: { state: 'off', frames: 0, size: null } });
    expect(w?.sent.at(-1)).toEqual({ type: 'stop' });
    expect(w?.kill).not.toHaveBeenCalled();
    r.pass(STOP_KILL_MS);
    expect(w?.kill).toHaveBeenCalledOnce();
    expect(r.holds.at(-1)).toBe(false);
    expect(r.stored()).toEqual({ on: false, name: 'Drashti' });
    // What the old process says or does after is not heard.
    w?.say(frames(9));
    w?.ends(0);
    r.pass(RESTART_MS);
    expect(r.service.status().state).toBe('off');
    expect(r.workers).toHaveLength(1);
  });

  it('stops everything as Drashti quits, keeping the setting as it is', () => {
    const r = rig();
    r.service.set({ on: true, name: 'Drashti' });
    r.service.close();
    expect(r.workers[0]?.sent.at(-1)).toEqual({ type: 'stop' });
    expect(r.holds.at(-1)).toBe(false);
    expect(r.stored()).toEqual({ on: true, name: 'Drashti' });
    r.workers[0]?.ends(0);
    r.pass(RESTART_MS);
    expect(r.workers).toHaveLength(1);
  });
});

describe('a video-out process that ends while on (x30)', () => {
  it('is started again after a pause, at most RESTARTS a minute, then stays stopped until turned off and on', () => {
    const r = rig();
    r.service.set({ on: true, name: 'Drashti' });
    for (let i = 0; i < RESTARTS; i++) {
      r.workers.at(-1)?.ends(1);
      expect(r.workers).toHaveLength(i + 1);
      r.pass(RESTART_MS);
      expect(r.workers).toHaveLength(i + 2);
      expect(r.holds.at(-1)).toBe(true);
    }
    r.workers.at(-1)?.ends(1);
    r.pass(RESTART_MS);
    expect(r.workers).toHaveLength(RESTARTS + 1);
    expect(r.service.status()).toMatchObject({ state: 'stopped', message: STOPPED_MESSAGE });
    expect(r.holds.at(-1)).toBe(false);
    // Turned off and on again: it tries afresh.
    r.service.set({ on: false, name: 'Drashti' });
    r.service.set({ on: true, name: 'Drashti' });
    expect(r.workers).toHaveLength(RESTARTS + 2);
    expect(r.service.status().state).toBe('starting');
  });
});

describe('a computer with no way to send (x30)', () => {
  it('keeps the setting but starts nothing, saying so', () => {
    const r = rig({ sender: null });
    r.service.start();
    expect(r.service.status()).toMatchObject({ state: 'off', way: null });
    expect(r.service.set({ on: true, name: 'Drashti' })).toMatchObject({
      ok: true,
      status: { state: 'unavailable', way: null, message: UNAVAILABLE_MESSAGE },
    });
    expect(r.workers).toHaveLength(0);
    expect(r.holds).not.toContain(true);
  });
});
