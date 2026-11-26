// Drashti's own signing identity on the macOS Release runner (QA24-SIGN-1), and only there: the release
// environment's .p12 (MAC_SIGN_P12_BASE64, MAC_SIGN_P12_PASSWORD) in a temporary keychain for packaging.
//
//   node scripts/mac-sign-keychain.mjs               import it (without either secret: nothing, exit 0)
//   node scripts/mac-sign-keychain.mjs --delete-key  straight after the signature check: the keychain, and with it
//                                                    the key, goes before any step runs the packaged programs
//   node scripts/mac-sign-keychain.mjs --cleanup     the job's last step, always: the runner's trust and the rest
//
// Command output is captured and never printed: security may echo its arguments. A failure names only the
// security subcommand that failed (for the import, also one fixed reason matched from its words), or a reason
// this script gives itself; never an argument, an output or a secret. Before the import, one line names the
// .p12's public algorithms (never a byte of it). A password that fails with whitespace at its ends is tried once
// without it, with a fixed line saying so. Only the temporary keychain's path reaches packaging; the key and its
// password do not.
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

/**
 * What security's words on a failed command come to, as a code: they are matched here and dropped, never kept,
 * printed or thrown (they can repeat the arguments, and so the password). A wrong password's "MAC verification
 * failed" can also be an older security tool that cannot check a newer .p12's MAC: the algorithm line logged
 * before the import tells those apart.
 */
export function importFailure(output) {
  const said = String(output).toLowerCase();
  if (/mac verification failed|wrong password|passphrase/u.test(said)) return 'password';
  if (/unknown format|unsupported|not supported|decod/u.test(said)) return 'format';
  if (/invalid/u.test(said)) return 'invalid';
  return 'unknown';
}

/** The one fixed reason a failed import prints; `pfx`: the file has a .p12's outer shape (describeP12). */
export function importReason(failure, pfx) {
  if (failure === 'password') return 'wrong password';
  if (failure === 'format' && pfx) return "the .p12's format is not readable by this runner's security tool";
  if (failure === 'format' || failure === 'invalid') return 'the file is not a .p12';
  return 'unknown reason';
}

/** A failed security command: its subcommand and a reason code, never its arguments or output. */
export class SecurityCommandError extends SigningKeychainError {
  constructor(subcommand, failure) {
    super(`Signing keychain command failed: security ${subcommand}`);
    this.subcommand = subcommand;
    this.failure = failure;
  }
}

/** Runs /usr/bin/security (through sudo -n as administrator); `spawn` is spawnSync but in tests. */
export function securityRunner(spawn = spawnSync) {
  return (args, administrator = false) => {
    const command = administrator ? '/usr/bin/sudo' : '/usr/bin/security';
    const commandArgs = administrator ? ['-n', '/usr/bin/security', ...args] : args;
    const result = spawn(command, commandArgs, { encoding: 'utf8' });
    // The subcommand alone: the others can hold a password, and the output can repeat them.
    if (result.status !== 0)
      throw new SecurityCommandError(
        String(args[0]),
        importFailure(`${result.stderr ?? ''}\n${result.stdout ?? ''}`),
      );
    return result.stdout;
  };
}

/*
 * The .p12's public structure (RFC 7292), read before the import: which algorithms protect it and its MAC. Only
 * names from this table are ever printed, never a byte of the file, its salts, counts or digests.
 */
const ALGORITHMS = new Map([
  ['1.2.840.113549.1.12.1.1', 'pbeWithSHAAnd128BitRC4'],
  ['1.2.840.113549.1.12.1.2', 'pbeWithSHAAnd40BitRC4'],
  ['1.2.840.113549.1.12.1.3', 'pbeWithSHAAnd3-KeyTripleDES-CBC'],
  ['1.2.840.113549.1.12.1.4', 'pbeWithSHAAnd2-KeyTripleDES-CBC'],
  ['1.2.840.113549.1.12.1.5', 'pbeWithSHAAnd128BitRC2-CBC'],
  ['1.2.840.113549.1.12.1.6', 'pbeWithSHAAnd40BitRC2-CBC'],
  ['1.2.840.113549.1.5.13', 'PBES2'],
  ['1.2.840.113549.1.5.12', 'PBKDF2'],
  ['1.2.840.113549.1.5.14', 'PBMAC1'],
  ['1.2.840.113549.3.7', 'DES-EDE3-CBC'],
  ['2.16.840.1.101.3.4.1.2', 'AES-128-CBC'],
  ['2.16.840.1.101.3.4.1.22', 'AES-192-CBC'],
  ['2.16.840.1.101.3.4.1.42', 'AES-256-CBC'],
  ['1.2.840.113549.2.7', 'HMAC-SHA-1'],
  ['1.2.840.113549.2.8', 'HMAC-SHA-224'],
  ['1.2.840.113549.2.9', 'HMAC-SHA-256'],
  ['1.2.840.113549.2.10', 'HMAC-SHA-384'],
  ['1.2.840.113549.2.11', 'HMAC-SHA-512'],
  ['1.3.14.3.2.26', 'SHA-1'],
  ['2.16.840.1.101.3.4.2.4', 'SHA-224'],
  ['2.16.840.1.101.3.4.2.1', 'SHA-256'],
  ['2.16.840.1.101.3.4.2.2', 'SHA-384'],
  ['2.16.840.1.101.3.4.2.3', 'SHA-512'],
]);
const PKCS7_DATA = '1.2.840.113549.1.7.1';
const PKCS7_SIGNED_DATA = '1.2.840.113549.1.7.2';

/** One DER element at `at`: its tag and where its contents start and end; null if it does not fit (or is BER). */
function element(bytes, at) {
  if (at + 2 > bytes.length) return null;
  let length = bytes[at + 1];
  let start = at + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    // 0: BER's indefinite length, which DER never uses.
    if (count === 0 || count > 4 || start + count > bytes.length) return null;
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[start + i];
    start += count;
  }
  const end = start + length;
  return end <= bytes.length ? { tag: bytes[at], start, end } : null;
}

/** An OBJECT IDENTIFIER's contents in dotted form, or '' if they are not one. */
function dotted(bytes, start, end) {
  const arcs = [];
  let value = 0;
  for (let i = start; i < end; i += 1) {
    value = value * 128 + (bytes[i] & 0x7f);
    if ((bytes[i] & 0x80) === 0) {
      arcs.push(value);
      value = 0;
    }
  }
  if (arcs.length < 2 || (bytes[end - 1] & 0x80) !== 0) return '';
  const first = arcs[0];
  const head = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
  return [...head, ...arcs.slice(1)].join('.');
}

/** The known algorithm names in bytes [from, to), in the order they first appear. */
function knownNames(bytes, from, to) {
  const names = [];
  for (let i = from; i + 2 < to; i += 1) {
    const length = bytes[i + 1];
    if (bytes[i] !== 0x06 || length < 3 || length > 20 || i + 2 + length > to) continue;
    const name = ALGORITHMS.get(dotted(bytes, i + 2, i + 2 + length));
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function oidOf(bytes, at) {
  const id = element(bytes, at);
  return id && id.tag === 0x06 ? dotted(bytes, id.start, id.end) : '';
}

/**
 * The .p12's algorithm names (PFX: version 3, the content, then MacData), for one log line before the import.
 * `pfx` is whether it has a .p12's outer shape; a structure this cannot walk still has its names listed.
 */
export function describeP12(bytes) {
  const top = element(bytes, 0);
  const version = top && top.tag === 0x30 ? element(bytes, top.start) : null;
  const content = version && version.tag === 0x02 ? element(bytes, version.end) : null;
  const walked = Boolean(top && content && content.tag === 0x30 && content.end <= top.end);
  const pfx =
    walked &&
    version.end - version.start === 1 &&
    bytes[version.start] === 3 &&
    [PKCS7_DATA, PKCS7_SIGNED_DATA].includes(oidOf(bytes, content.start));
  let encryption;
  let mac;
  if (!walked) {
    encryption = knownNames(bytes, 0, bytes.length);
    mac = 'unknown';
  } else {
    encryption = knownNames(bytes, content.start, content.end);
    const macData = content.end < top.end ? element(bytes, content.end) : null;
    const inMac = macData && macData.tag === 0x30 ? knownNames(bytes, macData.start, macData.end) : [];
    const digest = inMac.find((name) => /^SHA-/u.test(name));
    if (!macData) mac = 'none';
    else if (inMac.includes('PBMAC1'))
      mac = `PBMAC1 (${inMac.filter((name) => name !== 'PBMAC1').join(' + ') || 'unknown'})`;
    else mac = digest ? `HMAC-${digest}` : 'unknown';
  }
  const uses = encryption.length > 0 ? encryption.join(' + ') : 'no algorithm this check knows';
  return { pfx, encryption, mac, line: `Signing: .p12 uses ${uses}, MAC ${mac}` };
}

export const NOT_A_P12 = 'MAC_SIGN_P12_BASE64 is not a .p12 in base64.';

/** The secret's bytes: base64 (line breaks allowed) of a DER SEQUENCE, or the fixed refusal, holding no byte. */
export function decodeP12(encoded) {
  const text = encoded.replace(/\s+/gu, '');
  const bytes = /^[A-Za-z0-9+/]+={0,2}$/u.test(text) ? Buffer.from(text, 'base64') : Buffer.alloc(0);
  if (bytes.length === 0 || bytes[0] !== 0x30) throw new SigningKeychainError(NOT_A_P12);
  return bytes;
}

const TRAILING_LINE_BREAK = 'Signing: the password secret had a trailing line break; it was used without it.';
const SPACES_AT_ENDS =
  'Signing: the password secret had spaces at its start or end; it was used without them.';
const BOTH_TRIED =
  " (tried as given, and again without the password secret's leading and trailing whitespace)";

/**
 * The import with the password exactly as given; if that fails and the password has whitespace at its ends
 * (`openssl rand -base64 30 | pbcopy` copies a line break with it, which a secret pasted from it may keep),
 * once more without it. A failure names one fixed reason; nothing security said, and no password, is printed.
 */
function importIdentity({ security, log }, p12, keychain, password, pfx) {
  const failed = (error, suffix) =>
    error instanceof SecurityCommandError
      ? new SigningKeychainError(
          `Signing keychain command failed: security import: ${importReason(error.failure, pfx)}${suffix}`,
        )
      : error;
  try {
    security(importArgs(p12, keychain, password));
    return;
  } catch (error) {
    const trimmed = password.trim();
    if (trimmed === password || trimmed === '') throw failed(error, '');
  }
  try {
    security(importArgs(p12, keychain, password.trim()));
  } catch (error) {
    throw failed(error, BOTH_TRIED);
  }
  log(/[\r\n]$/u.test(password) ? TRAILING_LINE_BREAK : SPACES_AT_ENDS);
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
  // Checked and described before anything is made: its public algorithm names only.
  const bytes = decodeP12(encoded);
  const { pfx, line } = describeP12(bytes);
  log(line);
  mkdirSync(dir, { mode: 0o700 });
  try {
    writeFileSync(p12, bytes, { mode: 0o600 });
    const temporaryPassword = randomBytes(32).toString('hex');
    security(['create-keychain', '-p', temporaryPassword, keychain]);
    security(['set-keychain-settings', '-lut', '21600', keychain]);
    security(['unlock-keychain', '-p', temporaryPassword, keychain]);
    importIdentity({ security, log }, p12, keychain, password, pfx);
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
