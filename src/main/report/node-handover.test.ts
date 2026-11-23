import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccessComputer, AccessGrant } from '../../shared/access-protocol';
import { reportReference, type NodeReportBody, type ReportCallReport } from '../../shared/report';
import type { AccessClient } from '../access/client';
import { ReportService } from './report-service';

/*
 * A node's report (x49, the owner's "Yes, all A" to Q60-42, 2: a node hands its report to the Main it is paired with,
 * which sends it on with its own access, never through the show's feed): Main keeps it in its own outbox as the node's,
 * named as Main knows the node, checks its files against their data, and sends it once, however often the node hands
 * it over. Placeholder words and files only.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MAIN: AccessComputer = {
  id: 'a'.repeat(64),
  name: 'Placeholder Main',
  version: '1.0.0-alpha.20',
  platform: 'darwin',
};
const GRANT: AccessGrant = {
  gmail: 'placeholder.user@example.com',
  grantId: 'b'.repeat(32),
  secret: 'c'.repeat(64),
};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function service(o: { letIn?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-node-reports-'));
  dirs.push(dir);
  const sent: { call: ReportCallReport; data: string }[] = [];
  const client = {
    computer: () => MAIN,
    report: (_grant: AccessGrant, call: ReportCallReport, data: Uint8Array) => {
      sent.push({ call, data: Buffer.from(data).toString('utf8') });
      return Promise.resolve({
        ok: true as const,
        value: { received: true as const, reference: reportReference(call.id), again: false },
        serverTime: Date.now(),
      });
    },
  } as unknown as AccessClient;
  const reports = new ReportService({
    dir,
    dbFile: join(dir, 'none.sqlite'),
    client: () => Promise.resolve(client),
    grant: () => GRANT,
    letIn: () => o.letIn ?? true,
    gmail: () => GRANT.gmail,
    owner: () => false,
    from: () => 'pro',
    onAir: () => false,
    crashFiles: () => [],
    diagnostics: () => Promise.reject(new Error('not asked')),
    logDays: () => [],
    makeFiles: () => Promise.reject(new Error('not asked')),
    now: () => Date.now(),
    setTimer: (ms, run) => {
      const t = setTimeout(run, ms);
      return () => {
        clearTimeout(t);
      };
    },
    notice: () => undefined,
    changed: () => undefined,
    log: () => undefined,
  });
  return { dir, reports, sent };
}

const FILE = Buffer.from('== Drashti diagnostics (node) ==\nPlaceholder\n', 'utf8');

function nodeBody(o: { id?: string; data?: Record<string, string>; bytes?: number } = {}): Buffer {
  const id = o.id ?? randomBytes(16).toString('hex');
  const body: NodeReportBody = {
    v: 1,
    node: { version: '1.0.0-alpha.20', platform: 'win32' },
    report: {
      id,
      written: Date.now(),
      from: 'node',
      node: { name: 'A name the node gives itself', version: '1.0.0-alpha.20', platform: 'win32' },
      features: [
        {
          chapter: 'Screens and screen geometry',
          name: 'A second computer (the node)',
          what: 'Placeholder.',
        },
      ],
      files: [
        {
          kind: 'diagnostics',
          name: 'Drashti diagnostics 2026-11-20 20-00.txt',
          type: 'text/plain',
          bytes: o.bytes ?? FILE.length,
          sha256: sha(FILE),
        },
      ],
    },
    data: o.data ?? { [sha(FILE)]: FILE.toString('base64') },
  };
  return Buffer.from(JSON.stringify(body), 'utf8');
}

const NODE = { id: 'node-1', name: 'Placeholder Stage PC' };

describe('a node’s report on Main', () => {
  it('is kept as the node’s, named as Main knows the node, and sent on once by Main’s outbox', async () => {
    const { dir, reports, sent } = service();
    const id = randomBytes(16).toString('hex');
    expect(await reports.fromNode(NODE, nodeBody({ id }))).toEqual({
      ok: true,
      reference: reportReference(id),
    });
    await expect.poll(() => sent.length).toBe(1);
    const [first] = sent;
    expect(first?.call).toMatchObject({
      id,
      from: 'node',
      node: { name: 'Placeholder Stage PC', version: '1.0.0-alpha.20', platform: 'win32' },
    });
    expect(JSON.parse(first?.data ?? '{}')).toEqual({ [sha(FILE)]: FILE.toString('base64') });
    expect(readFileSync(join(dir, id, 'files', 'Drashti diagnostics 2026-11-20 20-00.txt'))).toEqual(FILE);
    const row = reports.list().find((r) => r.id === id);
    expect(row).toMatchObject({ reference: reportReference(id), features: ['A second computer (the node)'] });
    // Handed over again (the node tried again): the same answer, nothing sent twice.
    expect(await reports.fromNode(NODE, nodeBody({ id }))).toEqual({
      ok: true,
      reference: reportReference(id),
    });
    expect(sent).toHaveLength(1);
  });

  it('is refused, nothing kept, when Main is not let in, or the report is not one, or its files are not their data', async () => {
    const shut = service({ letIn: false });
    expect(await shut.reports.fromNode(NODE, nodeBody())).toMatchObject({ ok: false });
    const { dir, reports, sent } = service();
    for (const body of [
      Buffer.from('not json'),
      Buffer.from(JSON.stringify({ v: 2 })),
      nodeBody({ data: { [sha(FILE)]: Buffer.from('other bytes').toString('base64') } }),
      nodeBody({ data: {} }),
      nodeBody({ bytes: FILE.length + 1 }),
    ])
      expect(await reports.fromNode(NODE, body)).toMatchObject({ ok: false });
    expect(reports.list()).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
    expect(sent).toEqual([]);
  });
});
