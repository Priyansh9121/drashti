import { EventEmitter } from 'node:events';
import type { Socket } from 'node:dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OSC_SETTINGS } from '../../shared/osc';
import { OscService, parseOscSettings } from './service';
import type { OscAction } from './mapping';

const string = (s: string) => {
  const b = Buffer.from(s + '\0');
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
};
const message = (address = 'next') => Buffer.concat([string('/drashti/' + address), string(',')]);
const bundle = (time: bigint, ...messages: Buffer[]) => {
  const tag = Buffer.alloc(8);
  tag.writeBigUInt64BE(time);
  return Buffer.concat([
    string('#bundle'),
    tag,
    ...messages.flatMap((m) => {
      const b = Buffer.alloc(4);
      b.writeInt32BE(m.length);
      return [b, m];
    }),
  ]);
};
const ntp = (ms: number) =>
  (BigInt(Math.floor(ms / 1000) + 2_208_988_800) << 32n) +
  BigInt(Math.floor(((ms % 1000) * 0x1_0000_0000) / 1000));

class FakeSocket extends EventEmitter {
  bound: [number, string] | null = null;
  closed = false;
  fail = false;
  bind(port: number, address: string, done: () => void) {
    this.bound = [port, address];
    if (this.fail)
      this.emit('error', Object.assign(new Error('private socket detail'), { code: 'EADDRINUSE' }));
    else done();
  }
  close(done?: () => void) {
    this.closed = true;
    done?.();
  }
  unref() {
    return this;
  }
  packet(packet: Buffer, address = '127.0.0.1') {
    this.emit('message', packet, { address, family: 'IPv4', port: 12345, size: packet.length });
  }
}

function setup(saved?: unknown) {
  let letIn = true;
  let pro = true;
  const settings = new Map<string, unknown>([['osc', saved]]);
  const sockets: FakeSocket[] = [];
  const actions: OscAction[] = [];
  const logs: string[] = [];
  let fail = false;
  let runFault = false;
  const service = new OscService({
    settings: {
      get: (k) => settings.get(k),
      set: (k, v) => {
        settings.set(k, v);
      },
    },
    letIn: () => letIn,
    canConfigure: () => pro,
    run: (action) => {
      if (runFault) throw new Error('Placeholder fault detail');
      actions.push(action);
      return true;
    },
    changed: () => undefined,
    log: (_level, message) => {
      logs.push(message);
    },
    now: Date.now,
    createSocket: () => {
      const socket = new FakeSocket();
      socket.fail = fail;
      sockets.push(socket);
      return socket as unknown as Socket;
    },
  });
  return {
    service,
    settings,
    sockets,
    actions,
    logs,
    enable: (senders = ['127.0.0.1']) => service.configure({ enabled: true, port: 9000, senders }),
    access: (on: boolean) => {
      letIn = on;
    },
    pro: (on: boolean) => {
      pro = on;
    },
    fail: () => {
      fail = true;
    },
    fault: () => {
      runFault = true;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OSC settings and UDP lifecycle', () => {
  it('validates exact local IPv4 addresses, port and the bounded sender list', () => {
    expect(parseOscSettings(DEFAULT_OSC_SETTINGS)).toEqual(DEFAULT_OSC_SETTINGS);
    expect(
      parseOscSettings({ enabled: true, port: 65535, senders: [' 192.168.1.20 ', '127.0.0.1'] }),
    ).toEqual({ enabled: true, port: 65535, senders: ['192.168.1.20', '127.0.0.1'] });
    for (const raw of [
      null,
      {},
      { ...DEFAULT_OSC_SETTINGS, enabled: 'yes' },
      ...[0, 1023, 65536, 9000.5].map((port) => ({ ...DEFAULT_OSC_SETTINGS, port })),
      ...[
        [],
        ['8.8.8.8'],
        ['0.0.0.0'],
        ['255.255.255.255'],
        ['localhost'],
        ['192.168.1.0/24'],
        ['::1'],
        ['127.0.0.1', '127.0.0.1'],
        Array.from({ length: 33 }, (_, i) => '10.0.0.' + String(i + 1)),
      ].map((senders) => ({ ...DEFAULT_OSC_SETTINGS, senders })),
      { ...DEFAULT_OSC_SETTINGS, extra: true },
    ])
      expect(parseOscSettings(raw)).toBeNull();
  });

  it('creates no socket with nothing saved, off saved, or corrupt settings', async () => {
    for (const saved of [
      undefined,
      DEFAULT_OSC_SETTINGS,
      { enabled: true, port: 'bad', senders: ['127.0.0.1'] },
    ]) {
      const t = setup(saved);
      await t.service.resume();
      expect(t.sockets).toHaveLength(0);
      expect(t.service.status().state).toBe('off');
      await t.service.close();
    }
  });

  it('binds loopback only by default, remembers explicit enable, and releases the socket on disable', async () => {
    const t = setup();
    expect((await t.enable()).ok).toBe(true);
    expect(t.sockets[0]?.bound).toEqual([9000, '127.0.0.1']);
    expect(t.service.status().state).toBe('listening');
    expect(t.settings.get('osc')).toEqual({ ...DEFAULT_OSC_SETTINGS, enabled: true });
    expect((await t.service.configure(DEFAULT_OSC_SETTINGS)).ok).toBe(true);
    expect(t.sockets[0]?.closed).toBe(true);
    t.sockets[0]?.packet(message());
    expect(t.actions).toHaveLength(0);
    expect(t.service.status().state).toBe('off');
    await t.service.close();
  });

  it('resumes an explicitly enabled setting and binds LAN only for an explicitly listed LAN sender', async () => {
    const t = setup({ ...DEFAULT_OSC_SETTINGS, enabled: true, senders: ['192.168.1.20'] });
    await t.service.resume();
    expect(t.sockets[0]?.bound).toEqual([9000, '0.0.0.0']);
    t.sockets[0]?.packet(message());
    expect(t.actions).toHaveLength(0);
    t.sockets[0]?.packet(message(), '192.168.1.20');
    expect(t.actions).toHaveLength(1);
    t.sockets[0]?.packet(message(), '8.8.8.8');
    expect(t.actions).toHaveLength(1);
    await t.service.close();
  });

  it('uses a fresh socket for a changed port/list, never accepts a packet from the old socket', async () => {
    const t = setup();
    await t.enable();
    await t.service.configure({ enabled: true, port: 9001, senders: ['10.0.0.2'] });
    expect(t.sockets[0]?.closed).toBe(true);
    expect(t.sockets[1]?.bound).toEqual([9001, '0.0.0.0']);
    t.sockets[0]?.packet(message());
    t.sockets[1]?.packet(message());
    expect(t.actions).toHaveLength(0);
    t.sockets[1]?.packet(message(), '10.0.0.2');
    expect(t.actions).toHaveLength(1);
    await t.service.close();
  });

  it('refuses setup outside Pro Mode or without access, and stops listening while access is removed', async () => {
    const t = setup();
    t.pro(false);
    expect((await t.enable()).ok).toBe(false);
    expect(t.sockets).toHaveLength(0);
    t.pro(true);
    t.access(false);
    expect((await t.enable()).ok).toBe(false);
    expect(t.sockets).toHaveLength(0);
    t.access(true);
    await t.enable();
    t.access(false);
    t.sockets[0]?.packet(message());
    expect(t.actions).toHaveLength(0);
    await t.service.accessChanged();
    expect(t.sockets[0]?.closed).toBe(true);
    t.access(true);
    await t.service.accessChanged();
    expect(t.service.status().state).toBe('listening');
    await t.service.close();
  });

  it('handles a taken port and later socket errors without leaking error details or switching ports', async () => {
    const t = setup();
    t.fail();
    expect((await t.enable()).ok).toBe(false);
    expect(t.service.status().state).toBe('failed');
    expect(t.service.status().message).toMatch(/port.*use/iu);
    expect(t.sockets).toHaveLength(1);
    expect(t.sockets[0]?.closed).toBe(true);
    expect(JSON.stringify(t.service.status()) + t.logs.join('')).not.toContain('private socket detail');
    await t.service.close();
    const u = setup();
    await u.enable();
    u.sockets[0]?.emit('error', new Error('private socket detail'));
    expect(u.service.status().state).toBe('failed');
    expect(u.sockets[0]?.closed).toBe(true);
    await u.service.close();
  });
});

describe('OSC retry and clock safety', () => {
  it('leaves a failed port closed on an unchanged access notification until explicitly configured again', async () => {
    const t = setup();
    t.fail();
    expect((await t.enable()).ok).toBe(false);
    expect(t.sockets).toHaveLength(1);
    await t.service.accessChanged();
    expect(t.sockets).toHaveLength(1);
    expect(t.service.status().state).toBe('failed');
    await t.service.close();
  });

  it('keeps the next wake within one minute if the computer clock moves far backwards', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.enable();
    t.sockets[0]?.packet(bundle(ntp(Date.now() + 2000), message()));
    vi.setSystemTime(Date.now() - 0x1_0000_0000);
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    vi.advanceTimersByTime(2000);
    expect(t.actions).toHaveLength(0);
    expect(scheduled.mock.calls.length).toBeGreaterThan(0);
    expect(scheduled.mock.calls.every((call) => typeof call[1] !== 'number' || call[1] <= 60_000)).toBe(true);
    scheduled.mockRestore();
    await t.service.close();
  });
});

describe('OSC ingress and action bounds', () => {
  it('accepts a complete bundle again after enough allowance returns, without partially spending refused bundles', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.enable();
    const thirtyTwo = bundle(1n, ...Array.from({ length: 32 }, () => message()));
    t.sockets[0]?.packet(thirtyTwo);
    expect(t.actions).toHaveLength(32);
    vi.advanceTimersByTime(1000);
    t.sockets[0]?.packet(thirtyTwo);
    expect(t.actions).toHaveLength(32);
    vi.advanceTimersByTime(1000);
    t.sockets[0]?.packet(thirtyTwo);
    expect(t.actions).toHaveLength(64);
    await t.service.close();
  });

  it('refuses an exhausted sender before spending the shared quota needed by another console', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.enable(['10.0.0.1', '10.0.0.2']);
    for (let n = 0; n < 40; n++) t.sockets[0]?.packet(message(), '10.0.0.1');
    expect(t.actions).toHaveLength(40);
    for (let n = 0; n < 100; n++) t.sockets[0]?.packet(message(), '10.0.0.1');
    t.sockets[0]?.packet(message(), '10.0.0.2');
    expect(t.actions).toHaveLength(41);
    await t.service.close();
  });

  it('limits actions at execution too, so queued bundles cannot double the burst when due', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.enable();
    const twenty = () => bundle(ntp(Date.now() + 2000), ...Array.from({ length: 20 }, () => message()));
    t.sockets[0]?.packet(twenty());
    t.sockets[0]?.packet(twenty());
    expect(t.service.status().pending).toBe(40);
    vi.advanceTimersByTime(2000);
    expect(t.actions).toHaveLength(40);
    t.sockets[0]?.packet(bundle(1n, ...Array.from({ length: 20 }, () => message())));
    expect(t.actions).toHaveLength(40);
    expect(t.service.status().dropped).toBe(1);
    await t.service.close();
    const u = setup();
    await u.enable(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
    const future = bundle(ntp(Date.now() + 2000), ...Array.from({ length: 32 }, () => message()));
    u.sockets[0]?.packet(future, '10.0.0.1');
    u.sockets[0]?.packet(future, '10.0.0.2');
    vi.advanceTimersByTime(2000);
    expect(u.actions).toHaveLength(64);
    u.sockets[0]?.packet(bundle(1n, ...Array.from({ length: 20 }, () => message())), '10.0.0.3');
    expect(u.actions).toHaveLength(64);
    expect(u.service.status().dropped).toBe(1);
    await u.service.close();
  });

  it('caps the future queue even when a sender keeps its action rate within the allowance', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.enable();
    const thirtyTwo = () => bundle(ntp(Date.now() + 30_000), ...Array.from({ length: 32 }, () => message()));
    t.sockets[0]?.packet(thirtyTwo());
    vi.advanceTimersByTime(2000);
    t.sockets[0]?.packet(thirtyTwo());
    expect(t.service.status().pending).toBe(64);
    t.sockets[0]?.packet(bundle(ntp(Date.now() + 30_000), message()));
    expect(t.service.status().pending).toBe(64);
    expect(t.service.status().dropped).toBe(1);
    expect(t.actions).toHaveLength(0);
    await t.service.close();
  });

  it('catches an action fault, keeps listening and never logs supplied error details or message content', async () => {
    const t = setup();
    await t.enable();
    t.fault();
    const stage = Buffer.concat([
      string('/drashti/stage-message'),
      string(',s'),
      string('Placeholder private call'),
    ]);
    expect(() => t.sockets[0]?.packet(stage)).not.toThrow();
    expect(t.service.status()).toMatchObject({ state: 'listening', dropped: 1, actions: 0 });
    expect(t.logs.join('')).not.toMatch(/Placeholder private call|Placeholder fault detail|127\.0\.0\.1/u);
    await t.service.close();
  });

  it('validates a whole bundle before any action and routes valid actions in wire order', async () => {
    const t = setup();
    await t.enable();
    t.sockets[0]?.packet(bundle(1n, message(), message('unknown')));
    expect(t.actions).toEqual([]);
    t.sockets[0]?.packet(bundle(1n, message(), message('back')));
    expect(t.actions.map((a) => a.args)).toEqual([{ type: 'next' }, { type: 'back' }]);
    t.sockets[0]?.packet(Buffer.alloc(65507));
    t.sockets[0]?.packet(Buffer.from('invalid'));
    expect(t.actions).toHaveLength(2);
    expect(t.service.status().dropped).toBe(3);
    await t.service.close();
  });

  it('charges each action in a bundle, rejects a whole over-budget bundle, and bounds the global rate', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.enable();
    const twenty = bundle(1n, ...Array.from({ length: 20 }, () => message()));
    t.sockets[0]?.packet(twenty);
    t.sockets[0]?.packet(twenty);
    t.sockets[0]?.packet(twenty);
    expect(t.actions).toHaveLength(40);
    vi.advanceTimersByTime(1000);
    t.sockets[0]?.packet(message());
    expect(t.actions).toHaveLength(41);
    await t.service.close();
    const u = setup();
    await u.enable(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
    for (const sender of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
      u.sockets[0]?.packet(twenty, sender);
      u.sockets[0]?.packet(twenty, sender);
    }
    expect(u.actions).toHaveLength(80);
    await u.service.close();
  });

  it('bounds malformed packet ingress and never logs message content or sender addresses', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.enable();
    for (let i = 0; i < 250; i++) t.sockets[0]?.packet(Buffer.alloc(4));
    t.sockets[0]?.packet(message());
    expect(t.actions).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    t.sockets[0]?.packet(message());
    expect(t.actions).toHaveLength(1);
    expect(t.logs.join('')).not.toMatch(/127\.0\.0\.1|drashti\/next|invalid/iu);
    await t.service.close();
  });

  it('schedules future bundles without early actions, with bounded queue and horizon, canceled on reconfigure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T00:00:00Z'));
    const t = setup();
    await t.enable();
    const future = ntp(Date.now() + 2000);
    t.sockets[0]?.packet(bundle(future, message(), message('back')));
    expect(t.actions).toHaveLength(0);
    expect(t.service.status().pending).toBe(2);
    vi.advanceTimersByTime(1999);
    expect(t.actions).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(t.actions.map((a) => a.args)).toEqual([{ type: 'next' }, { type: 'back' }]);
    t.sockets[0]?.packet(bundle(ntp(Date.now() + 61000), message()));
    expect(t.service.status().pending).toBe(0);
    t.sockets[0]?.packet(bundle(ntp(Date.now() + 2000), message()));
    expect(t.service.status().pending).toBe(1);
    await t.service.configure(DEFAULT_OSC_SETTINGS);
    vi.advanceTimersByTime(3000);
    expect(t.actions).toHaveLength(2);
    expect(t.service.status().pending).toBe(0);
    await t.service.close();
  });

  it('rechecks access at execution', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.enable();
    t.sockets[0]?.packet(bundle(ntp(Date.now() + 2000), message()));
    t.access(false);
    vi.advanceTimersByTime(2001);
    expect(t.actions).toHaveLength(0);
    await t.service.close();
  });
});
