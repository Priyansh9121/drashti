import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNativeFeedback, readNativeTraceFile } from '../../../tests/e2e/display-presentation-feedback';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const before = { name: 'before', wallAt: 10_000 };
const after = { name: 'after', wallAt: 20_000 };
const trace = (
  frames: { nativeUs: number; state?: string; pid?: number; missing?: boolean }[],
): Parameters<typeof readNativeFeedback>[0] => {
  const traceEvents: Parameters<typeof readNativeFeedback>[0]['traceEvents'] = [
    { name: 'before', pid: 7, ph: 'I', ts: 0 },
    { name: 'after', pid: 7, ph: 'I', ts: 10_000_000 },
  ];
  for (const [index, frame] of frames.entries()) {
    const id2 = { local: String(index) };
    const pid = frame.pid ?? 7;
    traceEvents.push({
      name: 'PipelineReporter',
      ph: 'b',
      pid,
      id2,
      ts: frame.nativeUs - 10_000,
      args: {
        frame_reporter: {
          state: frame.state ?? 'STATE_PRESENTED_ALL',
          layer_tree_host_id: 1,
          has_missing_content: frame.missing ?? false,
        },
      },
    });
    traceEvents.push({ name: 'PipelineReporter', ph: 'e', pid, id2, ts: frame.nativeUs });
  }
  return {
    traceEvents,
    metadata: { trace_processor_stats: { traced_buf: [{ data_loss_overwrite: 0, chunks_discarded: 0 }] } },
  };
};

const normal = [1_000_000, 1_016_667, 1_033_333, 1_050_000].map((nativeUs) => ({ nativeUs }));

it('reads presented-frame endpoints at exact native microseconds', () => {
  const result = readNativeFeedback(trace(normal), 7, before, after);
  expect(result.nativeTimesUs).toEqual(normal.map((r) => r.nativeUs));
  expect(result.frames[0]).toBe(11_000);
  expect(result.frames.at(-1)).toBe(11_050);
  expect(result.anchorOffsetMs).toBe(10_000);
  expect(result.anchorSpreadMs).toBe(0);
});

it('retains a real150ms native presentation stall', () => {
  const result = readNativeFeedback(
    trace([...normal.slice(0, 3), { nativeUs: 1_183_333 }]),
    7,
    before,
    after,
  );
  const gaps = result.nativeTimesUs.slice(1).map((t, i) => t - (result.nativeTimesUs[i] ?? Number.NaN));
  expect(Math.max(...gaps)).toBe(150_000);
});

it('does not fill a presentation gap with dropped or no-update reporters', () => {
  const result = readNativeFeedback(
    trace([
      ...normal.slice(0, 3),
      { nativeUs: 1_050_000, state: 'STATE_DROPPED' },
      { nativeUs: 1_066_667, state: 'STATE_NO_UPDATE_DESIRED' },
      { nativeUs: 1_183_333 },
    ]),
    7,
    before,
    after,
  );
  expect(result.nativeTimesUs).toEqual([1_000_000, 1_016_667, 1_033_333, 1_183_333]);
});

it('keeps partial and missing-content evidence while deduplicating only exact native instants', () => {
  const result = readNativeFeedback(
    trace([
      ...normal,
      { nativeUs: 1_050_000, state: 'STATE_PRESENTED_PARTIAL', missing: true },
      { nativeUs: 1_050_001 },
    ]),
    7,
    before,
    after,
  );
  expect(result.nativeTimesUs).toEqual([1_000_000, 1_016_667, 1_033_333, 1_050_000, 1_050_001]);
  expect(result.reporters.filter((r) => r.missingContent)).toHaveLength(1);
  expect(result.stateCounts['STATE_PRESENTED_PARTIAL']).toBe(1);
});

it('excludes another renderer process instead of filling the Hall gap', () => {
  const result = readNativeFeedback(trace([...normal, { nativeUs: 1_041_667, pid: 8 }]), 7, before, after);
  expect(result.nativeTimesUs).toEqual(normal.map((r) => r.nativeUs));
});

it('rejects unknown frame states', () => {
  expect(() =>
    readNativeFeedback(trace([...normal, { nativeUs: 1_060_000, state: 'UNKNOWN' }]), 7, before, after),
  ).toThrow('Unknown native frame state');
});

it('rejects incomplete native reporter lifetimes', () => {
  const data = trace(normal);
  data.traceEvents.pop();
  expect(() => readNativeFeedback(data, 7, before, after)).toThrow('unfinished reporter');
});

it('rejects native trace loss instead of reading a clean-looking partial stream', () => {
  const data = trace(normal);
  data.metadata = { trace_processor_stats: { traced_buf: [{ data_loss_overwrite: 1 }] } };
  expect(() => readNativeFeedback(data, 7, before, after)).toThrow('lost data');
});

it('requires both Hall clock anchors', () => {
  const data = trace(normal);
  data.traceEvents = data.traceEvents.filter((e) => e.name !== 'after');
  expect(() => readNativeFeedback(data, 7, before, after)).toThrow('Both ordered Hall clock anchors');
});

function savedTrace(data: Parameters<typeof readNativeFeedback>[0], inlineClose = false): string {
  const directory = mkdtempSync(join(tmpdir(), 'drashti-native-trace-unit-'));
  directories.push(directory);
  const file = join(directory, 'generated.json');
  const events = data.traceEvents.map((event) => JSON.stringify(event)).join(',\n');
  writeFileSync(
    file,
    '{"traceEvents":[\n' +
      events +
      (inlineClose ? '' : '\n') +
      '],\n"metadata":' +
      JSON.stringify(data.metadata) +
      '}\n',
  );
  return file;
}

it('streams frame evidence while discarding unrelated large CPU events with escaped braces', async () => {
  const data = trace(normal);
  data.traceEvents.splice(2, 0, {
    name: 'ProfileChunk',
    pid: 77,
    ph: 'I',
    ts: 100,
    args: { text: 'escaped\\" braces } [ 漢字'.repeat(20_000) },
  });
  const parsed = await readNativeTraceFile(savedTrace(data), ['before', 'after']);
  expect(parsed.traceEvents).toEqual(data.traceEvents.filter((event) => event.name !== 'ProfileChunk'));
  expect(readNativeFeedback(parsed, 7, before, after).nativeTimesUs).toEqual(normal.map((r) => r.nativeUs));
});

it('reads a footer sharing the final event line and preserves native worker marks', async () => {
  const data = trace(normal);
  data.traceEvents.push({ name: 'x19-native-display-job-source-start', pid: 9, ph: 'I', ts: 1_000_123 });
  const parsed = await readNativeTraceFile(savedTrace(data, true), ['before', 'after']);
  const result = readNativeFeedback(parsed, 7, before, after);
  expect(result.jobs).toEqual([{ pid: 9, kind: 'source-start', nativeUs: 1_000_123, wallAt: 11_000.123 }]);
});

it('rejects an incomplete streamed event', async () => {
  const file = savedTrace(trace(normal));
  writeFileSync(file, '{"traceEvents":[\n{"name":"PipelineReporter","args":{"state":"cut off"');
  await expect(readNativeTraceFile(file, ['before', 'after'])).rejects.toThrow('incomplete');
});

it('rejects an unsupported root layout before loading a full profile', async () => {
  const file = savedTrace(trace(normal));
  writeFileSync(file, '{"other":"generated","traceEvents":[]}');
  await expect(readNativeTraceFile(file, ['before', 'after'])).rejects.toThrow(
    'Unsupported native trace header',
  );
});
