import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RolesView } from '../../shared/roles';
import { ADMIN_UNLOCK_MS, PIN_FIRST_WAIT_MS, PIN_FREE_TRIES, PIN_LONGEST_WAIT_MS } from '../../shared/roles';
import { hashPin, pinMatches, RolesService } from './roles-service';

/* Roles and PINs (made-up PINs only; a cheap scrypt cost so the tests are quick). */

const CHEAP = { N: 2 ** 10, r: 8, p: 1 };

function setup(file = join(mkdtempSync(join(tmpdir(), 'drashti-roles-')), 'roles.json')) {
  const clock = { now: 1_000_000 };
  const views: RolesView[] = [];
  const timers: { at: number; run: () => void }[] = [];
  const make = () =>
    new RolesService({
      file,
      now: () => clock.now,
      changed: (v) => views.push(v),
      log: () => undefined,
      cost: CHEAP,
      schedule: (ms, run) => {
        const t = { at: clock.now + ms, run };
        timers.push(t);
        return () => {
          timers.splice(timers.indexOf(t), 1);
        };
      },
    });
  const tick = (ms: number) => {
    clock.now += ms;
    for (const t of [...timers].filter((x) => x.at <= clock.now)) {
      timers.splice(timers.indexOf(t), 1);
      t.run();
    }
  };
  return { file, clock, views, make, tick };
}

describe('PIN hashes', () => {
  it('match the PIN they were made from, and nothing else; each has its own salt', async () => {
    const a = await hashPin('482915', CHEAP);
    const b = await hashPin('482915', CHEAP);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await pinMatches('482915', a)).toBe(true);
    expect(await pinMatches('482916', a)).toBe(false);
    expect(await pinMatches('', a)).toBe(false);
  });
});

describe('roles', () => {
  it('are off until two PINs are set, and then never kept as they were typed', async () => {
    const { file, make } = setup();
    const roles = make();
    expect(roles.on()).toBe(false);
    expect(roles.needsAdmin()).toBe(false);
    expect(roles.view()).toEqual({ on: false, adminUntil: null, waitUntil: null });
    // Bad PINs are refused: letters, too short, the same twice.
    expect((await roles.setPins({ admin: '12ab', operator: '5555' })).ok).toBe(false);
    expect((await roles.setPins({ admin: '123', operator: '5555' })).ok).toBe(false);
    const same = await roles.setPins({ admin: '246810', operator: '246810' });
    expect(same.ok ? '' : same.message).toContain('must differ');
    const set = await roles.setPins({ admin: '246810', operator: '135791' });
    expect(set.ok).toBe(true);
    expect(roles.on()).toBe(true);
    // Whoever set them is the admin, unlocked for a while.
    expect(roles.adminUnlocked()).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('246810');
    expect(text).not.toContain('135791');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0);
    // A new start reads them back, admin locked.
    const again = make();
    expect(again.on()).toBe(true);
    expect(again.needsAdmin()).toBe(true);
  });

  it('leave Simple Mode with either PIN; the admin PIN unlocks admin, the operator PIN does not', async () => {
    const { make } = setup();
    await make().setPins({ admin: '246810', operator: '135791' });
    const roles = make();
    const operator = await roles.enter('135791');
    expect(operator).toEqual({ ok: true, role: 'operator' });
    expect(roles.needsAdmin()).toBe(true);
    const notAdmin = await roles.unlock('135791');
    expect(notAdmin.ok ? '' : notAdmin.message).toContain('operator PIN');
    expect((await roles.unlock('246810')).ok).toBe(true);
    expect(roles.needsAdmin()).toBe(false);
    roles.lock();
    expect(roles.needsAdmin()).toBe(true);
    expect(await roles.enter('246810')).toEqual({ ok: true, role: 'admin' });
    expect(roles.needsAdmin()).toBe(false);
  });

  it('keep admin unlocked for ten minutes after the last admin action, then lock it by themselves', async () => {
    const { make, tick, views } = setup();
    const roles = make();
    await roles.setPins({ admin: '246810', operator: '135791' });
    tick(ADMIN_UNLOCK_MS - 60_000);
    expect(roles.adminUnlocked()).toBe(true);
    // An admin action keeps it open from then on.
    roles.touchAdmin();
    tick(ADMIN_UNLOCK_MS - 1000);
    expect(roles.adminUnlocked()).toBe(true);
    tick(2000);
    expect(roles.adminUnlocked()).toBe(false);
    expect(views.at(-1)?.adminUntil).toBeNull();
    // Touching a locked admin does not unlock it.
    roles.touchAdmin();
    expect(roles.adminUnlocked()).toBe(false);
  });

  it('limit wrong PINs: five free, then a minute, doubling up to fifteen, kept over a restart', async () => {
    const { make, tick } = setup();
    await make().setPins({ admin: '246810', operator: '135791' });
    let roles = make();
    for (let i = 0; i < PIN_FREE_TRIES - 1; i++) expect((await roles.enter('000000')).ok).toBe(false);
    const fifth = await roles.enter('000000');
    expect(fifth.ok ? '' : fifth.message).toContain('Too many wrong PINs');
    expect(roles.view().waitUntil).not.toBeNull();
    // While it waits even the right PIN is not checked, after a restart too.
    roles = make();
    const waiting = await roles.enter('246810');
    expect(waiting.ok ? '' : waiting.message).toContain('Try again in 1:00');
    tick(PIN_FIRST_WAIT_MS);
    // The next wrong one waits twice as long.
    await roles.enter('000000');
    expect((roles.view().waitUntil ?? 0) - 1_000_000 - PIN_FIRST_WAIT_MS).toBe(2 * PIN_FIRST_WAIT_MS);
    // ...up to the longest.
    for (let i = 0; i < 6; i++) {
      tick(PIN_LONGEST_WAIT_MS);
      await roles.enter('000000');
    }
    const before = roles.view().waitUntil ?? 0;
    expect(before - (1_000_000 + PIN_FIRST_WAIT_MS + 6 * PIN_LONGEST_WAIT_MS)).toBe(PIN_LONGEST_WAIT_MS);
    // The right PIN after the wait starts the count again.
    tick(PIN_LONGEST_WAIT_MS);
    expect((await roles.enter('135791')).ok).toBe(true);
    expect(roles.view().waitUntil).toBeNull();
    for (let i = 0; i < PIN_FREE_TRIES - 1; i++) await roles.enter('000000');
    expect(roles.view().waitUntil).toBeNull();
  });

  it('change one PIN (never to the other one), or turn off, which forgets both', async () => {
    const { file, make } = setup();
    const roles = make();
    await roles.setPins({ admin: '246810', operator: '135791' });
    const clash = await roles.changePin({ role: 'operator', pin: '246810' });
    expect(clash.ok ? '' : clash.message).toContain('must differ');
    expect((await roles.changePin({ role: 'operator', pin: '999111' })).ok).toBe(true);
    expect((await make().enter('999111')).ok).toBe(true);
    expect((await make().enter('135791')).ok).toBe(false);
    roles.turnOff();
    expect(roles.on()).toBe(false);
    expect(make().on()).toBe(false);
    expect(() => readFileSync(file)).toThrow();
  });

  it('treat a damaged PIN file as roles off (it can be set again)', async () => {
    const { file, make } = setup();
    await make().setPins({ admin: '246810', operator: '135791' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, '{ not json');
    expect(make().on()).toBe(false);
  });
});
