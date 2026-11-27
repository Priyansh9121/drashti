#!/usr/bin/env node
// Package the installers for a release (the Release workflow, Session 14): signed and notarised when
// the certificates are given as CI secrets, and left unsigned, cleanly, when they are not. A secret is
// only ever written to a file in the runner's temporary folder (removed afterwards) or passed in the
// environment to electron-builder; nothing here prints one, only whether signing is on.
//
//   macOS:   MAC_CERT_P12 (base64 of the Developer ID Application .p12) and MAC_CERT_PASSWORD;
//            notarised too with APPLE_API_KEY_P8 (the App Store Connect key's text), APPLE_API_KEY_ID
//            and APPLE_API_ISSUER.
//   Windows: WIN_CERT_PFX (base64 of a .pfx) and WIN_CERT_PASSWORD; or Azure Trusted Signing with
//            AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SIGNING_ENDPOINT,
//            AZURE_SIGNING_ACCOUNT, AZURE_SIGNING_PROFILE and AZURE_PUBLISHER_NAME.
//
// Writes release-signing.json ({ platform, signed, notarised }) for scripts/verify-signing.mjs.
//
// Then (Session 18) it gives this computer's installers the names that never change
// (build/downloads.json: Drashti-mac-apple-silicon.dmg and so on), so GitHub's
// releases/latest/download/<name> link always gives the newest.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGING_SECRETS, failureReport } from './packaging-failure.mjs';
import { signingPlan } from './signing-plan.mjs';

const temp = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'drashti-signing-'));
const writeSecret = (name, data) => {
  const file = join(temp, name);
  writeFileSync(file, data, { mode: 0o600 });
  return file;
};
// Which certificate signs, if any: scripts/signing-plan.mjs (its tests: src/main/release-checks/signing-plan.test.ts).
const { env, extra, how, record } = signingPlan({
  platform: process.platform,
  given: process.env,
  writeSecret,
});
console.log(`Signing: ${how}.`);

// electron-builder's own script, run by this Node: no shell anywhere (Session 30, SEC-1: on Windows a shell
// read every argument again, and pnpm there is a .cmd that needs one).
// Its output is passed on to the log as it comes, and its last part kept: if it fails, the run's page gets those
// lines too (scripts/packaging-failure.mjs), which stay when a job's log is lost (the third signed dry run's was).
const builder = createRequire(import.meta.url).resolve('electron-builder/cli.js');
const child = spawn(process.execPath, [builder, '--publish', 'never', ...extra], {
  env,
  stdio: ['inherit', 'pipe', 'pipe'],
});
const kept = [];
let keptBytes = 0;
const keep = (chunk) => {
  kept.push(chunk);
  keptBytes += chunk.length;
  while (keptBytes > 256 * 1024 && kept.length > 1) keptBytes -= kept.shift().length;
};
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  keep(chunk);
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  keep(chunk);
});
const status = await new Promise((resolve) => {
  child.on('error', () => resolve(1));
  child.on('close', (code) => resolve(code ?? 1));
});
rmSync(temp, { recursive: true, force: true });
writeFileSync('release-signing.json', `${JSON.stringify(record)}\n`);

// exitCode, not exit(): a pipe's writes on macOS and Windows are asynchronous, and the last lines matter most.
if (status !== 0) {
  const report = failureReport(Buffer.concat(kept).toString('utf8'), {
    status,
    secrets: PACKAGING_SECRETS.map((name) => process.env[name]),
  });
  console.log(report.annotation);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.summary);
  process.exitCode = status;
} else {
  // The names that never change, for this computer's installers.
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const { files } = JSON.parse(readFileSync(join('build', 'downloads.json'), 'utf8'));
  const out = join('release', version);
  let missing = 0;
  for (const f of files.filter((x) => x.platform === process.platform)) {
    const built = join(out, f.built.replace('{version}', version));
    if (!existsSync(built)) {
      console.log(`Missing: ${built} (for ${f.for})`);
      missing++;
      continue;
    }
    renameSync(built, join(out, f.name));
    console.log(`${f.name}  (for ${f.for})`);
  }
  process.exitCode = missing === 0 ? 0 : 1;
}
