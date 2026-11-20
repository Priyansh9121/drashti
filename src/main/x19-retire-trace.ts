// SCRATCH diagnosis only. Never merge this module or its two auxiliary patches.
import { app, contentTracing, type TraceConfig, webContents } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getPriority } from 'node:os';
import { join } from 'node:path';
import { packaged, sw } from './switches';

interface Scope {
  name: string;
  track: string;
  setMs: number;
  waitMs: number;
  streaming: boolean;
}
interface Press {
  at: number;
  rev: number;
  from: string;
  until: number;
}

const repetitions = new Map<string, number>();
let serial = 0;
let categories: Promise<string[]> | undefined;
const now = () => performance.timeOrigin + performance.now();

const requested = [
  'toplevel',
  'toplevel.flow',
  'ipc',
  'mojom',
  'cc',
  'cc.debug',
  'disabled-by-default-cc.debug',
  'disabled-by-default-cc.debug.scheduler',
  'disabled-by-default-cc.debug.tile',
  'viz',
  'gpu',
  'gpu.dawn',
  'disabled-by-default-gpu.dawn',
  'disabled-by-default-gpu.graphite.dawn',
  'disabled-by-default-gpu.service',
  'disabled-by-default-gpu.device',
  'skia',
  'skia.shaders',
  'disabled-by-default-skia.shaders',
  'disabled-by-default-skia.gpu.cache',
  'disabled-by-default-memory-infra',
  'blink.user_timing',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'renderer.scheduler',
  'disabled-by-default-v8.gc',
];

function metrics() {
  return app.getAppMetrics().map((metric) => {
    let priority: number | null = null;
    try {
      priority = getPriority(metric.pid);
    } catch {
      // An exited/unavailable process has no observed priority; never infer LOW.
    }
    return { ...metric, priority };
  });
}

/** Attributes and existing performance entries only: no layout, pixels, mutation hooks or decode wrappers. */
async function pages(marker: string, scope: Scope, phase: string, press?: Press) {
  const payload = JSON.stringify({ marker, scope, phase, press });
  const script = `(() => {
    const input = ${payload};
    const wallAt = performance.timeOrigin + performance.now();
    const mark = performance.mark(input.marker, { detail: { wallAt, ...input } });
    const all = performance.getEntriesByType('mark').filter(entry => entry.name.startsWith('drashti-warm-up'));
    const root = document.querySelector('[data-testid="output-root"]');
    return {
      marker: input.marker, markAt: mark.startTime, wallAt,
      timeOrigin: performance.timeOrigin, afterReadAt: performance.timeOrigin + performance.now(),
      documentReady: document.readyState, visibility: document.visibilityState,
      rootAttributes: root ? Object.fromEntries([...root.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])) : null,
      warmUpElements: [...document.querySelectorAll('[data-warm-up]')].slice(0, 40).map(el => el.getAttribute('data-warm-up')),
      warmUpMarks: all.slice(0, 1000).map(entry => ({ name: entry.name, startTime: entry.startTime, wallAt: performance.timeOrigin + entry.startTime })),
      warmUpMarksClipped: all.length > 1000,
      limit: 'Existing mark history only. No native startup trace here; no absence or shader-warmth claim for an unobserved interval.'
    };
  })()`;
  return Promise.all(
    webContents.getAllWebContents().flatMap((page) => {
      if (page.isDestroyed()) return [];
      const role = /\/([^/?]+\.html)(?:\?|$)/u.exec(page.getURL())?.[1];
      if (!role) return [];
      const id = page.id;
      const pid = page.getOSProcessId();
      const asked = now();
      return [
        (async () => {
          let timer: NodeJS.Timeout | undefined;
          try {
            const sample = await Promise.race([
              page.executeJavaScript(script, true) as Promise<unknown>,
              new Promise((resolve) => {
                timer = setTimeout(
                  () =>
                    resolve({
                      unavailable:
                        'Diagnostic page read exceeded 1000 ms; any later mark is outside this read.',
                    }),
                  1000,
                );
              }),
            ]);
            return { role, id, pid, asked, returned: now(), sample };
          } catch (error) {
            return { role, id, pid, asked, returned: now(), unavailable: String(error) };
          } finally {
            if (timer) clearTimeout(timer);
          }
        })(),
      ];
    }),
  );
}

/** A fresh bounded trace for one unchanged press; start/stop overhead is explicitly outside its nominal window. */
export async function startRetireTrace(
  scope: Scope,
): Promise<((press?: Press) => Promise<void>) | undefined> {
  const root = sw('DRASHTI_X19_RETIRE_TRACE');
  if (packaged() || !root || sw('DRASHTI_TEST_MOTION_PROBE') !== '1') return undefined;
  const sequence = ++serial;
  const repetition = (repetitions.get(scope.name) ?? 0) + 1;
  repetitions.set(scope.name, repetition);
  const safe = scope.name.replace(/[^a-z0-9]+/gu, '-');
  const label = `x19-retire-${scope.streaming ? 'streaming' : 'plain'}-${String(sequence).padStart(3, '0')}-${safe}-${String(repetition)}`;
  const folder = join(root, label);
  mkdirSync(folder, { recursive: true });
  // Startup keeps native pipeline history without the large per-frame cc snapshots.
  const traceCategories =
    scope.track === 'startup'
      ? requested.filter((category) =>
          [
            'toplevel',
            'gpu',
            'disabled-by-default-gpu.dawn',
            'disabled-by-default-gpu.graphite.dawn',
            'disabled-by-default-skia.shaders',
            'blink.user_timing',
          ].includes(category),
        )
      : requested;
  const config: TraceConfig & { record_mode: 'record-until-full' } = {
    included_categories: traceCategories,
    excluded_categories: ['*'],
    recording_mode: 'record-until-full',
    record_mode: 'record-until-full',
    trace_buffer_size_in_kb: 128 * 1024,
  };
  categories ??= contentTracing.getCategories();
  const available = await categories;
  const observerBeganAt = now();
  await contentTracing.startRecording(config);
  const traceStartedAt = now();
  const before = await pages(label + '-before', scope, 'before');
  const beforeMetrics = metrics();
  const readyForOriginalPressAt = now();
  const start = {
    label,
    sequence,
    repetition,
    scope,
    config,
    available,
    missingRequested: traceCategories.filter((category) => !available.includes(category)),
    observerBeganAt,
    traceStartedAt,
    readyForOriginalPressAt,
    before,
    beforeMetrics,
    mainPid: process.pid,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    limit:
      'Scratch diagnosis only. Original case/repetition/order/command/wait/limits/assertions/priorities unchanged. Observer overhead can extend the recorded raw case interval before its next press; nominal original window is press.at through press.until. Never accept these timing figures. No full Skia pictures, forced layout or forced memory dump.',
  };
  writeFileSync(join(folder, 'started.json'), JSON.stringify(start));
  let stopped = false;
  return async (press) => {
    if (stopped) return;
    stopped = true;
    const observerCloseBeganAt = now();
    const after = await pages(label + '-after', scope, 'after', press);
    const usage = await contentTracing.getTraceBufferUsage();
    const afterMetrics = metrics();
    const traceStopBeganAt = now();
    await contentTracing.stopRecording(join(folder, 'trace.json'));
    const traceStoppedAt = now();
    writeFileSync(
      join(folder, 'evidence.json'),
      JSON.stringify({
        ...start,
        press: press ?? null,
        observerCloseBeganAt,
        after,
        usage,
        afterMetrics,
        traceStopBeganAt,
        traceStoppedAt,
        nominalWindow: press ? { from: press.at, until: press.until } : null,
        coverage:
          'Read actual buffer use AND trace metadata loss/discard statistics. Missing/late pages, missing marks, clipped history or full buffers preclude absence claims. Warm-up entries distinguish existing end reasons; page histories are separate documents and later outputs are not the initial primary output.',
      }),
    );
  };
}

/** SCRATCH only: the same run's warm-up history, ending before the original measured import. */
export function startRetireStartup() {
  return startRetireTrace({
    name: 'initial warm-up',
    track: 'startup',
    setMs: 0,
    waitMs: 0,
    streaming: (sw('DRASHTI_PERF_STREAM') ?? '') !== '',
  });
}
