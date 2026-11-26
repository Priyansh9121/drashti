// Used only on the Release runner. Command output is captured and never included in errors: security may echo
// its arguments. Only the temporary keychain path reaches packaging; the key and its password do not.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The certificate's name, as the owner's steps make it (scripts/signing-plan.mjs signs with it). */
export const IDENTITY = 'Drashti Code Signing';

/** A failure this script describes itself. */
export class SigningKeychainError extends Error {}

export function signingSourceAllowed(event, ref) {
  return (
    (event === 'push' || event === 'workflow_dispatch') &&
    (ref === 'refs/heads/main' || ref === 'refs/heads/release-dry-run')
  );
}

/** The .p12's import into the temporary keychain. */
export function importArgs(p12, keychain, password) {
  return [
    'import',
    p12,
    '-k',
    keychain,
    '-P',
    password,
    '-T',
    '/usr/bin/codesign',
    '-T',
    '/usr/bin/security',
  ];
}

/** Runs /usr/bin/security (through sudo -n as administrator); `spawn` is spawnSync but in tests. */
export function securityRunner(spawn = spawnSync) {
  return (args, administrator = false) => {
    const command = administrator ? '/usr/bin/sudo' : '/usr/bin/security';
    const commandArgs = administrator ? ['-n', '/usr/bin/security', ...args] : args;
    const result = spawn(command, commandArgs, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Signing keychain command failed; output suppressed.');
    return result.stdout;
  };
}

function keychainStep({ argv, env, platform, security, log }) {
  // No local keychain access: this utility belongs to a macOS Actions runner, not an owner's Mac.
  if (platform !== 'darwin' || !env.RUNNER_TEMP || env.GITHUB_ACTIONS !== 'true')
    throw new Error('Signing keychains are managed only on the macOS Actions runner.');
  const dir = join(env.RUNNER_TEMP, 'drashti-mac-sign');
  const keychain = join(dir, 'signing.keychain-db');
  const cert = join(dir, 'certificate.pem');
  if (argv.includes('--cleanup')) {
    // Also works after a partially failed import, before GITHUB_ENV was written.
    let failed = false;
    if (existsSync(cert)) {
      try {
        security(['remove-trusted-cert', '-d', cert], true);
      } catch {
        // Trust may not have been installed yet. Deleting the keychain is still mandatory.
      }
    }
    if (existsSync(keychain)) {
      try {
        security(['delete-keychain', keychain]);
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error('Could not delete the temporary signing keychain.');
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  // MUST precede reading either environment secret or writing any certificate file.
  if (!signingSourceAllowed(env.GITHUB_EVENT_NAME, env.GITHUB_REF))
    throw new Error('Refusing signing outside main or release-dry-run on a push or manual Release.');
  const encoded = env.MAC_SIGN_P12_BASE64;
  const password = env.MAC_SIGN_P12_PASSWORD;
  if (!encoded?.trim() || !password) {
    log(
      'No signing identity supplied: packaging keeps its existing signing choice (ad hoc without a Developer ID).',
    );
    return;
  }
  if (!env.GITHUB_ENV) throw new Error('Missing Actions environment file.');
  mkdirSync(dir, { mode: 0o700 });
  const p12 = join(dir, 'identity.p12');
  try {
    writeFileSync(p12, Buffer.from(encoded.trim(), 'base64'), { mode: 0o600 });
    const temporaryPassword = randomBytes(32).toString('hex');
    security(['create-keychain', '-p', temporaryPassword, keychain]);
    security(['set-keychain-settings', '-lut', '21600', keychain]);
    security(['unlock-keychain', '-p', temporaryPassword, keychain]);
    security(importArgs(p12, keychain, password));
    security(['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', temporaryPassword, keychain]);
    // electron-builder searches valid identities. Trust only the public certificate, only on this runner.
    // Noninteractive sudo uses the hosted runner’s admin store; no GUI trust prompt can block the build.
    writeFileSync(cert, security(['find-certificate', '-c', IDENTITY, '-p', keychain]), { mode: 0o600 });
    security(['add-trusted-cert', '-d', '-r', 'trustRoot', '-p', 'codeSign', '-k', keychain, cert], true);
    const identities = security(['find-identity', '-v', '-p', 'codesigning', keychain]);
    if (!identities.includes(`"${IDENTITY}"`)) throw new Error('The signing identity is not valid.');
    appendFileSync(env.GITHUB_ENV, `MAC_SIGN_KEYCHAIN=${keychain}\n`);
    log('Temporary signing identity ready.');
  } finally {
    rmSync(p12, { force: true });
  }
}

/** The command line: 0 when done, 1 with one line when not. */
export function runCli(argv, deps) {
  try {
    keychainStep({ argv, ...deps });
    return 0;
  } catch {
    deps.error('Signing keychain setup or cleanup failed; details suppressed to protect credentials.');
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = runCli(process.argv.slice(2), {
    env: process.env,
    platform: process.platform,
    security: securityRunner(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
