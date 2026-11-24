import { test, type ElectronApplication, type Page } from '@playwright/test';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

// Test-owned presentation feedback for the import cost check; no production drawing changes.
const FRAME_CATEGORY = 'disabled-by-default-devtools.timeline.frame';
const JOB_PREFIX = 'x19-native-display-job-';
const CATEGORIES = [FRAME_CATEGORY, 'blink.user_timing', 'v8', 'disabled-by-default-v8.gc'];
interface Event {
  name?: string;
  ph?: string;
  pid?: number;
  tid?: number;
  ts?: number;
  dur?: number;
  id2?: { local?: string; global?: string };
  id?: string;
  args?: Record<string, unknown>;
}
interface NativeTrace {
  traceEvents: Event[];
  metadata?: { trace_processor_stats?: Record<string, unknown> };
}
interface Anchor {
  name: string;
  wallAt: number;
  coarseBefore?: number;
  coarseAfter?: number;
}
interface Reporter {
  nativeUs: number;
  state: string;
  missingContent: boolean;
  layerTree: number;
}
export interface NativeFeedback {
  hallPid: number;
  anchorSpreadMs: number;
  anchorOffsetMs: number;
  nativeTimesUs: number[];
  frames: number[];
  reporters: Reporter[];
  stateCounts: Record<string, number>;
  jobs: { pid: number; kind: string; nativeUs: number; wallAt: number }[];
  bufferUsage: unknown;
  versions: { electron: string; chrome: string };
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('Missing safe native ' + label);
  return value;
}

function track(event: Event): string {
  const id = event.id2?.local ?? event.id2?.global ?? event.id;
  if (typeof id !== 'string') throw new Error('The native reporter has no exact track id.');
  return id;
}

/** Read pinned Chromium's event-per-line export without loading a full CPU profile into memory. */
export async function readNativeTraceFile(path: string, anchors: readonly string[]): Promise<NativeTrace> {
  const handle = await open(path, 'r');
  let start: number;
  try {
    const header = Buffer.alloc(512);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const newline = header.subarray(0, bytesRead).indexOf(10);
    if (newline < 0 || !/^\s*\{\s*"traceEvents"\s*:\s*\[\s*$/u.test(header.toString('utf8', 0, newline)))
      throw new Error('Unsupported native trace header; original bytes remain retained.');
    start = newline + 1;
  } finally {
    await handle.close();
  }
  const events: Event[] = [];
  const input = createReadStream(path, { encoding: 'utf8', start });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let tail = '';
  let inTail = false;
  const objectEnd = (line: string): number => {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) return index;
    }
    throw new Error('An exported native event is incomplete or has an unsupported layout.');
  };
  try {
    for await (const wholeLine of lines) {
      if (wholeLine.length > 32 * 1024 * 1024)
        throw new Error('An individual native event is unexpectedly large.');
      if (inTail) tail += '\n' + wholeLine;
      else {
        let line = wholeLine.trim();
        while (line.length) {
          if (line.startsWith(',')) {
            line = line.slice(1).trimStart();
            continue;
          }
          if (line.startsWith(']')) {
            inTail = true;
            tail = line.slice(1);
            break;
          }
          if (!line.startsWith('{')) throw new Error('Unexpected native event array value.');
          const end = objectEnd(line);
          const event = JSON.parse(line.slice(0, end + 1)) as Event;
          const name = event.name ?? '';
          if (name === 'PipelineReporter' || anchors.includes(name) || name.startsWith(JOB_PREFIX))
            events.push(event);
          line = line.slice(end + 1).trimStart();
        }
      }
      if (tail.length > 8 * 1024 * 1024) throw new Error('The native trace footer is unexpectedly large.');
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (!inTail) throw new Error('The native event array has no complete ending.');
  const footer = JSON.parse('{' + tail.trim().replace(/^,/u, '')) as Omit<NativeTrace, 'traceEvents'>;
  return { ...footer, traceEvents: events };
}

/**
 * Chromium152's controller terminates a presented reporter at presentation_feedback.timestamp.
 * Its reporter emits that timestamp as PipelineReporter's end; dropped reporters have another state.
 * Count only this Hall PID and exact native instants, never Main delivery or draw/submit time.
 * Large numeric display/surface ids are deliberately unused; the original JSON is retained intact.
 */
export function readNativeFeedback(
  trace: NativeTrace,
  hallPid: number,
  before: Anchor,
  after: Anchor,
): Omit<NativeFeedback, 'bufferUsage' | 'versions'> {
  if (!Array.isArray(trace.traceEvents)) throw new Error('The native trace has no event stream.');
  const stats = trace.metadata?.trace_processor_stats;
  const buffers = stats?.['traced_buf'];
  if (!Array.isArray(buffers) || buffers.length === 0)
    throw new Error('The actual native trace footer is missing.');
  for (const buffer of buffers as Record<string, unknown>[]) {
    for (const [name, value] of Object.entries(buffer)) {
      if (
        /^(?:data_loss|chunks_(?:discarded|overwritten)|bytes_overwritten|sequence_packet_loss|trace_writer_packet_loss|abi_violations|incremental_sequences_dropped|write_wrap_count|patches_failed)/u.test(
          name,
        ) &&
        value !== 0
      )
        throw new Error('The native trace lost data: ' + name);
    }
  }
  if (typeof stats?.['traced_chunks_discarded'] === 'number' && stats['traced_chunks_discarded'] !== 0)
    throw new Error('The trace service discarded native chunks.');
  const pending = new Map<string, Event>();
  const anchors = new Map<string, number>();
  const reporters: Reporter[] = [];
  const stateCounts: Record<string, number> = {};
  const rawJobs: { pid: number; kind: string; nativeUs: number }[] = [];
  const complete = (begin: Event, nativeUs: number) => {
    const data = begin.args?.['frame_reporter'] as Record<string, unknown> | undefined;
    if (!data || typeof data['state'] !== 'string') throw new Error('A native frame state is missing.');
    stateCounts[data['state']] = (stateCounts[data['state']] ?? 0) + 1;
    if (data['state'] === 'STATE_DROPPED' || data['state'] === 'STATE_NO_UPDATE_DESIRED') return;
    if (data['state'] !== 'STATE_PRESENTED_ALL' && data['state'] !== 'STATE_PRESENTED_PARTIAL')
      throw new Error('Unknown native frame state: ' + data['state']);
    if (nativeUs < integer(begin.ts, 'reporter start')) throw new Error('Native time moved backwards.');
    reporters.push({
      nativeUs,
      state: data['state'],
      missingContent: data['has_missing_content'] === true,
      layerTree: integer(data['layer_tree_host_id'], 'layer tree'),
    });
  };
  for (const event of trace.traceEvents) {
    const name = event.name ?? '';
    if (name.startsWith(JOB_PREFIX) && event.ph !== 'e' && event.ph !== 'E') {
      rawJobs.push({
        pid: integer(event.pid, 'job pid'),
        kind: name.slice(JOB_PREFIX.length),
        nativeUs: integer(event.ts, 'job timestamp'),
      });
    }
    if (event.pid !== hallPid) continue;
    if ((name === before.name || name === after.name) && event.ph !== 'e' && event.ph !== 'E') {
      if (anchors.has(name)) throw new Error('Duplicate Hall clock anchor.');
      anchors.set(name, integer(event.ts, 'Hall anchor'));
    }
    if (name !== 'PipelineReporter') continue;
    const id = track(event);
    if (event.ph === 'b') {
      if (pending.has(id)) throw new Error('Native track reused before its previous frame ended.');
      pending.set(id, event);
    } else if (event.ph === 'e') {
      const begin = pending.get(id);
      if (!begin) throw new Error('Native frame ended without its beginning.');
      pending.delete(id);
      complete(begin, integer(event.ts, 'presentation timestamp'));
    } else if (event.ph === 'X') {
      complete(event, integer(event.ts, 'frame start') + integer(event.dur, 'frame duration'));
    } else throw new Error('Unsupported native reporter phase.');
  }
  if (pending.size !== 0) throw new Error('The native trace ends inside an unfinished reporter.');
  const first = anchors.get(before.name);
  const last = anchors.get(after.name);
  if (first === undefined || last === undefined || first >= last)
    throw new Error('Both ordered Hall clock anchors are required.');
  const firstOffset = before.wallAt - first / 1000;
  const lastOffset = after.wallAt - last / 1000;
  const anchorOffsetMs = (firstOffset + lastOffset) / 2;
  const nativeTimesUs = [...new Set(reporters.map((r) => r.nativeUs))].sort((a, b) => a - b);
  if (nativeTimesUs.length <= 2 || new Set(reporters.map((r) => r.layerTree)).size !== 1)
    throw new Error('The Hall native frame stream is missing or ambiguous.');
  return {
    hallPid,
    anchorOffsetMs,
    anchorSpreadMs: Math.abs(lastOffset - firstOffset),
    nativeTimesUs,
    frames: nativeTimesUs.map((t) => t / 1000 + anchorOffsetMs),
    reporters,
    stateCounts,
    jobs: rawJobs.map((job) => ({ ...job, wallAt: job.nativeUs / 1000 + anchorOffsetMs })),
  };
}

const anchor = (page: Page, name: string) =>
  page.evaluate((name) => {
    const coarseBefore = Date.now();
    const wallAt = performance.timeOrigin + performance.now();
    const coarseAfter = Date.now();
    performance.mark(name, { detail: { wallAt } });
    return { name, wallAt, coarseBefore, coarseAfter };
  }, name);

/** Native presentation recording; parsing and retention follow all unchanged measured phases. */
export async function beginNativeFeedback(
  app: ElectronApplication,
  page: Page,
  label: string,
): Promise<() => Promise<NativeFeedback>> {
  const info = test.info();
  const raw = info.outputPath(label + '.json');
  const compressed = raw + '.gz';
  mkdirSync(dirname(raw), { recursive: true });
  const setup = await app.evaluate(
    async ({ contentTracing, BrowserWindow, app }, { categories, url }) => {
      const available = await contentTracing.getCategories();
      if (categories.some((category) => !available.includes(category)))
        throw new Error('A required native profile category is unavailable.');
      const hall = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
      const hallPid = hall?.webContents.getOSProcessId() ?? 0;
      if (hallPid <= 0) throw new Error('The actual Hall renderer process is missing.');
      await contentTracing.startRecording({
        recording_mode: 'record-until-full',
        trace_buffer_size_in_kb: 512 * 1024,
        included_categories: categories,
        excluded_categories: ['*'],
      });
      return {
        hallPid,
        mainPid: process.pid,
        metrics: app.getAppMetrics(),
        windows: BrowserWindow.getAllWindows().map((w) => ({
          id: w.webContents.id,
          pid: w.webContents.getOSProcessId(),
          url: w.webContents.getURL(),
        })),
        categories,
        versions: { electron: process.versions.electron, chrome: process.versions.chrome },
      };
    },
    { categories: CATEGORIES, url: page.url() },
  );
  const before = await anchor(page, label + '-before');
  const driverGc: { startTime: number; duration: number }[] = [];
  let gcClipped = false;
  const retainGc = (entries: { startTime: number; duration: number }[]) => {
    for (const entry of entries) {
      if (driverGc.length >= 20000) {
        gcClipped = true;
        continue;
      }
      driverGc.push({ startTime: entry.startTime, duration: entry.duration });
    }
  };
  const gcObserver = new PerformanceObserver((list) => retainGc(list.getEntries()));
  gcObserver.observe({ entryTypes: ['gc'] });
  const clock = () => {
    const coarseBefore = Date.now();
    const fine = performance.timeOrigin + performance.now();
    return { coarseBefore, fine, coarseAfter: Date.now() };
  };
  const driverBefore = {
    clock: clock(),
    timeOrigin: performance.timeOrigin,
    wallAt: Date.now(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
  };
  let stopped = false;
  return async () => {
    if (stopped) throw new Error('The native frame recording was already consumed.');
    stopped = true;
    const after = await anchor(page, label + '-after');
    retainGc(gcObserver.takeRecords());
    gcObserver.disconnect();
    const driver = {
      clockAfter: clock(),
      before: driverBefore,
      wallAtAfter: Date.now(),
      memoryAfter: process.memoryUsage(),
      cpuDelta: process.cpuUsage(driverBefore.cpu),
      gc: driverGc,
      gcClipped,
    };
    const end = await app.evaluate(async ({ contentTracing, app }, path) => {
      const usage = await contentTracing.getTraceBufferUsage();
      const metrics = app.getAppMetrics();
      await contentTracing.stopRecording(path);
      return { usage, metrics };
    }, raw);
    const usage = end.usage;
    let parsed: ReturnType<typeof readNativeFeedback> | undefined;
    let parseError: Error | undefined;
    try {
      if (usage.percentage >= 1) throw new Error('The native frame recording filled its buffer.');
      parsed = readNativeFeedback(
        await readNativeTraceFile(raw, [before.name, after.name]),
        setup.hallPid,
        before,
        after,
      );
    } catch (error) {
      parseError =
        error instanceof Error ? error : new Error('Native trace parsing failed.', { cause: error });
    }
    await pipeline(createReadStream(raw), createGzip(), createWriteStream(compressed));
    await info.attach(label + '-chromium.json.gz', {
      body: readFileSync(compressed),
      contentType: 'application/gzip',
    });
    let rawCleanupError: string | null = null;
    try {
      rmSync(raw);
    } catch (error) {
      rawCleanupError =
        error instanceof Error ? error.message : 'Raw trace cleanup failed; complete gzip retained.';
    }
    await info.attach(label + '-evidence.json', {
      body: Buffer.from(
        JSON.stringify({
          label,
          setup,
          before,
          after,
          end,
          driver,
          gzipBytes: statSync(compressed).size,
          rawCleanupError,
          usage,
          parsed,
          parseError: parseError?.message ?? null,
        }),
      ),
      contentType: 'application/json',
    });
    if (parseError !== undefined) throw parseError;
    if (!parsed) throw new Error('The native frame recording was not interpreted.');
    return { ...parsed, bufferUsage: usage, versions: setup.versions };
  };
}
