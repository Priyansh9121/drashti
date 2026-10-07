import { createWriteStream, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, ElectronApplication } from '@playwright/test';

/*
 * Where a window's memory goes (Session 16 for the operator window, Session
 * 17 for an output). Every soak had the operator window grow 60–140 MB over
 * three hours, and after that was explained, Main's two outputs grew 21–36
 * MB an hour. This looks inside one window, and runs only when asked
 * (DRASHTI_SOAK_HEAP=operator or output, the Soak workflow's "heap" choice):
 *
 * - at every sample, the window's JavaScript heap and its counts of
 *   documents, page nodes and event listeners (DevTools' own counters), and
 *   each window's own working set (the soak's tables add Main's outputs up);
 * - at three points (after warming up, in the middle, at the end), a heap
 *   snapshot, summed up by kind of object (how many, how big, and how many
 *   cut loose from the page), and a memory dump of the window's process by
 *   Chromium's allocators (V8, Blink's heaps, malloc, the image cache, the
 *   graphics side), from Chromium's own memory tracing.
 *
 * The snapshots and traces stay on the runner and are deleted once summed up:
 * only the comparison is kept in the soak's report (<window>-memory.md and
 * .json), never a snapshot (a heap snapshot holds whatever the page held).
 *
 * The probe counts what the window loads through a DevTools session of its
 * own, which keeps no content but, like Playwright's, keeps a record of each
 * load: the probed window has two such recorders, every other window one.
 */

export interface HeapSample {
  minute: number;
  /** The JavaScript heap in use, MB, as it stands (garbage not yet collected included). */
  jsUsedMb: number;
  jsTotalMb: number;
  documents: number;
  nodes: number;
  listeners: number;
  /** Each window's own working set at the time, MB (Main's outputs one by one, the operator window). */
  windowsMb?: Record<string, number>;
}

/** One kind of object in a heap snapshot: how many, and their own size. */
interface Kind {
  count: number;
  bytes: number;
}

export interface SnapshotSummary {
  label: string;
  minute: number;
  /** All objects' own sizes together, MB (after the collection a snapshot makes). */
  totalMb: number;
  objects: number;
  kinds: Record<string, Kind>;
  /** Page nodes cut loose from the page but still held. */
  detached: Record<string, Kind>;
}

export interface AllocatorSummary {
  label: string;
  minute: number;
  /** The process's footprint as Chromium tells it, MB. */
  privateFootprintMb: number | null;
  residentMb: number | null;
  /** Each allocator's size (top level, and partition_alloc's partitions), MB. */
  allocators: Record<string, number>;
}

export interface WindowMemory {
  /** Which window is looked inside ("Operator window", "Main output 1"). */
  window: string;
  samples: HeapSample[];
  snapshots: SnapshotSummary[];
  dumps: AllocatorSummary[];
  /** What the window loaded over the run, by kind of address (ids left out): how often, how many bytes. */
  requests: Record<string, { count: number; bytes: number; type: string }>;
}

/** An address with its ids and query left out, so loads of the same kind count together. */
export function requestKind(url: string): string {
  const bare = url.split('?')[0]?.split('#')[0] ?? url;
  return bare
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, '<id>')
    .replace(/[0-9a-f]{24,}/giu, '<hash>')
    .replace(/\/\d+(?=\/|$)/gu, '/<n>')
    .slice(0, 120);
}

/**
 * Count what the window loads, through the probe's own DevTools session with nothing kept (no
 * buffers: the probe must not add what it looks for).
 */
export async function watchRequests(cdp: CDPSession, into: WindowMemory['requests']): Promise<void> {
  const kinds = new Map<string, string>();
  cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string }; type?: string }) => {
    const kind = requestKind(e.request.url);
    kinds.set(e.requestId, kind);
    const k = (into[kind] ??= { count: 0, bytes: 0, type: e.type ?? '?' });
    k.count++;
  });
  cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => {
    const kind = kinds.get(e.requestId);
    kinds.delete(e.requestId);
    if (kind && into[kind]) into[kind].bytes += e.encodedDataLength;
  });
  await cdp.send('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
}

export async function heapSample(cdp: CDPSession, minute: number): Promise<HeapSample> {
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  return {
    minute,
    jsUsedMb: heap.usedSize / 1024 ** 2,
    jsTotalMb: heap.totalSize / 1024 ** 2,
    documents: dom.documents,
    nodes: dom.nodes,
    listeners: dom.jsEventListeners,
  };
}

/** A heap snapshot of the page, written to `file` as it comes. */
async function takeSnapshot(cdp: CDPSession, file: string): Promise<void> {
  const out = createWriteStream(file);
  const onChunk = (e: { chunk: string }) => {
    out.write(e.chunk);
  };
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  try {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  } finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await new Promise<void>((resolve) => out.end(resolve));
    await cdp.send('HeapProfiler.disable');
  }
}

interface RawSnapshot {
  snapshot: { meta: { node_fields: string[]; node_types: [string[], ...unknown[]] } };
  nodes: number[];
  strings: string[];
}

/** A snapshot summed up by kind: objects by their constructor's name, the rest by their type. */
export function summarize(file: string, label: string, minute: number): SnapshotSummary {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as RawSnapshot;
  const fields = raw.snapshot.meta.node_fields;
  const types = raw.snapshot.meta.node_types[0];
  const width = fields.length;
  const typeAt = fields.indexOf('type');
  const nameAt = fields.indexOf('name');
  const sizeAt = fields.indexOf('self_size');
  const detachedAt = fields.indexOf('detachedness');
  const kinds: Record<string, Kind> = {};
  const detached: Record<string, Kind> = {};
  let total = 0;
  let objects = 0;
  const add = (into: Record<string, Kind>, key: string, bytes: number) => {
    const k = (into[key] ??= { count: 0, bytes: 0 });
    k.count++;
    k.bytes += bytes;
  };
  for (let i = 0; i < raw.nodes.length; i += width) {
    const type = types[raw.nodes[i + typeAt] ?? 0] ?? '?';
    const name = raw.strings[raw.nodes[i + nameAt] ?? 0] ?? '?';
    const bytes = raw.nodes[i + sizeAt] ?? 0;
    total += bytes;
    objects++;
    const key =
      type === 'object' || type === 'native'
        ? name.replace(/^Detached /u, '').slice(0, 80)
        : type === 'closure'
          ? '(closures)'
          : type === 'string' || type === 'concatenated string' || type === 'sliced string'
            ? '(strings)'
            : `(${type})`;
    add(kinds, key, bytes);
    if (detachedAt >= 0 && raw.nodes[i + detachedAt] === 2) add(detached, key, bytes);
  }
  return { label, minute, totalMb: total / 1024 ** 2, objects, kinds, detached };
}

/** Snapshot the window, sum it up, and delete the snapshot. */
export async function snapshot(
  cdp: CDPSession,
  dir: string,
  label: string,
  minute: number,
): Promise<SnapshotSummary> {
  const file = join(dir, `window-${label}.heapsnapshot`);
  try {
    await takeSnapshot(cdp, file);
    return summarize(file, label, minute);
  } finally {
    rmSync(file, { force: true });
  }
}

/** The process of the window at `url`, by Chromium's allocators, from a few seconds of memory tracing. */
export async function allocatorDump(
  app: ElectronApplication,
  dir: string,
  label: string,
  minute: number,
  url: string,
): Promise<AllocatorSummary> {
  const file = join(dir, `window-${label}.trace.json`);
  try {
    const pid = await app.evaluate(
      async ({ contentTracing, webContents }, { path, url }) => {
        const window = webContents.getAllWebContents().find((wc) => wc.getURL() === url);
        await contentTracing.startRecording({
          included_categories: ['disabled-by-default-memory-infra'],
          excluded_categories: ['*'],
          memory_dump_config: { triggers: [{ mode: 'detailed', periodic_interval_ms: 1500 }] },
        });
        await new Promise((resolve) => setTimeout(resolve, 4000));
        await contentTracing.stopRecording(path);
        return window?.getOSProcessId() ?? 0;
      },
      { path: file, url },
    );
    return summarizeTrace(readFileSync(file, 'utf8'), pid, label, minute);
  } finally {
    rmSync(file, { force: true });
  }
}

interface TraceEvent {
  ph?: string;
  pid?: number;
  args?: {
    dumps?: {
      process_totals?: Record<string, string | undefined>;
      allocators?: Record<string, { attrs?: Record<string, { value?: string } | undefined> } | undefined>;
    };
  };
}

const hexMb = (value: string | undefined) => (value ? Number.parseInt(value, 16) / 1024 ** 2 : null);

/** The last detailed dump of one process in a memory-infra trace. */
export function summarizeTrace(json: string, pid: number, label: string, minute: number): AllocatorSummary {
  const parsed = JSON.parse(json) as { traceEvents?: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  const dumps = events.filter((e) => e.ph === 'v' && e.pid === pid && e.args?.dumps);
  const last = dumps.at(-1)?.args?.dumps;
  const allocators: Record<string, number> = {};
  for (const [name, dump] of Object.entries(last?.allocators ?? {})) {
    const depth = name.split('/').length;
    const keep = depth === 1 || (name.startsWith('partition_alloc/partitions/') && depth === 3);
    const mb = hexMb(dump?.attrs?.['size']?.value);
    if (keep && mb !== null) allocators[name] = mb;
  }
  return {
    label,
    minute,
    privateFootprintMb: hexMb(last?.process_totals?.['private_footprint_bytes']),
    residentMb: hexMb(last?.process_totals?.['resident_set_bytes']),
    allocators,
  };
}

const mb = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(1));

/** DevTools' network records in a snapshot: Blink's ResourceData objects, one for each load a recorder saw. */
export function networkRecords(snap: SnapshotSummary): Kind {
  return Object.entries(snap.kinds)
    .filter(([name]) => name.includes('NetworkResourcesData'))
    .reduce((sum, [, k]) => ({ count: sum.count + k.count, bytes: sum.bytes + k.bytes }), {
      count: 0,
      bytes: 0,
    });
}

/** The comparison, in words and tables: what grew from the first point to the last. */
export function describe(memory: WindowMemory, workingSet: [number, number][]): string {
  const what = memory.window === 'Operator window' ? 'the operator window' : memory.window;
  const lines: string[] = [`## Inside ${what} (Sessions 16 and 17)`, ''];
  const s = memory.samples;
  if (s.length > 1) {
    const first = s[0];
    const last = s.at(-1);
    const ws = (minute: number) => workingSet.find((p) => p[0] >= minute)?.[1] ?? null;
    if (first && last)
      lines.push(
        `From minute ${String(first.minute)} to ${String(last.minute)}: working set ${mb(ws(first.minute))} → ${mb(ws(last.minute))} MB; JavaScript heap in use ${mb(first.jsUsedMb)} → ${mb(last.jsUsedMb)} MB (of ${mb(first.jsTotalMb)} → ${mb(last.jsTotalMb)}); page nodes ${String(first.nodes)} → ${String(last.nodes)}; event listeners ${String(first.listeners)} → ${String(last.listeners)}; documents ${String(first.documents)} → ${String(last.documents)}.`,
        '',
      );
    const names = [...new Set(s.flatMap((x) => Object.keys(x.windowsMb ?? {})))];
    if (names.length > 0) {
      // Each window by half hours (the median of its samples), so trimming's dips do not mislead.
      const halves = [...new Set(s.map((x) => Math.floor(x.minute / 30)))];
      const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)];
      lines.push(
        `Each window's working set, the median of each half hour (MB), from minute ${String(first?.minute ?? 0)}:`,
        '',
        `| Window | ${halves.map((h) => `${String(h * 30)}–${String(h * 30 + 30)} min`).join(' | ')} |`,
        `|---|${halves.map(() => '---:').join('|')}|`,
        ...names.map(
          (n) =>
            `| ${n}${n === memory.window ? ' (looked inside)' : ''} | ${halves
              .map((h) =>
                mb(
                  median(
                    s
                      .filter((x) => Math.floor(x.minute / 30) === h)
                      .map((x) => x.windowsMb?.[n])
                      .filter((v): v is number => v !== undefined),
                  ),
                ),
              )
              .join(' | ')} |`,
        ),
        '',
      );
    }
  }
  const snaps = memory.snapshots;
  if (snaps.length > 1) {
    const [a, , c] = [snaps[0], snaps[1], snaps.at(-1)];
    if (a && c) {
      lines.push(
        `Heap snapshots (after a full collection): ${snaps.map((x) => `${x.label} (minute ${String(x.minute)}) ${mb(x.totalMb)} MB in ${x.objects.toLocaleString('en')} objects`).join('; ')}.`,
        '',
        `| Kind | ${snaps.map((x) => `${x.label} count`).join(' | ')} | ${snaps.map((x) => `${x.label} MB`).join(' | ')} | grew MB |`,
        `|---|${snaps.map(() => '---:').join('|')}|${snaps.map(() => '---:').join('|')}|---:|`,
      );
      const names = new Set(snaps.flatMap((x) => Object.keys(x.kinds)));
      const rows = [...names]
        .map((n) => ({ n, grew: (c.kinds[n]?.bytes ?? 0) - (a.kinds[n]?.bytes ?? 0) }))
        .sort((x, y) => Math.abs(y.grew) - Math.abs(x.grew))
        .slice(0, 25);
      for (const { n, grew } of rows)
        lines.push(
          `| ${n.replace(/\|/gu, '/')} | ${snaps.map((x) => String(x.kinds[n]?.count ?? 0)).join(' | ')} | ${snaps.map((x) => mb((x.kinds[n]?.bytes ?? 0) / 1024 ** 2)).join(' | ')} | ${mb(grew / 1024 ** 2)} |`,
        );
      const loose = snaps.map((x) => Object.values(x.detached).reduce((sum, k) => sum + k.count, 0));
      lines.push('', `Page nodes cut loose but still held: ${loose.map(String).join(' → ')}.`);
      lines.push(
        `DevTools' network records (one for each load a recorder saw; this window has two recorders, Playwright's and the probe's): ${snaps
          .map((x) => {
            const r = networkRecords(x);
            return `${r.count.toLocaleString('en')} (${mb(r.bytes / 1024 ** 2)} MB)`;
          })
          .join(' → ')}.`,
      );
      const topLoose = Object.entries(c.detached)
        .sort((x, y) => y[1].count - x[1].count)
        .slice(0, 8)
        .map(([n, k]) => `${n} ${String(k.count)}`);
      if (topLoose.length > 0) lines.push(`At the end: ${topLoose.join(', ')}.`);
      lines.push('');
    }
  }
  const loads = Object.entries(memory.requests).sort((x, y) => y[1].count - x[1].count);
  if (loads.length > 0) {
    lines.push(
      'What the window loaded over the run (each load is also kept by the DevTools network recorder of anything attached, such as Playwright):',
      '',
      '| Address (ids left out) | Type | Loads | MB |',
      '|---|---|---:|---:|',
      ...loads
        .slice(0, 12)
        .map(
          ([kind, k]) =>
            `| ${kind.replace(/\|/gu, '/')} | ${k.type} | ${String(k.count)} | ${mb(k.bytes / 1024 ** 2)} |`,
        ),
      '',
    );
  }
  const dumps = memory.dumps;
  if (dumps.length > 1) {
    const a = dumps[0];
    const c = dumps.at(-1);
    if (a && c) {
      lines.push(
        `Chromium's own account of the process: private footprint ${dumps.map((d) => mb(d.privateFootprintMb)).join(' → ')} MB, resident ${dumps.map((d) => mb(d.residentMb)).join(' → ')} MB.`,
        '',
        `| Allocator | ${dumps.map((d) => `${d.label} MB`).join(' | ')} | grew MB |`,
        `|---|${dumps.map(() => '---:').join('|')}|---:|`,
      );
      const names = new Set(dumps.flatMap((d) => Object.keys(d.allocators)));
      const rows = [...names]
        .map((n) => ({ n, grew: (c.allocators[n] ?? 0) - (a.allocators[n] ?? 0) }))
        .sort((x, y) => Math.abs(y.grew) - Math.abs(x.grew))
        .slice(0, 20);
      for (const { n, grew } of rows)
        lines.push(`| ${n} | ${dumps.map((d) => mb(d.allocators[n] ?? 0)).join(' | ')} | ${mb(grew)} |`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
