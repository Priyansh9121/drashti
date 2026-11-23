import { describe, expect, it } from 'vitest';
import { ErrorReportRuntime } from './runtime';
import type { Incident, ErrorIdentity } from './protocol';
const identity: ErrorIdentity = {
  diagnosticsInstallId: '7K3P-Q2XM-4H9A',
  mode: 'pro',
  osRelease: '10.0.26100',
  computerId: 'c'.repeat(64),
  accessEntryId: 'a'.repeat(32),
  version: '1.0.0-alpha.22',
  platform: 'win32',
  arch: 'x64',
  role: 'main',
  counts: { minutes: 1, shows: 2, streams: 3, recordings: 4, imports: 5 },
};
describe('automatic reporting event adapter', () => {
  it('records the operator error only as codes and uses an explicit identity/count adapter', () => {
    const captured: Incident[] = [];
    const runtime = new ErrorReportRuntime({
      identity: () => identity,
      capture: (make) => {
        const incident = make();
        if (!incident) return false;
        captured.push(incident);
        return true;
      },
      now: () => 1000,
    });
    runtime.event('import-completed', 5);
    runtime.operatorNotice('Imported 5 pictures.');
    expect(captured).toEqual([]);
    runtime.operatorNotice('Could not import private content from placeholder@example.com');
    expect(captured).toEqual([
      {
        ...identity,
        trigger: 'operator-error',
        code: 'operation-failed',
        events: [
          { at: 1000, code: 'app-started', count: 1 },
          { at: 1000, code: 'import-completed', count: 5 },
          { at: 1000, code: 'operation-failed', count: 1 },
        ],
      },
    ]);
    expect(JSON.stringify(captured)).not.toContain('private');
    expect(JSON.stringify(captured)).not.toContain('@');
  });
  it('captures crashes and a failed stream once per transition, never its message or file', () => {
    const captured: Incident[] = [];
    const runtime = new ErrorReportRuntime({
      identity: () => identity,
      capture: (make) => {
        const incident = make();
        if (!incident) return false;
        captured.push(incident);
        return true;
      },
      now: () => 1000,
    });
    runtime.crash();
    runtime.stream('live', null);
    runtime.stream('reconnecting', 'private key');
    runtime.stream('reconnecting', 'private key');
    expect(captured.map((r) => r.trigger)).toEqual(['crash', 'failed-stream']);
    expect(JSON.stringify(captured)).not.toContain('private');
  });
  it('does not capture without an identified access-list entry and keeps only thirty events', () => {
    const captured: Incident[] = [];
    let present = false;
    const runtime = new ErrorReportRuntime({
      identity: () => (present ? identity : null),
      capture: (make) => {
        const incident = make();
        if (!incident) return false;
        captured.push(incident);
        return true;
      },
      now: () => 1000,
    });
    runtime.crash();
    expect(captured).toEqual([]);
    for (let i = 0; i < 40; i++) runtime.event('show-started', i);
    present = true;
    runtime.crash();
    expect(captured[0]?.events).toHaveLength(30);
    expect(captured[0]?.events[0]?.count).toBe(11);
  });
});
