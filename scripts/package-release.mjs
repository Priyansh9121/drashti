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
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env };
const has = (name) => typeof process.env[name] === 'string' && process.env[name].trim() !== '';
const temp = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'drashti-signing-'));
const writeSecret = (name, data) => {
  const file = join(temp, name);
  writeFileSync(file, data, { mode: 0o600 });
  return file;
};
const SIGNING_VARS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
];
// Start from nothing: only what this script sets below can turn signing on.
for (const name of SIGNING_VARS) delete env[name];
const extra = [];
let signed = false;
let notarised = false;
let how = 'unsigned (no certificate given)';

if (process.platform === 'darwin' && has('MAC_CERT_P12')) {
  env.CSC_LINK = writeSecret('developer-id.p12', Buffer.from(process.env.MAC_CERT_P12.trim(), 'base64'));
  env.CSC_KEY_PASSWORD = process.env.MAC_CERT_PASSWORD ?? '';
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
  signed = true;
  how = 'signed with a Developer ID';
  if (has('APPLE_API_KEY_P8') && has('APPLE_API_KEY_ID') && has('APPLE_API_ISSUER')) {
    env.APPLE_API_KEY = writeSecret('app-store-connect.p8', process.env.APPLE_API_KEY_P8.trim() + '\n');
    env.APPLE_API_KEY_ID = process.env.APPLE_API_KEY_ID.trim();
    env.APPLE_API_ISSUER = process.env.APPLE_API_ISSUER.trim();
    notarised = true;
    how += ', and notarised';
  } else how += ', not notarised (no App Store Connect key given)';
} else if (process.platform === 'win32' && has('WIN_CERT_PFX')) {
  env.WIN_CSC_LINK = writeSecret('code-signing.pfx', Buffer.from(process.env.WIN_CERT_PFX.trim(), 'base64'));
  env.WIN_CSC_KEY_PASSWORD = process.env.WIN_CERT_PASSWORD ?? '';
  signed = true;
  how = 'signed with a code-signing certificate';
} else if (
  process.platform === 'win32' &&
  ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'].every(has) &&
  ['AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE', 'AZURE_PUBLISHER_NAME'].every(
    has,
  )
) {
  // The account, profile and publisher are names, not secrets; the credentials stay in the environment.
  extra.push(
    `-c.win.azureSignOptions.endpoint=${process.env.AZURE_SIGNING_ENDPOINT.trim()}`,
    `-c.win.azureSignOptions.codeSigningAccountName=${process.env.AZURE_SIGNING_ACCOUNT.trim()}`,
    `-c.win.azureSignOptions.certificateProfileName=${process.env.AZURE_SIGNING_PROFILE.trim()}`,
    `-c.win.azureSignOptions.publisherName=${process.env.AZURE_PUBLISHER_NAME.trim()}`,
  );
  signed = true;
  how = 'signed with Azure Trusted Signing';
}
if (!signed) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
// No certificate on a Mac (Session 18): signed ad hoc all through, so that a downloaded copy is one macOS
// "could not verify" (opened once with Open Anyway in System Settings, Privacy & Security), not one it
// calls "damaged" (an app whose own signature does not cover it, as electron-builder leaves an unsigned
// one: there is no Open Anyway for that). Without the hardened runtime, which only notarisation needs
// and whose library validation stops an app signed ad hoc from starting.
if (!signed && process.platform === 'darwin') {
  extra.push('-c.mac.identity=-', '-c.mac.hardenedRuntime=false');
  how = 'signed ad hoc (no certificate given)';
}
console.log(`Signing: ${how}.`);

const result = spawnSync('pnpm', ['exec', 'electron-builder', '--publish', 'never', ...extra], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
rmSync(temp, { recursive: true, force: true });
writeFileSync(
  'release-signing.json',
  `${JSON.stringify({ platform: process.platform, signed, notarised })}\n`,
);
if (result.status !== 0) process.exit(result.status ?? 1);

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
process.exit(missing === 0 ? 0 : 1);
