// Compare two sets of the Performance check's raw slide changes (Sessions 31–36, PERF-2): the base's runs and
// the head's (each a perf-raw JSON file the Performance workflow keeps 90 days). For each segment of the hot
// path (key to main, main to frame, frame to the next, and key to frame in all) it gives the head's median
// and p95 against the base's, with a 95% bootstrap interval for the difference: changes resampled with
// replacement, a fixed seed, so the same files always give the same answer. An interval that holds 0 says
// no change; one wholly above, slower; wholly below, faster. docs/perf-ledger.md keeps the rounds.
//
//   node scripts/perf-compare.mjs --base base-1.json base-2.json --head head-1.json head-2.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The segments, from a run's changes (each change's own revision; one painted with another is left out). */
export function segmentValues(changes) {
  const of = (f) => changes.map(f).filter((v) => v !== null && Number.isFinite(v));
  return {
    'key to main': of((c) => (c.mainAt === null ? null : c.mainAt - c.keyAt)),
    'main to frame': of((c) => (c.mainAt === null || c.paintedAt === null ? null : c.paintedAt - c.mainAt)),
    'frame to the next': of((c) =>
      c.paintedAt === null || c.nextAt === null ? null : c.nextAt - c.paintedAt,
    ),
    'key to frame': of((c) => (c.paintedAt === null ? null : c.paintedAt - c.keyAt)),
  };
}

/** The p-th percentile (0 to 1), as the check's summary reads it. */
export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? NaN;
}

/** A small seeded random source (mulberry32): the same seed, the same draws. */
export function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** The head's statistic less the base's, with a 95% bootstrap interval. */
export function bootstrapDifference(base, head, stat, { iterations = 2000, seed = 31 } = {}) {
  const diff = stat(head) - stat(base);
  if (base.length === 0 || head.length === 0) return { diff: NaN, low: NaN, high: NaN };
  const random = seeded(seed);
  const resample = (v) => v.map(() => v[Math.floor(random() * v.length)]);
  const diffs = [];
  for (let i = 0; i < iterations; i++) diffs.push(stat(resample(head)) - stat(resample(base)));
  return { diff, low: percentile(diffs, 0.025), high: percentile(diffs, 0.975) };
}

const ms = (v) => (Number.isFinite(v) ? `${(Math.round(v * 10) / 10).toFixed(1)} ms` : '-');

/** What an interval says. */
export function verdict({ low, high }) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 'too few to tell';
  if (low > 0) return 'slower';
  if (high < 0) return 'faster';
  return 'no change';
}

/** The comparison, a line per segment and statistic. */
export function compare(baseChanges, headChanges, options) {
  const base = segmentValues(baseChanges);
  const head = segmentValues(headChanges);
  const lines = [];
  for (const segment of Object.keys(base))
    for (const [name, stat] of [
      ['median', (v) => percentile(v, 0.5)],
      ['p95', (v) => percentile(v, 0.95)],
    ]) {
      const d = bootstrapDifference(base[segment], head[segment], stat, options);
      lines.push(
        `${segment}, ${name}: base ${ms(stat(base[segment]))} (n=${base[segment].length}), head ${ms(stat(head[segment]))} (n=${head[segment].length}): ${d.diff >= 0 ? '+' : ''}${ms(d.diff)} [${ms(d.low)}, ${ms(d.high)}]: ${verdict(d)}`,
      );
    }
  return lines;
}

/** Every change in the files given (perf-raw JSON). */
export function changesIn(files) {
  return files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).changes ?? []);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const at = (flag) => args.indexOf(flag);
  const base = args.slice(at('--base') + 1, at('--head') > at('--base') ? at('--head') : undefined);
  const head = args.slice(at('--head') + 1, at('--base') > at('--head') ? at('--base') : undefined);
  if (at('--base') < 0 || at('--head') < 0 || base.length === 0 || head.length === 0) {
    process.stderr.write('Usage: node scripts/perf-compare.mjs --base <file>... --head <file>...\n');
    process.exit(2);
  }
  for (const line of compare(changesIn(base), changesIn(head))) process.stdout.write(`${line}\n`);
}
