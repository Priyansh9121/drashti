import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { Role, RolesResult, RolesView } from '../../shared/roles';
import {
  ADMIN_UNLOCK_MS,
  PIN_FIRST_WAIT_MS,
  PIN_FREE_TRIES,
  PIN_LONGEST_WAIT_MS,
  pinChangeSchema,
  pinsSchema,
  waitText,
} from '../../shared/roles';

/*
 * Roles as the main process keeps them (shared/roles.ts). Two PINs, each
 * kept only as a scrypt hash with its own salt, in roles.json in the data
 * folder (never in the library, so never in a backup). Checking a PIN runs
 * scrypt off the main thread (it takes about a tenth of a second, on
 * purpose), so the show never waits for it. Wrong PINs are limited: after
 * PIN_FREE_TRIES in a row nothing is checked for a minute, doubling with
 * each wrong PIN after that up to 15 minutes; the count survives a restart.
 * Log lines never carry a PIN or a hash.
 */

export interface PinHash {
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}

const pinHashSchema: z.ZodType<PinHash> = z.object({
  kdf: z.literal('scrypt'),
  N: z.number().int().min(2),
  r: z.number().int().min(1),
  p: z.number().int().min(1),
  salt: z.string().min(16),
  hash: z.string().min(16),
});

const fileSchema = z.object({
  version: z.literal(1),
  admin: pinHashSchema,
  operator: pinHashSchema,
  wrong: z.number().int().min(0),
  waitUntil: z.number().nullable(),
});
type RolesFile = z.infer<typeof fileSchema>;

/** scrypt's cost: about 32 MB and a tenth of a second here. Tests pass a cheap one. */
export const PIN_COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_BYTES = 32;

export interface RolesDeps {
  /** roles.json in the data folder. */
  file: string;
  now(): number;
  /** The roles changed: the operator window is told. */
  changed(view: RolesView): void;
  log(level: 'info' | 'warn', message: string): void;
  cost?: { N: number; r: number; p: number };
  /** Run `run` after `ms` (setTimeout when left out): admin locks itself when its time is up. */
  schedule?: (ms: number, run: () => void) => () => void;
}

function derive(pin: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      pin,
      salt,
      KEY_BYTES,
      { N: cost.N, r: cost.r, p: cost.p, maxmem: 256 * cost.N * cost.r + 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashPin(pin: string, cost = PIN_COST): Promise<PinHash> {
  const salt = randomBytes(16);
  const key = await derive(pin, salt, cost);
  return { kdf: 'scrypt', ...cost, salt: salt.toString('base64'), hash: key.toString('base64') };
}

export async function pinMatches(pin: string, stored: PinHash): Promise<boolean> {
  const expected = Buffer.from(stored.hash, 'base64');
  const key = await derive(pin, Buffer.from(stored.salt, 'base64'), stored);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export class RolesService {
  private data: RolesFile | null = null;
  /** Admin is unlocked until then (0: locked). */
  private adminUntil = 0;
  /** Locks admin again when its time is up. */
  private cancelExpiry: (() => void) | null = null;

  constructor(private readonly deps: RolesDeps) {
    this.data = this.read();
  }

  private read(): RolesFile | null {
    if (!existsSync(this.deps.file)) return null;
    try {
      return fileSchema.parse(JSON.parse(readFileSync(this.deps.file, 'utf8')));
    } catch {
      this.deps.log('warn', 'Roles: the PIN file cannot be read, so roles are off until PINs are set again');
      return null;
    }
  }

  private write(data: RolesFile): void {
    const temp = `${this.deps.file}.writing`;
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.deps.file);
    this.data = data;
  }

  private get cost() {
    return this.deps.cost ?? PIN_COST;
  }

  on(): boolean {
    return this.data !== null;
  }

  adminUnlocked(): boolean {
    return this.data === null || this.deps.now() < this.adminUntil;
  }

  /** An admin request would be refused now. */
  needsAdmin(): boolean {
    return !this.adminUnlocked();
  }

  view(): RolesView {
    const now = this.deps.now();
    return {
      on: this.data !== null,
      adminUntil: this.data !== null && now < this.adminUntil ? this.adminUntil : null,
      waitUntil: this.data?.waitUntil != null && now < this.data.waitUntil ? this.data.waitUntil : null,
    };
  }

  private changed(): void {
    this.deps.changed(this.view());
  }

  private unlockAdmin(): void {
    this.adminUntil = this.deps.now() + ADMIN_UNLOCK_MS;
    this.armExpiry();
  }

  /** An admin request went through: admin stays unlocked for a while from now. */
  touchAdmin(): void {
    if (this.data === null || this.deps.now() >= this.adminUntil) return;
    const before = this.adminUntil;
    this.adminUntil = this.deps.now() + ADMIN_UNLOCK_MS;
    this.armExpiry();
    // Tell the window only when the end moved noticeably (its countdown starts again).
    if (this.adminUntil - before > 1000) this.changed();
  }

  private armExpiry(): void {
    this.cancelExpiry?.();
    const schedule =
      this.deps.schedule ??
      ((ms: number, run: () => void) => {
        const t = setTimeout(run, ms);
        return () => {
          clearTimeout(t);
        };
      });
    this.cancelExpiry = schedule(Math.max(0, this.adminUntil - this.deps.now()) + 50, () => {
      this.cancelExpiry = null;
      if (this.deps.now() >= this.adminUntil && this.adminUntil !== 0) {
        this.adminUntil = 0;
        this.deps.log('info', 'Roles: admin locked again (its time was up)');
        this.changed();
      }
    });
  }

  /** Lock admin now (Lock, Simple Mode). */
  lock(): RolesView {
    const was = this.adminUntil !== 0;
    this.adminUntil = 0;
    this.cancelExpiry?.();
    this.cancelExpiry = null;
    if (was && this.data !== null) {
      this.deps.log('info', 'Roles: admin locked');
      this.changed();
    }
    return this.view();
  }

  /**
   * Which role a typed PIN is, with wrong PINs limited. Both hashes are
   * checked every time, so the time taken says nothing about which matched.
   */
  private async check(pin: string): Promise<{ role: Role } | { message: string }> {
    const data = this.data;
    if (data === null) return { message: 'No PINs are set.' };
    const now = this.deps.now();
    if (data.waitUntil !== null && now < data.waitUntil)
      return { message: `Too many wrong PINs. Try again in ${waitText(data.waitUntil, now)}.` };
    const typed = typeof pin === 'string' && /^\d{1,32}$/u.test(pin) ? pin : '';
    const [admin, operator] = await Promise.all([
      pinMatches(typed, data.admin),
      pinMatches(typed, data.operator),
    ]);
    // The file may have changed meanwhile (turned off, PINs changed): go by what is kept now.
    const current = this.data;
    if (current === null) return { message: 'No PINs are set.' };
    if (typed !== '' && (admin || operator)) {
      if (current.wrong !== 0 || current.waitUntil !== null)
        this.write({ ...current, wrong: 0, waitUntil: null });
      return { role: admin ? 'admin' : 'operator' };
    }
    const wrong = current.wrong + 1;
    const over = wrong - PIN_FREE_TRIES;
    const waitUntil =
      over >= 0 ? this.deps.now() + Math.min(PIN_LONGEST_WAIT_MS, PIN_FIRST_WAIT_MS * 2 ** over) : null;
    this.write({ ...current, wrong, waitUntil });
    this.deps.log(
      'warn',
      `Roles: a wrong PIN (${String(wrong)} in a row${waitUntil ? '; waiting before the next' : ''})`,
    );
    this.changed();
    return {
      message: waitUntil
        ? `That PIN is not right. Too many wrong PINs: try again in ${waitText(waitUntil, this.deps.now())}.`
        : 'That PIN is not right.',
    };
  }

  /** Leaving Simple Mode: either PIN. The admin PIN unlocks admin too. */
  async enter(pin: string): Promise<{ ok: true; role: Role } | { ok: false; message: string }> {
    const result = await this.check(pin);
    if ('message' in result) return { ok: false, message: result.message };
    if (result.role === 'admin') this.unlockAdmin();
    this.deps.log('info', `Roles: Pro Mode with the ${result.role} PIN`);
    this.changed();
    return { ok: true, role: result.role };
  }

  /** Unlock admin with the admin PIN (an operator PIN unlocks nothing). */
  async unlock(pin: unknown): Promise<RolesResult> {
    if (this.data === null) return { ok: true, view: this.view() };
    const result = await this.check(typeof pin === 'string' ? pin : '');
    if ('message' in result) return { ok: false, message: result.message, view: this.view() };
    if (result.role !== 'admin')
      return {
        ok: false,
        message: 'That is the operator PIN. Admin needs the admin PIN.',
        view: this.view(),
      };
    this.unlockAdmin();
    this.deps.log('info', 'Roles: admin unlocked');
    this.changed();
    return { ok: true, view: this.view() };
  }

  /** Turn roles on with two PINs, or set both again (an admin, or anyone while roles are off). */
  async setPins(raw: unknown): Promise<RolesResult> {
    const parsed = pinsSchema.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? 'Those PINs cannot be used.',
        view: this.view(),
      };
    const [admin, operator] = await Promise.all([
      hashPin(parsed.data.admin, this.cost),
      hashPin(parsed.data.operator, this.cost),
    ]);
    const wasOn = this.data !== null;
    this.write({ version: 1, admin, operator, wrong: 0, waitUntil: null });
    // Whoever set them is the admin: unlocked as for the admin PIN.
    this.unlockAdmin();
    this.deps.log('info', wasOn ? 'Roles: both PINs set again' : 'Roles: turned on (two PINs set)');
    this.changed();
    return { ok: true, view: this.view() };
  }

  /** Change one PIN (an admin): it must differ from the other one. */
  async changePin(raw: unknown): Promise<RolesResult> {
    const data = this.data;
    if (data === null)
      return { ok: false, message: 'Roles are off: set both PINs first.', view: this.view() };
    const parsed = pinChangeSchema.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? 'That PIN cannot be used.',
        view: this.view(),
      };
    const { role, pin } = parsed.data;
    const other = role === 'admin' ? data.operator : data.admin;
    if (await pinMatches(pin, other))
      return { ok: false, message: 'The admin PIN and the operator PIN must differ.', view: this.view() };
    const hash = await hashPin(pin, this.cost);
    const current = this.data ?? data;
    this.write({ ...current, [role]: hash });
    this.deps.log('info', `Roles: the ${role} PIN changed`);
    this.changed();
    return { ok: true, view: this.view() };
  }

  /** Roles off (an admin): both PINs go, and Drashti works as it did before roles. */
  turnOff(): RolesResult {
    rmSync(this.deps.file, { force: true });
    this.data = null;
    this.adminUntil = 0;
    this.cancelExpiry?.();
    this.cancelExpiry = null;
    this.deps.log('info', 'Roles: turned off (both PINs removed)');
    this.changed();
    return { ok: true, view: this.view() };
  }

  dispose(): void {
    this.cancelExpiry?.();
    this.cancelExpiry = null;
  }
}
