#!/usr/bin/env node
/*
 * Caps the crash files a CI run uploads with its Playwright report (Session 39). Each end-to-end test's Drashti
 * writes its crash files into the test's own folder (tests/e2e/helpers.ts), which Playwright keeps only when
 * the test fails (playwright.config.ts). A run where every test failed on a broken machine could keep
 * hundreds; this keeps the earliest, up to the cap, and lists what it left out (names and sizes only) in
 * <folder>/crash-files-left-out.txt.
 *
 *   node scripts/cap-crash-files.mjs [folder] [megabytes]    (defaults: test-results 200)
 */
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every file under a crash-files folder, oldest first. */
function crashFiles(dir, inside = false) {
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return names.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return crashFiles(path, inside || entry.name === 'crash-files');
    if (!inside || !entry.isFile()) return [];
    const st = statSync(path);
    return [{ path, bytes: st.size, at: st.mtimeMs }];
  });
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

/**
 * Keep the earliest crash files under `root` up to `capMb` megabytes and remove the rest, listing them.
 * @param {string} root
 * @param {number} capMb
 * @returns {{ kept: number; keptBytes: number; leftOut: string[]; line: string }}
 */
export function capCrashFiles(root, capMb) {
  const files = crashFiles(root).sort((a, b) => a.at - b.at || a.path.localeCompare(b.path));
  const cap = capMb * 1024 * 1024;
  let keptBytes = 0;
  const leftOut = [];
  for (const file of files) {
    if (keptBytes + file.bytes <= cap) keptBytes += file.bytes;
    else leftOut.push(file);
  }
  for (const file of leftOut) rmSync(file.path, { force: true });
  if (leftOut.length > 0)
    writeFileSync(
      join(root, 'crash-files-left-out.txt'),
      [
        `Crash files left out of this report: ${String(leftOut.length)} (${mb(leftOut.reduce((n, f) => n + f.bytes, 0))} MB), past the cap of ${String(capMb)} MB. The earliest are kept.`,
        ...leftOut.map((f) => `${relative(root, f.path)} ${String(f.bytes)} bytes`),
        '',
      ].join('\n'),
    );
  const kept = files.length - leftOut.length;
  return {
    kept,
    keptBytes,
    leftOut: leftOut.map((f) => relative(root, f.path)),
    line: `Crash files in the report: ${String(kept)} kept (${mb(keptBytes)} MB), ${String(leftOut.length)} left out (cap ${String(capMb)} MB).`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const capMb = Number(process.argv[3] ?? 200);
  if (!Number.isFinite(capMb) || capMb <= 0) {
    console.error('The cap must be a number of megabytes above 0.');
    process.exit(2);
  }
  console.log(capCrashFiles(process.argv[2] ?? 'test-results', capMb).line);
}
