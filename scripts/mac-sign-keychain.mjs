// Drashti's own signing identity on the macOS Release runner (QA24-SIGN-1), and only there: the release
// environment's .p12 (MAC_SIGN_P12_BASE64, MAC_SIGN_P12_PASSWORD) in a temporary keychain for packaging.
//
//   node scripts/mac-sign-keychain.mjs               import it (without either secret: nothing, exit 0)
//   node scripts/mac-sign-keychain.mjs --delete-key  straight after the signature check: the keychain, and with it
//                                                    the key, goes before any step runs the packaged programs
//   node scripts/mac-sign-keychain.mjs --cleanup     the job's last step, always: the runner's trust and the rest
//
// Command output is captured and never printed: security may echo its arguments. A failure names only the
// security subcommand that failed, or a reason this script gives itself; never an argument, an output or a
// secret. Only the temporary keychain's path reaches packaging; the key and its password do not.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The certificate's name, as the owner's steps make it (scripts/signing-plan.mjs signs with it). */
export const IDENTITY = 'Drashti Code Signing';

/** A failure this script describes itself: its message holds no argument, output or secret, so it is printed. */
export class SigningKeychainError extends Error {}

export function signingSourceAllowed(event, ref) {
  return (
    (event === 'push' || event === 'workflow_dispatch') &&
    (ref === 'refs/heads/main' || ref === 'refs/heads/release-dry-run')
  );
}

/**
 * The .p12's import into the temporary keychain (the signing review's MUST 2): the private key non-extractable
 * (-x), so no later step can export it, and usable by /usr/bin/codesign alone. electron-builder's own import also
 * lists /usr/bin/productbuild, for .pkg installers, which Drashti does not make; never /usr/bin/security, which
 * could export the key.
 */
export function importArgs(p12, keychain, password) {
  return ['import', p12, '-k', keychain, '-P', password, '-x', '-T', '/usr/bin/codesign'];
}

/** Runs /usr/bin/security (through sudo -n as administrator); `spawn` is spawnSync but in tests. */
export function securityRunner(spawn = spawnSync) {
  return (args, administrator = false) => {
    const command = administrator ? '/usr/bin/sudo' : '/usr/bin/security';
    const commandArgs = administrator ? ['-n', '/usr/bin/security', ...args] : args;
    const result = spawn(command, commandArgs, { encoding: 'utf8' });
    // The subcommand alone: the others can hold a password, and the output can repeat them.
    if (result.status !== 0)
      throw new SigningKeychainError(`Signing keychain command failed: security ${String(args[0])}`);
    return result.stdout;
  };
}

const MODES = ['--delete-key', '--cleanup'];

function keychainStep({ argv, env, platform, security, log }) {
  // No local keychain access: this utility belongs to a macOS Actions runner, not an owner's Mac.
  if (platform !== 'darwin' || !env.RUNNER_TEMP || env.GITHUB_ACTIONS !== 'true')
    throw new SigningKeychainError('Signing keychains are managed only on the macOS Actions runner.');
  if (argv.length > 1 || argv.some((a) => !MODES.includes(a)))
    throw new SigningKeychainError('Unknown argument: give none, --delete-key or --cleanup.');
  const dir = join(env.RUNNER_TEMP, 'drashti-mac-sign');
  const keychain = join(dir, 'signing.keychain-db');
  const cert = join(dir, 'certificate.pem');
  const p12 = join(dir, 'identity.p12');
  if (argv.length === 1) {
    // Also works after a partly failed import, before GITHUB_ENV was written. A .p12 left by a step stopped
    // mid-import goes first, whatever fails after.
    rmSync(p12, { force: true });
    const all = argv[0] === '--cleanup';
    // The trust only at the end: it is the public certificate's, signs nothing, and the checks after the
    // signature check run as they did with it.
    if (all && existsSync(cert)) {
      try {
        security(['remove-trusted-cert', '-d', cert], true);
      } catch {
        // Trust may not have been set yet. Deleting the keychain is still mandatory.
      }
    }
    // A keychain that will not go stays named in the failure, and on disk for the last cleanup's second try.
    if (existsSync(keychain)) security(['delete-keychain', keychain]);
    if (all) rmSync(dir, { recursive: true, force: true });
    return;
  }
  // MUST precede reading either environment secret or writing any certificate file.
  if (!signingSourceAllowed(env.GITHUB_EVENT_NAME, env.GITHUB_REF))
    throw new SigningKeychainError(
      'Refusing signing outside main or release-dry-run on a push or manual Release.',
    );
  const encoded = env.MAC_SIGN_P12_BASE64?.trim() ?? '';
  const password = env.MAC_SIGN_P12_PASSWORD ?? '';
  if (encoded === '' && password === '') {
    log(
      'No signing identity supplied: packaging keeps its existing signing choice (ad hoc without a Developer ID).',
    );
    return;
  }
  // One without the other is a mistake (a secret misnamed or emptied): never a quiet ad hoc build, which would
  // cost every hall Mac its permissions once signed builds have shipped (the signing review's SHOULD 2).
  if (encoded === '' || password === '') {
    const [empty, set] =
      encoded === ''
        ? ['MAC_SIGN_P12_BASE64', 'MAC_SIGN_P12_PASSWORD']
        : ['MAC_SIGN_P12_PASSWORD', 'MAC_SIGN_P12_BASE64'];
    throw new SigningKeychainError(
      `${empty} is empty but ${set} is set: give the release environment both signing secrets, or neither.`,
    );
  }
  if (!env.GITHUB_ENV) throw new SigningKeychainError('Missing Actions environment file.');
  mkdirSync(dir, { mode: 0o700 });
  try {
    writeFileSync(p12, Buffer.from(encoded, 'base64'), { mode: 0o600 });
    const temporaryPassword = randomBytes(32).toString('hex');
    security(['create-keychain', '-p', temporaryPassword, keychain]);
    security(['set-keychain-settings', '-lut', '21600', keychain]);
    security(['unlock-keychain', '-p', temporaryPassword, keychain]);
    security(importArgs(p12, keychain, password));
    security(['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', temporaryPassword, keychain]);
    // electron-builder searches valid identities. Trust only the public certificate, only on this runner.
    // Noninteractive sudo uses the hosted runner’s admin store; no GUI trust prompt can block the build. No -k:
    // the certificate is in the keychain already (from the .p12), and without it add-trusted-cert adds it to
    // no keychain, only to the trust settings (Apple's SecurityTool, trusted_cert_add.c).
    writeFileSync(cert, security(['find-certificate', '-c', IDENTITY, '-p', keychain]), { mode: 0o600 });
    security(['add-trusted-cert', '-d', '-r', 'trustRoot', '-p', 'codeSign', cert], true);
    const identities = security(['find-identity', '-v', '-p', 'codesigning', keychain]);
    if (!identities.includes(`"${IDENTITY}"`))
      throw new SigningKeychainError('The signing identity is not valid.');
    appendFileSync(env.GITHUB_ENV, `MAC_SIGN_KEYCHAIN=${keychain}\n`);
    log('Temporary signing identity ready.');
  } finally {
    rmSync(p12, { force: true });
  }
}

/** The command line: 0 when done; 1 with one line saying what failed, which never holds a secret. */
export function runCli(argv, deps) {
  try {
    keychainStep({ argv, ...deps });
    return 0;
  } catch (error) {
    deps.error(
      error instanceof SigningKeychainError
        ? error.message
        : 'Signing keychain setup or cleanup failed; details suppressed to protect credentials.',
    );
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
