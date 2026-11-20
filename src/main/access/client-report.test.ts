import { createHash, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { placeholderComputer } from '../../../tests/access-core';
import { accessStandIn, type AccessStandIn } from '../../../tests/access-standin';
import { reportReference, type ReportCallReport } from '../../shared/report';
import {
  ACCESS_CALL_TIMEOUT_MS,
  ACCESS_REPORT_TIMEOUT_MS,
  AccessClient,
  GIVEN_UP,
  nodeTransport,
} from './client';

/*
 * Help › Report a Problem…'s call (x49, client.ts): signed as a check is, over the call without its files' data, which
 * follows it as bytes (the report worker's data.json: each file's base64 by its SHA-256), to the stand-in list on
 * 127.0.0.1 (the list's own rules). No test reaches the internet. Placeholder words and files only.
 */

const PERSON = 'placeholder.user@example.com';
let standIn: AccessStandIn | null = null;

afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function aReport(s: AccessStandIn, file: Buffer, id = randomBytes(16).toString('hex')): ReportCallReport {
  return {
    id,
    written: s.list.t,
    from: 'pro',
    features: [{ chapter: 'Stream', name: 'Going live', what: 'Placeholder words.' }],
    files: [
      {
        kind: 'diagnostics',
        name: 'Drashti diagnostics 2026-11-20 19-42.txt',
        type: 'text/plain',
        bytes: file.length,
        sha256: sha(file),
      },
    ],
  };
}

const dataOf = (file: Buffer) =>
  Buffer.from(JSON.stringify({ [sha(file)]: file.toString('base64') }), 'utf8');

describe('a report’s call', () => {
  it('reaches the list as bytes, signed over the call without its data: received with its reference, the same report again answered again', async () => {
    const s = (standIn = await accessStandIn());
    const computer = placeholderComputer('client-report');
    const grant = s.grant(PERSON, computer);
    const bodies: unknown[] = [];
    const c = new AccessClient({
      url: s.url,
      publicKey: s.publicKey,
      computer,
      local: true,
      transport: (request) => {
        if (request.body !== null) bodies.push(request.body);
        return nodeTransport(request);
      },
    });
    const file = Buffer.from('== Drashti diagnostics ==\nPlaceholder ક line\n', 'utf8');
    const report = aReport(s, file);
    const before = s.list.mailbox.length;
    const r = await c.report(grant, report, dataOf(file));
    expect(r).toMatchObject({
      ok: true,
      value: { received: true, again: false, reference: reportReference(report.id) },
    });
    expect(bodies.at(-1)).toBeInstanceOf(Uint8Array);
    expect(s.list.mailbox[before]?.attachments?.[0]?.base64).toBe(file.toString('base64'));
    expect(await c.report(grant, report, dataOf(file))).toMatchObject({ ok: true, value: { again: true } });
    expect(s.list.mailbox.length).toBe(before + 2);
    expect(s.calls.filter((op) => op === 'report')).toHaveLength(2);
  });

  it('is refused not-in when signed with a way in that is not this computer’s, and given up when stopped', async () => {
    const s = (standIn = await accessStandIn());
    const computer = placeholderComputer('client-report-2');
    const grant = s.grant(PERSON, computer);
    const c = new AccessClient({
      url: s.url,
      publicKey: s.publicKey,
      computer,
      local: true,
      transport: nodeTransport,
    });
    const file = Buffer.from('Placeholder\n');
    expect(
      await c.report({ ...grant, secret: 'c'.repeat(64) }, aReport(s, file), dataOf(file)),
    ).toMatchObject({
      ok: false,
      kind: 'refused',
      error: 'not-in',
    });
    const stop = new AbortController();
    stop.abort();
    expect(await c.report(grant, aReport(s, file), dataOf(file), stop.signal)).toMatchObject({
      ok: false,
      kind: 'no-answer',
      reason: 'network',
      detail: GIVEN_UP,
    });
  });

  it('has a time limit of its own, longer than a check’s: megabytes on a slow line', () => {
    expect(ACCESS_REPORT_TIMEOUT_MS).toBe(5 * 60_000);
    expect(ACCESS_REPORT_TIMEOUT_MS).toBeGreaterThan(ACCESS_CALL_TIMEOUT_MS);
  });
});
