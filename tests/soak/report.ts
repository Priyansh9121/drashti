import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The soak test's report (Session 15): every sample, the verdicts, and the
 * curves, as JSON, a Markdown summary (for the workflow's summary) and an
 * HTML page of line charts (memory and processor per process, paint times
 * and late frames per screen, the log and the free disk), with a table of
 * every sample.
 */

export interface ProcessSample {
  label: string;
  memoryMb: number;
  /** Percent of one core, on average since the sample before. */
  cpu: number;
}

export interface OutputSample {
  name: string;
  /** Changes painted since the sample before. */
  paints: number;
  medianMs: number | null;
  p90Ms: number | null;
  worstMs: number | null;
  /** Frames that came late since the sample before. */
  lateFrames: number;
  black: boolean;
}

export interface SoakSample {
  /** Since the soak began. */
  minute: number;
  at: string;
  processes: ProcessSample[];
  outputs: OutputSample[];
  logMb: number;
  freeDiskGb: number;
  stream: {
    state: string;
    recording: string;
    recordingMb: number;
    fps: number | null;
    droppedFrames: number;
  };
  phoneConnected: boolean;
  nodeOnline: boolean;
  /** Watchdog events so far (a window crashed, hung or given up on), Main's and the node's. */
  watchdog: number;
}

export interface SoakEvent {
  minute: number;
  what: string;
}

export interface Verdict {
  name: string;
  ok: boolean;
  detail: string;
  /** A failing verdict that fails the soak (a crash, a watchdog event, a black screen, memory that keeps growing). */
  fatal: boolean;
}

export interface SoakReport {
  os: string;
  startedAt: string;
  minutes: number;
  samples: SoakSample[];
  events: SoakEvent[];
  verdicts: Verdict[];
}

/** The processes charted, in the categorical order their colours follow. */
export const PROCESSES = [
  'Main process',
  'GPU',
  'Operator window',
  'Outputs',
  'Audio player',
  'Program (stream)',
  'Workers',
  'Node (all of it)',
] as const;

/** The reference palette's categorical slots, in order (light and dark), validated as a set. */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

const mean = (v: readonly number[]) => (v.length === 0 ? NaN : v.reduce((a, b) => a + b, 0) / v.length);

/** The least-squares slope of y against x (per unit of x). */
export function slope(points: readonly [number, number][]): number {
  if (points.length < 2) return 0;
  const mx = mean(points.map((p) => p[0]));
  const my = mean(points.map((p) => p[1]));
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export interface Growth {
  /** Mean MB just after warming up, and over the last part. */
  early: number;
  late: number;
  /** MB per hour after warming up, and over the last third. */
  perHour: number;
  lastPerHour: number;
  keepsGrowing: boolean;
}

/**
 * Whether memory keeps growing: after warming up (the first quarter, at
 * most 30 minutes), the last part's mean is over a fifth (and 200 MB) above
 * the first part's, and it is still rising over the last third. A
 * plateau after a rise, or a sawtooth that comes back, passes.
 */
export function growth(points: readonly [number, number][], minutes: number): Growth {
  const warm = Math.min(30, minutes / 4);
  const span = Math.max(minutes / 12, Math.min(30, minutes / 6));
  const after = points.filter((p) => p[0] >= warm);
  const early = mean(after.filter((p) => p[0] < warm + span).map((p) => p[1]));
  const late = mean(after.filter((p) => p[0] >= minutes - span).map((p) => p[1]));
  const perHour = slope(after) * 60;
  const lastPerHour = slope(after.filter((p) => p[0] >= (minutes * 2) / 3)) * 60;
  const keepsGrowing =
    Number.isFinite(early) &&
    Number.isFinite(late) &&
    late - early > Math.max(200, early * 0.2) &&
    perHour > 0 &&
    lastPerHour > 0;
  return { early, late, perHour, lastPerHour, keepsGrowing };
}

/** A process's memory at each sample (MB), for one label. */
export const memoryOf = (samples: readonly SoakSample[], label: string): [number, number][] =>
  samples.map((s) => [s.minute, s.processes.find((p) => p.label === label)?.memoryMb ?? 0]);

/** Main's processes together (everything but the node), MB at each sample. */
export const mainTotal = (samples: readonly SoakSample[]): [number, number][] =>
  samples.map((s) => [
    s.minute,
    s.processes.filter((p) => !p.label.startsWith('Node')).reduce((sum, p) => sum + p.memoryMb, 0),
  ]);

// ---- the page -------------------------------------------------------------------------------------

interface Series {
  name: string;
  slot: number;
  points: [number, number][];
}

const esc = (s: string) => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const round = (n: number) => Math.round(n * 10) / 10;

/** Round numbers for an axis: 0 up to at least `max`, in about four steps. */
function ticks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(round(v));
  if ((out.at(-1) ?? 0) < max) out.push(round((out.at(-1) ?? 0) + step));
  return out;
}

/** One line chart: series against minutes, one y axis, direct labels at the ends, a hover layer. */
function lineChart(id: string, title: string, unit: string, series: Series[], minutes: number): string {
  const W = 760;
  const H = 300;
  const m = { l: 56, r: 150, t: 16, b: 36 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const ys = ticks(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p[1]))));
  const yMax = ys.at(-1) ?? 1;
  const xMax = Math.max(1, minutes);
  const xStep = xMax <= 30 ? 5 : xMax <= 90 ? 15 : 30;
  const x = (v: number) => m.l + (v / xMax) * pw;
  const y = (v: number) => m.t + ph - (v / yMax) * ph;
  const grid = ys
    .map(
      (v) =>
        `<line x1="${String(m.l)}" x2="${String(m.l + pw)}" y1="${String(y(v))}" y2="${String(y(v))}" class="grid"/><text x="${String(m.l - 8)}" y="${String(y(v) + 4)}" class="tick" text-anchor="end">${String(v)}</text>`,
    )
    .join('');
  const xticks: string[] = [];
  for (let v = 0; v <= xMax; v += xStep)
    xticks.push(
      `<text x="${String(x(v))}" y="${String(m.t + ph + 18)}" class="tick" text-anchor="middle">${String(v)}</text>`,
    );
  // End labels, nudged apart so they never sit on each other.
  const ends = series
    .filter((s) => s.points.length > 0)
    .map((s) => ({ s, y: y(s.points.at(-1)?.[1] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    const prev = ends[i - 1];
    const cur = ends[i];
    if (prev && cur && cur.y - prev.y < 13) cur.y = prev.y + 13;
  }
  const lines = series
    .map((s) => {
      const d = s.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`)
        .join('');
      return `<path d="${d}" class="line s${String(s.slot)}"/>`;
    })
    .join('');
  const labels = ends
    .map(
      (e) =>
        `<text x="${String(m.l + pw + 8)}" y="${(e.y + 4).toFixed(1)}" class="end">${esc(e.s.name)}</text><line x1="${String(m.l + pw + 1)}" x2="${String(m.l + pw + 6)}" y1="${e.y.toFixed(1)}" y2="${e.y.toFixed(1)}" class="line s${String(e.s.slot)}"/>`,
    )
    .join('');
  const legend =
    series.length >= 2
      ? `<ul class="legend">${series.map((s) => `<li><span class="key s${String(s.slot)}"></span>${esc(s.name)}</li>`).join('')}</ul>`
      : '';
  const data = JSON.stringify({
    unit,
    series: series.map((s) => ({ name: s.name, slot: s.slot, points: s.points })),
  });
  return `<figure class="chart" id="${id}">
<figcaption>${esc(title)} <span class="unit">(${esc(unit)})</span></figcaption>
${legend}
<svg viewBox="0 0 ${String(W)} ${String(H)}" role="img" aria-label="${esc(title)}">
${grid}${xticks.join('')}
<text x="${String(m.l + pw / 2)}" y="${String(H - 4)}" class="tick" text-anchor="middle">minutes</text>
${lines}${labels}
<line class="cross" x1="0" x2="0" y1="${String(m.t)}" y2="${String(m.t + ph)}" visibility="hidden"/>
<rect class="hit" x="${String(m.l)}" y="${String(m.t)}" width="${String(pw)}" height="${String(ph)}" data-x0="${String(m.l)}" data-pw="${String(pw)}" data-xmax="${String(xMax)}"/>
</svg>
<div class="tip" hidden></div>
<script type="application/json">${data.replace(/</gu, '\\u003c')}</script>
</figure>`;
}

const STYLE = `
:root { color-scheme: light dark; }
.viz-root {
  color-scheme: light;
  --surface-1: #fcfcfb; --text-primary: #0b0b0b; --text-secondary: #52514e; --grid: #e6e5e1;
  ${SERIES_LIGHT.map((c, i) => `--series-${String(i + 1)}: ${c};`).join(' ')}
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --surface-1: #1a1a19; --text-primary: #ffffff; --text-secondary: #c3c2b7; --grid: #34342f;
    ${SERIES_DARK.map((c, i) => `--series-${String(i + 1)}: ${c};`).join(' ')}
  }
}
:root[data-theme="dark"] .viz-root {
  color-scheme: dark;
  --surface-1: #1a1a19; --text-primary: #ffffff; --text-secondary: #c3c2b7; --grid: #34342f;
  ${SERIES_DARK.map((c, i) => `--series-${String(i + 1)}: ${c};`).join(' ')}
}
body { margin: 0; background: var(--surface-1); }
.viz-root { background: var(--surface-1); color: var(--text-primary); font: 14px/1.45 system-ui, sans-serif; padding: 16px; max-width: 800px; margin: 0 auto; }
h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
table { border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
th, td { border-bottom: 1px solid var(--grid); padding: 3px 8px; text-align: right; }
th:first-child, td:first-child { text-align: left; }
.ok { color: var(--text-primary); } .fail { color: var(--text-primary); font-weight: 700; }
.chart { margin: 20px 0; position: relative; } figcaption { font-weight: 600; } .unit { color: var(--text-secondary); font-weight: 400; }
svg { width: 100%; height: auto; display: block; overflow: visible; }
.grid { stroke: var(--grid); stroke-width: 1; } .tick, .end { fill: var(--text-secondary); font-size: 11px; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
${SERIES_LIGHT.map((_, i) => `.line.s${String(i + 1)} { stroke: var(--series-${String(i + 1)}); } .key.s${String(i + 1)} { background: var(--series-${String(i + 1)}); }`).join('\n')}
.legend { list-style: none; padding: 0; margin: 4px 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--text-secondary); }
.key { display: inline-block; width: 12px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.cross { stroke: var(--text-secondary); stroke-width: 1; } .hit { fill: transparent; }
.tip { position: absolute; pointer-events: none; background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--grid); border-radius: 6px; padding: 6px 8px; font-size: 12px; box-shadow: 0 2px 8px rgb(0 0 0 / 0.15); }
details { margin-top: 24px; } .scroll { overflow-x: auto; }
@media (max-width: 600px) { .viz-root { padding: 16px; } }
`;

/** Crosshair and tooltip: the nearest sample's values for every series. */
const SCRIPT = `
for (const fig of document.querySelectorAll('figure.chart')) {
  const data = JSON.parse(fig.querySelector('script[type="application/json"]').textContent);
  const svg = fig.querySelector('svg'); const hit = fig.querySelector('.hit'); const cross = fig.querySelector('.cross'); const tip = fig.querySelector('.tip');
  const xs = data.series[0] ? data.series[0].points.map((p) => p[0]) : [];
  const show = (clientX) => {
    const box = svg.getBoundingClientRect(); const scale = svg.viewBox.baseVal.width / box.width;
    const sx = (clientX - box.left) * scale; const x0 = +hit.dataset.x0, pw = +hit.dataset.pw, xmax = +hit.dataset.xmax;
    const minute = ((sx - x0) / pw) * xmax; if (!xs.length) return;
    let i = 0; for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - minute) < Math.abs(xs[i] - minute)) i = k;
    const px = x0 + (xs[i] / xmax) * pw; cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.innerHTML = '<strong>' + xs[i] + ' min</strong><br>' + data.series.map((s) => s.name + ': ' + (s.points[i] ? s.points[i][1] : '–') + ' ' + data.unit).join('<br>');
    const left = Math.min(box.width - 180, Math.max(0, (px / scale) + 12)); tip.style.left = left + 'px'; tip.style.top = '40px';
  };
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}
`;

function verdictRows(verdicts: readonly Verdict[]): string {
  return verdicts
    .map(
      (v) =>
        `<tr><td>${esc(v.name)}</td><td class="${v.ok ? 'ok' : 'fail'}">${v.ok ? 'Yes' : v.fatal ? 'NO (fails the soak)' : 'No'}</td><td>${esc(v.detail)}</td></tr>`,
    )
    .join('');
}

export function writeReport(dir: string, report: SoakReport): void {
  const { samples, minutes } = report;
  writeFileSync(join(dir, 'soak.json'), JSON.stringify(report, null, 1));
  const span = Math.max(minutes, samples.at(-1)?.minute ?? 0);
  const proc = (pick: (p: ProcessSample) => number): Series[] =>
    PROCESSES.map((label, i) => ({
      name: label,
      slot: i + 1,
      points: samples.map((s): [number, number] => [
        s.minute,
        round(pick(s.processes.find((p) => p.label === label) ?? { label, memoryMb: 0, cpu: 0 })),
      ]),
    })).filter((s) => s.points.some((p) => p[1] > 0));
  const outputs = [...new Set(samples.flatMap((s) => s.outputs.map((o) => o.name)))];
  const per = (pick: (o: OutputSample) => number | null): Series[] =>
    outputs.map((name, i) => ({
      name,
      slot: i + 1,
      points: samples.flatMap((s): [number, number][] => {
        const o = s.outputs.find((x) => x.name === name);
        const v = o ? pick(o) : null;
        return v === null ? [] : [[s.minute, round(v)]];
      }),
    }));
  const charts = [
    lineChart(
      'memory',
      'Memory, by process',
      'MB',
      proc((p) => p.memoryMb),
      span,
    ),
    lineChart(
      'cpu',
      'Processor, by process',
      '% of one core',
      proc((p) => p.cpu),
      span,
    ),
    lineChart(
      'paint',
      'Slide changes reaching each screen, 9 in 10 within',
      'ms',
      per((o) => o.p90Ms),
      span,
    ),
    lineChart(
      'late',
      'Late frames on each screen, since the sample before',
      'frames',
      per((o) => o.lateFrames),
      span,
    ),
    lineChart(
      'log',
      "Log files, Main's and the node's",
      'MB',
      [{ name: 'Logs', slot: 1, points: samples.map((s) => [s.minute, round(s.logMb)]) }],
      span,
    ),
    lineChart(
      'disk',
      'Free disk',
      'GB',
      [{ name: 'Free disk', slot: 1, points: samples.map((s) => [s.minute, round(s.freeDiskGb)]) }],
      span,
    ),
  ];
  const head = [
    'Minute',
    ...PROCESSES.map((p) => `${p} MB`),
    'Outputs p90 ms',
    'Late frames',
    'Logs MB',
    'Free GB',
    'Stream',
    'Rec MB',
    'Phone',
    'Node',
    'Watchdog',
  ];
  const rows = samples
    .map((s) =>
      [
        String(s.minute),
        ...PROCESSES.map((p) => String(round(s.processes.find((x) => x.label === p)?.memoryMb ?? 0))),
        s.outputs
          .map((o) => `${o.name}: ${o.p90Ms === null ? '–' : String(o.p90Ms)}${o.black ? ' BLACK' : ''}`)
          .join(', '),
        String(s.outputs.reduce((n, o) => n + o.lateFrames, 0)),
        String(round(s.logMb)),
        String(round(s.freeDiskGb)),
        s.stream.state,
        String(round(s.stream.recordingMb)),
        s.phoneConnected ? 'yes' : 'no',
        s.nodeOnline ? 'yes' : 'no',
        String(s.watchdog),
      ]
        .map((c) => `<td>${esc(c)}</td>`)
        .join(''),
    )
    .map((r) => `<tr>${r}</tr>`)
    .join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drashti soak test</title><style>${STYLE}</style></head>
<body><main class="viz-root">
<h1>Drashti soak test: ${esc(report.os)}, ${String(round(span))} minutes</h1>
<p>Started ${esc(report.startedAt)}. Placeholder content and generated media only.</p>
<h2>Verdicts</h2>
<table><thead><tr><th>Check</th><th>Passed</th><th>Detail</th></tr></thead><tbody>${verdictRows(report.verdicts)}</tbody></table>
${charts.join('\n')}
<h2>Events</h2>
<ul>${report.events.map((e) => `<li>${String(e.minute)} min: ${esc(e.what)}</li>`).join('')}</ul>
<details><summary>Every sample (a table of the charts)</summary><div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></details>
</main><script>${SCRIPT}</script></body></html>`;
  writeFileSync(join(dir, 'soak.html'), html);
  writeFileSync(join(dir, 'summary.md'), summaryMarkdown(report));
}

/** For the workflow's summary: the verdicts, then the memory at the start and the end, by process. */
export function summaryMarkdown(report: SoakReport): string {
  const first = report.samples[0];
  const last = report.samples.at(-1);
  const lines = [
    `## Soak test: ${report.os}, ${String(report.samples.at(-1)?.minute ?? 0)} minutes`,
    '',
    '| Check | Passed | Detail |',
    '| --- | --- | --- |',
    ...report.verdicts.map(
      (v) => `| ${v.name} | ${v.ok ? 'yes' : v.fatal ? '**NO**' : 'no'} | ${v.detail} |`,
    ),
    '',
    '| Process | MB at the first sample | MB at the last | MB per hour after warming up |',
    '| --- | ---: | ---: | ---: |',
    ...PROCESSES.map((p) => {
      const g = growth(memoryOf(report.samples, p), report.minutes);
      return `| ${p} | ${String(round(first?.processes.find((x) => x.label === p)?.memoryMb ?? 0))} | ${String(round(last?.processes.find((x) => x.label === p)?.memoryMb ?? 0))} | ${Number.isFinite(g.perHour) ? String(round(g.perHour)) : '–'} |`;
    }),
    '',
    'The curves are in the soak report (the artifact: soak.html, soak.json).',
  ];
  return lines.join('\n') + '\n';
}
