import { createHmac } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ErrorReports } from './service';
import { reportSchema, ERROR_CODES, EVENT_CODES } from './protocol';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Report {
  diagnosticsInstallId: string | null;
  mode: string;
  osRelease: string;
  id: string;
  at: number;
  trigger: string;
  code: string;
  computerId: string;
  accessEntryId: string;
  version: string;
  platform: string;
  arch: string;
  role: string;
  counts: Record<string, number>;
  dropped: number;
  events: { at: number; code: string; count: number }[];
}
interface ReceiverEnv {
  now(): number;
  secret(id: string): string | null;
  hmac(key: string, text: string): string;
  lock<T>(run: () => T): T;
  rows(install: string): { id: string; received: number }[];
  file(install: string, id: string, text: string): string;
  append(install: string, report: Report, fileId: string): void;
}
interface Receiver {
  handle(env: ReceiverEnv, body: string): { ok: boolean; error?: string; id?: string };
}
function setup() {
  const context: { DrashtiErrors?: Receiver } = {};
  runInNewContext(
    readFileSync(join(__dirname, '../../..', 'access-list/error-reports/core.js'), 'utf8'),
    context,
  );
  const core = context.DrashtiErrors;
  if (!core) throw new Error('Receiver did not load');
  const key = 'd'.repeat(64);
  const install = 'b'.repeat(32);
  const rows: { id: string; received: number }[] = [];
  const files = new Map<string, string>();
  let clock = 100_000;
  const env: ReceiverEnv = {
    now: () => clock,
    secret: (id) => (id === install ? key : null),
    hmac: (k, text) => createHmac('sha256', k).update(text).digest('hex'),
    lock: (run) => run(),
    rows: () => rows,
    file: (_install, id, text) => {
      files.set(id, text);
      return id;
    },
    append: (_install, report) => {
      rows.push({ id: report.id, received: clock });
    },
  };
  const report: Report = {
    id: 'e'.repeat(32),
    at: clock,
    trigger: 'operator-error',
    code: 'operation-failed',
    diagnosticsInstallId: '7K3P-Q2XM-4H9A',
    mode: 'pro',
    osRelease: '10.0.26100',
    computerId: 'c'.repeat(64),
    accessEntryId: 'a'.repeat(32),
    version: '1.0.0-alpha.22',
    platform: 'darwin',
    arch: 'arm64',
    role: 'main',
    counts: { minutes: 0, shows: 0, streams: 0, recordings: 0, imports: 0 },
    dropped: 0,
    events: [{ at: clock, code: 'operation-failed', count: 1 }],
  };
  const body = (r: unknown = report) => {
    const payload = JSON.stringify(r);
    return JSON.stringify({
      v: 1,
      installId: install,
      payload,
      mac: env.hmac(key, 'drashti-errors-v1\n' + install + '\n' + payload),
    });
  };
  return {
    core,
    env,
    report,
    body,
    rows,
    files,
    nextDay: () => {
      clock += 86_400_000;
    },
  };
}
describe('Apps Script error receiver with local services only', () => {
  it('rejects comma-containing counter keys instead of treating them as two required fields', () => {
    const s = setup();
    const report = { ...s.report, counts: { 'imports,minutes': 0, recordings: 0, shows: 0, streams: 0 } };
    expect(reportSchema.safeParse(report).success).toBe(false);
    expect(s.core.handle(s.env, s.body(report))).toEqual({ ok: false, error: 'invalid' });
    expect(s.rows).toHaveLength(0);
    expect(s.files.size).toBe(0);
  });

  it('takes the real sender HMAC and survives a lost receipt without a second row', async () => {
    const s = setup();
    const dir = mkdtempSync(join(tmpdir(), 'drashti-receiver-'));
    let deliveries = 0;
    try {
      const service = new ErrorReports({
        dir,
        now: () => s.env.now(),
        owner: () => true,
        letIn: () => true,
        onAir: () => false,
        send: (_config, body) => {
          deliveries++;
          const receipt = s.core.handle(s.env, body);
          return Promise.resolve(deliveries > 1 && receipt.ok);
        },
      });
      expect(
        service.configure({
          endpoint: 'https://script.google.com/macros/s/placeholder-install/exec',
          installId: 'b'.repeat(32),
          secret: 'd'.repeat(64),
        }),
      ).toBe(true);
      expect(service.enable(true)).toBe(true);
      expect(service.capture(reportSchema.parse(s.report))).toBe(true);
      await service.wake();
      expect(service.pending()).toBe(1);
      await service.wake();
      expect(service.pending()).toBe(0);
      expect(deliveries).toBe(2);
      expect(s.rows).toHaveLength(1);
      expect(s.files.size).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('keeps the sender and receiver machine vocabulary and numeric bounds in agreement', () => {
    for (const code of ERROR_CODES) {
      const s = setup();
      const report = {
        ...s.report,
        code,
        events: EVENT_CODES.map((code) => ({ at: 1, code, count: 1_000_000_000 })),
      };
      expect(reportSchema.safeParse(report).success).toBe(true);
      expect(s.core.handle(s.env, s.body(report)).ok).toBe(true);
    }
    const s = setup();
    for (const report of [
      { ...s.report, dropped: 1_000_000_001 },
      { ...s.report, events: Array.from({ length: 31 }, () => s.report.events[0]) },
      { ...s.report, counts: { ...s.report.counts, imports: -1 } },
    ]) {
      expect(reportSchema.safeParse(report).success).toBe(false);
      expect(s.core.handle(s.env, s.body(report)).ok).toBe(false);
    }
  });

  it('authenticates, writes one row/file, and acknowledges repeated delivery once', () => {
    const s = setup();
    expect(s.core.handle(s.env, s.body())).toEqual({ ok: true, id: s.report.id });
    expect(s.core.handle(s.env, s.body())).toEqual({ ok: true, id: s.report.id });
    expect(s.rows).toHaveLength(1);
    expect(s.files.size).toBe(1);
  });
  it('refuses tampering and unknown installs before storage', () => {
    const s = setup();
    expect(s.core.handle(s.env, s.body().replace('operation-failed', 'stream-failed')).ok).toBe(false);
    expect(s.core.handle(s.env, s.body().replace('b'.repeat(32), 'f'.repeat(32))).ok).toBe(false);
    expect(s.rows).toHaveLength(0);
    expect(s.files.size).toBe(0);
  });
  it('rejects signed free-form content, unknown fields and sheet formulas', () => {
    const s = setup();
    for (const report of [
      { ...s.report, message: 'private content' },
      { ...s.report, version: '=IMPORTDATA("https://example.com")' },
      { ...s.report, events: [{ at: 1, code: 'private content', count: 1 }] },
      { ...s.report, counts: { ...s.report.counts, title: 'private' } },
    ])
      expect(s.core.handle(s.env, s.body(report)).ok).toBe(false);
    expect(s.rows).toHaveLength(0);
    expect(s.files.size).toBe(0);
  });
  it('enforces ten per UTC day, while an old duplicate stays acknowledged', () => {
    const s = setup();
    for (let i = 0; i < 10; i++)
      expect(s.core.handle(s.env, s.body({ ...s.report, id: i.toString(16).padStart(32, '0') })).ok).toBe(
        true,
      );
    expect(s.core.handle(s.env, s.body()).error).toBe('limit');
    s.nextDay();
    expect(s.core.handle(s.env, s.body()).ok).toBe(true);
  });
  it('returns a fixed failure without exposing service exception details', () => {
    const s = setup();
    s.env.file = () => {
      throw new Error('private secret');
    };
    expect(s.core.handle(s.env, s.body())).toEqual({ ok: false, error: 'unavailable' });
    expect(s.rows).toHaveLength(0);
  });
});
