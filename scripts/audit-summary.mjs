// The dependency audit, advisory (Session 30, Q2): what `pnpm audit --json` found, summed up for the release's
// log. It never stops a release (blocking comes later); the high and critical ones are named.
//
//   pnpm audit --json > audit.json; node scripts/audit-summary.mjs audit.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORDER = ['critical', 'high', 'moderate', 'low', 'info'];

/** The summary's lines, from the audit's JSON (npm audit's report, as pnpm writes it). */
export function auditSummary(json) {
  let report;
  try {
    report = JSON.parse(json);
  } catch {
    return ['Dependency audit (advisory): its report could not be read.'];
  }
  const counts = report?.metadata?.vulnerabilities ?? {};
  const total = ORDER.reduce((n, k) => n + (Number(counts[k]) || 0), 0);
  const lines = [
    total === 0
      ? 'Dependency audit (advisory): no known vulnerabilities.'
      : `Dependency audit (advisory): ${ORDER.filter((k) => Number(counts[k]) > 0)
          .map((k) => `${String(counts[k])} ${k}`)
          .join(', ')}.`,
  ];
  const named = Object.values(report?.advisories ?? {})
    .filter((a) => a && (a.severity === 'critical' || a.severity === 'high'))
    .sort(
      (a, b) =>
        ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) ||
        String(a.module_name).localeCompare(String(b.module_name)),
    );
  for (const a of named) {
    const versions = [...new Set((a.findings ?? []).map((f) => f.version))].join(', ');
    lines.push(
      `  ${a.severity}: ${a.module_name}${versions ? ` ${versions}` : ''}: ${a.title}${a.url ? ` (${a.url})` : ''}`,
    );
  }
  return lines;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2] ?? '';
  const read = () => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };
  const text = read();
  process.stdout.write(`${auditSummary(text).join('\n')}\n`);
}
