import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorReports, type ErrorReportsDeps, type Incident } from './service';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const incident = (): Incident => ({
  trigger: 'operator-error',
  code: 'operation-failed',
  computerId: 'c'.repeat(64),
  accessEntryId: 'a'.repeat(32),
  version: '1.0.0-alpha.22',
  platform: 'darwin',
  arch: 'arm64',
  role: 'main',
  counts: { minutes: 10, shows: 2, streams: 0, recordings: 0, imports: 5 },
  events: [{ at: 1000, code: 'operation-failed', count: 1 }],
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-auto-'));
  dirs.push(dir);
  const sent: string[] = [];
  const state = { now: 100_000, owner: true, onAir: false, access: true, received: true };
  const deps: ErrorReportsDeps = {
    dir,
    now: () => state.now,
    owner: () => state.owner,
    onAir: () => state.onAir,
    letIn: () => state.access,
    send: (_config, body) => {
      sent.push(body);
      return Promise.resolve(state.received);
    },
  };
  const service = new ErrorReports(deps);
  const configure = () =>
    service.configure({
      endpoint: 'https://script.google.com/macros/s/placeholder-install/exec',
      installId: 'b'.repeat(32),
      secret: 'd'.repeat(64),
    });
  return { service, deps, configure, sent, state, dir };
}
describe('automatic error reports', () => {
  it('does not reopen its daily allowance if the clock moves backwards', () => {
    const s = setup(); s.state.now += 2 * 86_400_000;
    s.configure(); s.service.enable(true);
    for (let i = 0; i < 10; i++) expect(s.service.capture(incident())).toBe(true);
    s.state.now -= 86_400_000;
    expect(s.service.capture(incident())).toBe(false);
    expect(new ErrorReports(s.deps).capture(incident())).toBe(false);
  });
  it('fails closed on corrupt state instead of silently restoring consent or resetting limits', async () => {
    const s = setup(); s.configure(); s.service.enable(true); s.service.capture(incident());
    writeFileSync(join(s.dir, 'state.json'), '{invalid');
    const restarted = new ErrorReports(s.deps);
    expect(restarted.status()).toEqual({ enabled: false, configured: false, pending: 0, healthy: false });
    expect(restarted.enable(true)).toBe(false);
    expect(restarted.capture(incident())).toBe(false);
    await restarted.wake(); expect(s.sent).toEqual([]);
  });
  it('aborts in-flight work on disable and never resurrects its queue after a late receipt', async () => {
    const s = setup(); s.configure(); s.service.enable(true); s.service.capture(incident());
    let receive: ((received: boolean) => void) | undefined;
    let signal: AbortSignal | undefined;
    s.deps.send = (_config, _body, stop) => { signal = stop; return new Promise(resolve => { receive = resolve; }); };
    const sending = s.service.wake();
    expect(signal?.aborted).toBe(false);
    expect(s.service.enable(false)).toBe(true);
    expect(signal?.aborted).toBe(true);
    if (!receive) throw new Error('The send did not begin');
    receive(true); await sending;
    expect(s.service.status().enabled).toBe(false); expect(s.service.pending()).toBe(0);
    expect(new ErrorReports(s.deps).pending()).toBe(0);
  });

  it('starts off, requires the admin, and never retains incidents without consent', async () => {
    const s = setup();
    expect(s.service.capture(incident())).toBe(false);
    await s.service.wake();
    expect(s.sent).toEqual([]);
    s.state.owner = false;
    expect(s.configure()).toBe(false);
    expect(s.service.enable(true)).toBe(false);
    s.state.owner = true;
    expect(s.configure()).toBe(true);
    expect(s.service.capture(incident())).toBe(false);
    expect(s.service.enable(true)).toBe(true);
    expect(s.service.capture(incident())).toBe(true);
  });
  it('projects only known codes and numeric fields, never arbitrary words', async () => {
    const s = setup();
    s.configure();
    s.service.enable(true);
    const input = {
      ...incident(),
      gmail: 'placeholder@example.com',
      message: 'private content',
      token: 'private token',
      events: [
        { at: 1, code: 'operation-failed', count: 1, text: 'private content' },
        { at: 2, code: 'private content', count: 2 },
      ],
    };
    expect(s.service.capture(input as Incident)).toBe(true);
    await s.service.wake();
    expect(s.sent).toHaveLength(1);
    const body = s.sent[0] ?? '';
    for (const word of ['@', 'private', 'gmail', 'token', 'message', 'text'])
      expect(body).not.toContain(word);
    expect(body).toContain('operation-failed');
    expect(s.service.pending()).toBe(0);
  });
  it('keeps offline reports across restart and defers during stream or recording', async () => {
    const s = setup();
    s.configure();
    s.service.enable(true);
    s.state.received = false;
    expect(s.service.capture(incident())).toBe(true);
    await s.service.wake();
    expect(s.service.pending()).toBe(1);
    const restarted = new ErrorReports(s.deps);
    s.state.received = true;
    s.state.onAir = true;
    await restarted.wake();
    expect(s.sent).toHaveLength(1);
    s.state.onAir = false;
    await restarted.wake();
    expect(s.sent).toHaveLength(2);
    expect(s.sent[0]).toBe(s.sent[1]);
    expect(restarted.pending()).toBe(0);
  });
  it('caps each UTC day even after restart, caps the queue, expires after seven days', () => {
    const s = setup();
    s.configure();
    s.service.enable(true);
    for (let i = 0; i < 10; i++) expect(s.service.capture(incident())).toBe(true);
    expect(new ErrorReports(s.deps).capture(incident())).toBe(false);
    s.state.now += 86_400_000;
    for (let i = 0; i < 10; i++) expect(s.service.capture(incident())).toBe(true);
    s.state.now += 86_400_000;
    expect(s.service.capture(incident())).toBe(false);
    expect(s.service.pending()).toBe(20);
    s.state.now += 7 * 86_400_000;
    expect(s.service.pending()).toBe(0);
    expect(s.service.capture(incident())).toBe(true);
  });
  it('disabling clears queued reports and prevents later sends', async () => {
    const s = setup();
    s.configure();
    s.service.enable(true);
    s.service.capture(incident());
    expect(s.service.enable(false)).toBe(true);
    await s.service.wake();
    expect(s.sent).toEqual([]);
    expect(s.service.pending()).toBe(0);
    expect(readFileSync(join(s.dir, 'state.json'), 'utf8')).not.toContain('operation-failed');
  });
  it('rejects malformed identities and free-form versions', () => {
    const s = setup();
    s.configure();
    s.service.enable(true);
    expect(s.service.capture({ ...incident(), version: 'private content' })).toBe(false);
    expect(s.service.capture({ ...incident(), accessEntryId: 'placeholder@example.com' })).toBe(false);
  });
});
