import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SpawnResult } from '../../../scripts/mac-sign-keychain.mjs';
import {
  decodeP12,
  describeP12,
  importArgs,
  importFailure,
  importReason,
  NOT_A_P12,
  runCli,
  SecurityCommandError,
  securityRunner,
  signingSourceAllowed,
} from '../../../scripts/mac-sign-keychain.mjs';

// No real certificate or keychain: this gate must run before the importer reads either secret.
describe('the signing keychain source gate', () => {
  it('accepts only trusted branch refs with push or workflow_dispatch events', () => {
    for (const event of ['push', 'workflow_dispatch'])
      for (const ref of ['refs/heads/main', 'refs/heads/release-dry-run'])
        expect(signingSourceAllowed(event, ref)).toBe(true);
    for (const event of ['pull_request', 'pull_request_target', '', 'workflow_run'])
      expect(signingSourceAllowed(event, 'refs/heads/main')).toBe(false);
    for (const ref of ['refs/tags/v1', 'refs/pull/1/merge', 'refs/heads/other', 'main', ''])
      expect(signingSourceAllowed('workflow_dispatch', ref)).toBe(false);
  });
});

/*
 * Hand-made DER in the shape of a PKCS #12 file (RFC 7292): its public structure (algorithm identifiers), with
 * placeholder bytes where a real one holds salts, ciphertext and digests. No real certificate or key.
 */
function der(tag: number, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children);
  const n = body.length;
  const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}
function oid(dotted: string): Buffer {
  const [a = 0, b = 0, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * a + b];
  for (const arc of rest) {
    const groups = [arc & 0x7f];
    for (let v = arc >> 7; v > 0; v >>= 7) groups.unshift((v & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return der(0x06, Buffer.from(bytes));
}
const seq = (...c: Buffer[]) => der(0x30, ...c);
const int = (...bytes: number[]) => der(0x02, Buffer.from(bytes));
const filler = (byte: number, n: number) => der(0x04, Buffer.alloc(n, byte));
const holding = (...c: Buffer[]) => der(0x04, ...c);
const tagged = (...c: Buffer[]) => der(0xa0, ...c);
const algorithm = (id: string, params: Buffer = der(0x05)) => seq(oid(id), params);
const ID = {
  data: '1.2.840.113549.1.7.1',
  encryptedData: '1.2.840.113549.1.7.6',
  shroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  rc2With40Bits: '1.2.840.113549.1.12.1.6',
  tripleDes: '1.2.840.113549.1.12.1.3',
  pbes2: '1.2.840.113549.1.5.13',
  pbkdf2: '1.2.840.113549.1.5.12',
  pbmac1: '1.2.840.113549.1.5.14',
  hmacSha1: '1.2.840.113549.2.7',
  hmacSha256: '1.2.840.113549.2.9',
  hmacSha512: '1.2.840.113549.2.11',
  aes128: '2.16.840.1.101.3.4.1.2',
  aes256: '2.16.840.1.101.3.4.1.42',
  sha1: '1.3.14.3.2.26',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha512: '2.16.840.1.101.3.4.2.3',
};
const pkcs12Pbe = (id: string) => algorithm(id, seq(filler(0xaa, 8), int(0x08, 0x00)));
const pbkdf2 = (prf: string) => algorithm(ID.pbkdf2, seq(filler(0xaa, 8), int(0x08, 0x00), algorithm(prf)));
const pbes2 = (prf: string, cipher: string) =>
  algorithm(ID.pbes2, seq(pbkdf2(prf), algorithm(cipher, filler(0xbb, 16))));
const macData = (digestAlgorithm: Buffer) =>
  seq(seq(digestAlgorithm, filler(0xdd, 32)), filler(0xaa, 8), int(0x08, 0x00));
function pfx(key: Buffer, certificates: Buffer, mac: Buffer | null): Buffer {
  const keyBag = seq(oid(ID.shroudedKeyBag), tagged(seq(key, filler(0xcc, 64))));
  const encryptedCertificates = seq(
    oid(ID.encryptedData),
    tagged(seq(int(0), seq(oid(ID.data), certificates, der(0x80, Buffer.alloc(96, 0xcc))))),
  );
  const keys = seq(oid(ID.data), tagged(holding(seq(keyBag))));
  const authSafe = seq(oid(ID.data), tagged(holding(seq(encryptedCertificates, keys))));
  return seq(int(3), authSafe, ...(mac ? [mac] : []));
}
/** As Keychain Access has long exported one: certificates in RC2-40, the key in 3DES, an HMAC-SHA-1 MAC. */
const CLASSIC = pfx(pkcs12Pbe(ID.tripleDes), pkcs12Pbe(ID.rc2With40Bits), macData(algorithm(ID.sha1)));
const CLASSIC_LINE =
  'Signing: .p12 uses pbeWithSHAAnd40BitRC2-CBC + pbeWithSHAAnd3-KeyTripleDES-CBC, MAC HMAC-SHA-1';

/*
 * The importer's own steps (the signing review, MUST 2 and SHOULDs 1, 2, 4, 5 and 8), on a pretend runner: a
 * temporary folder for RUNNER_TEMP and GITHUB_ENV, and a pretend /usr/bin/security that records what it is asked
 * and never runs. Placeholders only: no real certificate, key, keychain or password.
 */
const P12 = CLASSIC;
const ENCODED = P12.toString('base64');
/** A sentinel: no line printed, no error and no GITHUB_ENV line may ever hold it. */
const PASSWORD = 'SENTINEL-p12-password-never-printed';
const WRONG_PASSWORD =
  'security: SecKeychainItemImport: MAC verification failed during PKCS12 import (wrong password?)';
const SEQUENCE = [
  'create-keychain',
  'set-keychain-settings',
  'unlock-keychain',
  'import',
  'set-key-partition-list',
  'find-certificate',
  'add-trusted-cert',
  'find-identity',
];

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Call {
  command: string;
  sub: string;
  args: string[];
}

function runner(
  given: {
    secrets?: Record<string, string>;
    failOn?: string;
    identities?: string;
    /** What a failing security says on stderr (followed by its arguments, as an echo would). */
    stderr?: string;
    /** The import fails, as a wrong password does, unless its -P is exactly this. */
    acceptPassword?: string;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-sign-keychain-'));
  made.push(root);
  const temp = join(root, 'runner-temp');
  mkdirSync(temp);
  const envFile = join(root, 'github-env');
  writeFileSync(envFile, '');
  const dir = join(temp, 'drashti-mac-sign');
  const paths = {
    dir,
    keychain: join(dir, 'signing.keychain-db'),
    cert: join(dir, 'certificate.pem'),
    p12: join(dir, 'identity.p12'),
  };
  const calls: Call[] = [];
  const seen: { p12?: Buffer; p12Mode?: number } = {};
  const spawn = (command: string, args: string[]): SpawnResult => {
    const own = command === '/usr/bin/sudo' ? args.slice(2) : args;
    const sub = own[0] ?? '';
    calls.push({ command, sub, args: [...args] });
    // What a failing security might say: its arguments, and so the password (never to be printed).
    if (sub === given.failOn)
      return {
        status: 1,
        stdout: `placeholder output ${args.join(' ')}`,
        stderr: `${given.stderr ?? 'placeholder error'} ${args.join(' ')}`,
      };
    if (
      sub === 'import' &&
      given.acceptPassword !== undefined &&
      own[own.indexOf('-P') + 1] !== given.acceptPassword
    )
      return { status: 1, stdout: '', stderr: `${WRONG_PASSWORD} ${args.join(' ')}` };
    if (sub === 'create-keychain') writeFileSync(own.at(-1) ?? '', 'placeholder keychain');
    if (sub === 'delete-keychain') rmSync(own[1] ?? '');
    if (sub === 'import') {
      seen.p12 = readFileSync(own[1] ?? '');
      seen.p12Mode = statSync(own[1] ?? '').mode & 0o777;
    }
    if (sub === 'find-certificate')
      return { status: 0, stdout: '-----BEGIN CERTIFICATE-----\nplaceholder\n-----END CERTIFICATE-----\n' };
    if (sub === 'find-identity')
      return {
        status: 0,
        stdout:
          given.identities ??
          `  1) ${'0'.repeat(40)} "Drashti Code Signing"\n     1 valid identities found\n`,
      };
    return { status: 0, stdout: '' };
  };
  const logs: string[] = [];
  const errors: string[] = [];
  const env = {
    GITHUB_ACTIONS: 'true',
    RUNNER_TEMP: temp,
    GITHUB_ENV: envFile,
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    ...given.secrets,
  };
  const run = (...argv: string[]) =>
    runCli(argv, {
      env,
      platform: 'darwin',
      security: securityRunner(spawn),
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
    });
  const printed = () => [...logs, ...errors].join('\n');
  return { run, calls, seen, logs, errors, paths, envFile, printed };
}

const BOTH = { MAC_SIGN_P12_BASE64: ENCODED, MAC_SIGN_P12_PASSWORD: PASSWORD };

describe('the signing keychain importer', () => {
  it('imports the key non-extractable, for codesign alone (MUST 2)', () => {
    expect(importArgs('/t/identity.p12', '/t/signing.keychain-db', 'pw')).toEqual([
      'import',
      '/t/identity.p12',
      '-k',
      '/t/signing.keychain-db',
      '-P',
      'pw',
      '-x',
      '-T',
      '/usr/bin/codesign',
    ]);
    const r = runner({ secrets: BOTH });
    expect(r.run()).toBe(0);
    const imported = r.calls.find((c) => c.sub === 'import');
    expect(imported?.command).toBe('/usr/bin/security');
    expect(imported?.args).toEqual(importArgs(r.paths.p12, r.paths.keychain, PASSWORD));
    // No other program may use the key: never /usr/bin/security itself, which could export it.
    const allowed = r.calls.flatMap((c) => c.args.filter((_, i) => c.args[i - 1] === '-T'));
    expect(allowed).toEqual(['/usr/bin/codesign']);
  });

  it('with both secrets: a temporary keychain, trusted on this runner only, its path alone in GITHUB_ENV', () => {
    const r = runner({ secrets: BOTH });
    expect(r.run()).toBe(0);
    expect(r.calls.map((c) => c.sub)).toEqual(SEQUENCE);
    // The .p12 as given, readable by its owner alone while imported, and gone afterwards.
    expect(r.seen.p12?.equals(P12)).toBe(true);
    if (process.platform !== 'win32') expect(r.seen.p12Mode).toBe(0o600);
    expect(existsSync(r.paths.p12)).toBe(false);
    // One random keychain password for create, unlock and the partition list; never the .p12's.
    const temporary = r.calls[0]?.args[2] ?? '';
    expect(temporary).toMatch(/^[0-9a-f]{64}$/u);
    expect(r.calls[0]?.args).toEqual(['create-keychain', '-p', temporary, r.paths.keychain]);
    expect(r.calls[2]?.args).toEqual(['unlock-keychain', '-p', temporary, r.paths.keychain]);
    expect(r.calls[4]?.args).toEqual([
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:',
      '-s',
      '-k',
      temporary,
      r.paths.keychain,
    ]);
    // Trust for the public certificate alone, by the runner's administrator, with no keychain named (SHOULD 5).
    const trusted = r.calls.find((c) => c.sub === 'add-trusted-cert');
    expect(trusted?.command).toBe('/usr/bin/sudo');
    expect(trusted?.args).toEqual([
      '-n',
      '/usr/bin/security',
      'add-trusted-cert',
      '-d',
      '-r',
      'trustRoot',
      '-p',
      'codeSign',
      r.paths.cert,
    ]);
    expect(readFileSync(r.envFile, 'utf8')).toBe(`MAC_SIGN_KEYCHAIN=${r.paths.keychain}\n`);
    // The .p12's public algorithm names before the import (never a byte of it), then the result.
    expect(r.logs).toEqual([CLASSIC_LINE, 'Temporary signing identity ready.']);
    expect(r.errors).toEqual([]);
    expect(r.printed()).not.toContain(PASSWORD);
    expect(r.printed()).not.toContain(ENCODED);
  });

  it('with neither secret: one line, exit 0, nothing made and nothing written to GITHUB_ENV', () => {
    const r = runner();
    expect(r.run()).toBe(0);
    expect(r.logs).toEqual([
      'No signing identity supplied: packaging keeps its existing signing choice (ad hoc without a Developer ID).',
    ]);
    expect(r.errors).toEqual([]);
    expect(r.calls).toEqual([]);
    expect(existsSync(r.paths.dir)).toBe(false);
    expect(readFileSync(r.envFile, 'utf8')).toBe('');
  });

  it('with exactly one secret: fails, naming the empty one, before anything is made (SHOULD 2)', () => {
    for (const [secrets, empty, set] of [
      [{ MAC_SIGN_P12_BASE64: ENCODED }, 'MAC_SIGN_P12_PASSWORD', 'MAC_SIGN_P12_BASE64'],
      [
        { MAC_SIGN_P12_BASE64: ENCODED, MAC_SIGN_P12_PASSWORD: '' },
        'MAC_SIGN_P12_PASSWORD',
        'MAC_SIGN_P12_BASE64',
      ],
      [{ MAC_SIGN_P12_PASSWORD: PASSWORD }, 'MAC_SIGN_P12_BASE64', 'MAC_SIGN_P12_PASSWORD'],
      [
        { MAC_SIGN_P12_BASE64: '  \n', MAC_SIGN_P12_PASSWORD: PASSWORD },
        'MAC_SIGN_P12_BASE64',
        'MAC_SIGN_P12_PASSWORD',
      ],
    ] as const) {
      const r = runner({ secrets });
      expect(r.run(), empty).toBe(1);
      expect(r.errors).toEqual([
        `${empty} is empty but ${set} is set: give the release environment both signing secrets, or neither.`,
      ]);
      expect(r.logs).toEqual([]);
      expect(r.calls).toEqual([]);
      expect(existsSync(r.paths.dir)).toBe(false);
      expect(readFileSync(r.envFile, 'utf8')).toBe('');
      expect(r.printed()).not.toContain(PASSWORD);
      expect(r.printed()).not.toContain(ENCODED);
    }
  });

  it('names the security command that failed, never its arguments or output, and leaves no .p12 (SHOULD 4)', () => {
    for (const failOn of SEQUENCE) {
      const r = runner({ secrets: BOTH, failOn });
      expect(r.run(), failOn).toBe(1);
      // A failed import also gives one fixed reason, from security's words (which are never printed).
      expect(r.errors).toEqual([
        failOn === 'import'
          ? 'Signing keychain command failed: security import: unknown reason'
          : `Signing keychain command failed: security ${failOn}`,
      ]);
      expect(r.calls.at(-1)?.sub).toBe(failOn);
      expect(r.printed()).not.toContain('placeholder output');
      expect(r.printed()).not.toContain('placeholder error');
      expect(r.printed()).not.toContain(PASSWORD);
      expect(r.printed()).not.toContain(ENCODED);
      expect(existsSync(r.paths.p12)).toBe(false);
      expect(readFileSync(r.envFile, 'utf8')).toBe('');
      // The always-run cleanup still clears whatever was made.
      expect(r.run('--cleanup'), `${failOn} cleanup`).toBe(0);
      expect(existsSync(r.paths.dir)).toBe(false);
    }
  });

  it('prints its own reasons: no valid identity, a refused source, not a runner', () => {
    const invalid = runner({ secrets: BOTH, identities: '     0 valid identities found\n' });
    expect(invalid.run()).toBe(1);
    expect(invalid.errors).toEqual(['The signing identity is not valid.']);
    expect(readFileSync(invalid.envFile, 'utf8')).toBe('');

    const refused = runner({ secrets: { ...BOTH, GITHUB_REF: 'refs/heads/other' } });
    expect(refused.run()).toBe(1);
    expect(refused.errors).toEqual([
      'Refusing signing outside main or release-dry-run on a push or manual Release.',
    ]);
    expect(refused.calls).toEqual([]);
    expect(existsSync(refused.paths.dir)).toBe(false);

    const local = runner({ secrets: { ...BOTH, GITHUB_ACTIONS: '' } });
    expect(local.run()).toBe(1);
    expect(local.errors).toEqual(['Signing keychains are managed only on the macOS Actions runner.']);
    expect(local.calls).toEqual([]);

    const unknown = runner({ secrets: BOTH });
    expect(unknown.run('--clean')).toBe(1);
    expect(unknown.errors).toEqual(['Unknown argument: give none, --delete-key or --cleanup.']);
    expect(unknown.calls).toEqual([]);
  });

  it('--delete-key takes the keychain (the key) straight away; --cleanup then the runner’s trust and the folder (SHOULD 1)', () => {
    const r = runner({ secrets: BOTH });
    expect(r.run()).toBe(0);
    r.calls.length = 0;
    expect(r.run('--delete-key')).toBe(0);
    expect(r.calls.map((c) => c.args)).toEqual([['delete-keychain', r.paths.keychain]]);
    expect(existsSync(r.paths.keychain)).toBe(false);
    // The public certificate's trust stays for the checks that follow; it signs nothing.
    expect(existsSync(r.paths.cert)).toBe(true);
    r.calls.length = 0;
    expect(r.run('--cleanup')).toBe(0);
    expect(r.calls.map((c) => [c.command, ...c.args])).toEqual([
      ['/usr/bin/sudo', '-n', '/usr/bin/security', 'remove-trusted-cert', '-d', r.paths.cert],
    ]);
    expect(existsSync(r.paths.dir)).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it('with nothing to clean: exit 0, no command, nothing printed', () => {
    for (const mode of ['--delete-key', '--cleanup']) {
      const r = runner();
      expect(r.run(mode), mode).toBe(0);
      expect(r.calls).toEqual([]);
      expect(r.printed()).toBe('');
    }
  });

  it('a cleanup that cannot delete the keychain removes a left .p12 first, then fails naming the command', () => {
    for (const mode of ['--delete-key', '--cleanup']) {
      const r = runner({ failOn: 'delete-keychain' });
      mkdirSync(r.paths.dir);
      writeFileSync(r.paths.p12, P12);
      writeFileSync(r.paths.keychain, 'placeholder keychain');
      expect(r.run(mode), mode).toBe(1);
      expect(r.errors).toEqual(['Signing keychain command failed: security delete-keychain']);
      expect(existsSync(r.paths.p12)).toBe(false);
      // Kept, so the job's last, always-run cleanup tries again.
      expect(existsSync(r.paths.keychain)).toBe(true);
    }
  });
});

const FORMAT = "the .p12's format is not readable by this runner's security tool";
const NOT_P12 = 'the file is not a .p12';
const LINE_BREAK = 'Signing: the password secret had a trailing line break; it was used without it.';
const SPACES = 'Signing: the password secret had spaces at its start or end; it was used without them.';
const BOTH_TRIED =
  " (tried as given, and again without the password secret's leading and trailing whitespace)";

// The .p12's public structure, read before the import (the 27 Nov dry run 45904529076 failed at the import with
// no reason): its algorithm names only, never a byte, salt, count or digest.
describe('the .p12 check before importing', () => {
  it('names a classic Keychain Access export: RC2-40 certificates, a 3DES key, an HMAC-SHA-1 MAC', () => {
    expect(describeP12(CLASSIC)).toEqual({
      pfx: true,
      encryption: ['pbeWithSHAAnd40BitRC2-CBC', 'pbeWithSHAAnd3-KeyTripleDES-CBC'],
      mac: 'HMAC-SHA-1',
      line: CLASSIC_LINE,
    });
  });

  it('names a PBES2 export (PBKDF2, AES) with an HMAC-SHA-256 or HMAC-SHA-512 MAC', () => {
    const modern = pfx(
      pbes2(ID.hmacSha256, ID.aes256),
      pbes2(ID.hmacSha256, ID.aes256),
      macData(algorithm(ID.sha256)),
    );
    expect(describeP12(modern)).toEqual({
      pfx: true,
      encryption: ['PBES2', 'PBKDF2', 'HMAC-SHA-256', 'AES-256-CBC'],
      mac: 'HMAC-SHA-256',
      line: 'Signing: .p12 uses PBES2 + PBKDF2 + HMAC-SHA-256 + AES-256-CBC, MAC HMAC-SHA-256',
    });
    const mixed = pfx(
      pbes2(ID.hmacSha1, ID.aes128),
      pkcs12Pbe(ID.rc2With40Bits),
      macData(algorithm(ID.sha512)),
    );
    expect(describeP12(mixed).line).toBe(
      'Signing: .p12 uses pbeWithSHAAnd40BitRC2-CBC + PBES2 + PBKDF2 + HMAC-SHA-1 + AES-128-CBC, MAC HMAC-SHA-512',
    );
  });

  it('names a PBMAC1 MAC (RFC 9579) with what it is made of', () => {
    const pbmac1 = algorithm(
      ID.pbmac1,
      seq(
        algorithm(ID.pbkdf2, seq(filler(0xaa, 8), int(0x08, 0x00), int(32), algorithm(ID.hmacSha256))),
        algorithm(ID.hmacSha512),
      ),
    );
    const p12 = pfx(pbes2(ID.hmacSha256, ID.aes256), pbes2(ID.hmacSha256, ID.aes256), macData(pbmac1));
    expect(describeP12(p12)).toMatchObject({
      pfx: true,
      mac: 'PBMAC1 (PBKDF2 + HMAC-SHA-256 + HMAC-SHA-512)',
      line: 'Signing: .p12 uses PBES2 + PBKDF2 + HMAC-SHA-256 + AES-256-CBC, MAC PBMAC1 (PBKDF2 + HMAC-SHA-256 + HMAC-SHA-512)',
    });
  });

  it('says so when there is no MAC, the structure is not plain DER, or nothing is known', () => {
    expect(describeP12(pfx(pkcs12Pbe(ID.tripleDes), pkcs12Pbe(ID.rc2With40Bits), null))).toMatchObject({
      pfx: true,
      mac: 'none',
    });
    // An indefinite length (BER): the names are still found, the MAC is not told apart.
    const ber = Buffer.concat([Buffer.from([0x30, 0x80]), CLASSIC.subarray(2), Buffer.from([0, 0])]);
    expect(describeP12(ber)).toEqual({
      pfx: false,
      encryption: ['pbeWithSHAAnd40BitRC2-CBC', 'pbeWithSHAAnd3-KeyTripleDES-CBC', 'SHA-1'],
      mac: 'unknown',
      line: 'Signing: .p12 uses pbeWithSHAAnd40BitRC2-CBC + pbeWithSHAAnd3-KeyTripleDES-CBC + SHA-1, MAC unknown',
    });
    // A DER SEQUENCE that is no .p12 (here a certificate-like one): nothing known, and no byte printed.
    const other = seq(seq(int(2), filler(0x41, 40)), filler(0x42, 40));
    expect(describeP12(other)).toEqual({
      pfx: false,
      encryption: [],
      mac: 'unknown',
      line: 'Signing: .p12 uses no algorithm this check knows, MAC unknown',
    });
  });

  it('decodes the secret, line breaks and all, and refuses one that is not a .p12 in base64', () => {
    expect(decodeP12(`${ENCODED}\n`).equals(P12)).toBe(true);
    expect(decodeP12((ENCODED.match(/.{1,64}/gu) ?? []).join('\n')).equals(P12)).toBe(true);
    for (const encoded of [
      Buffer.from('placeholder text, not a certificate').toString('base64'),
      '-----BEGIN CERTIFICATE-----',
      `${ENCODED.slice(0, 20)}%${ENCODED.slice(20)}`,
      '====',
    ]) {
      expect(() => decodeP12(encoded), encoded).toThrow(NOT_A_P12);
    }
    expect(NOT_A_P12).toBe('MAC_SIGN_P12_BASE64 is not a .p12 in base64.');
  });

  it('refuses the secret before anything is made, and logs the algorithms before importing', () => {
    const r = runner({
      secrets: { ...BOTH, MAC_SIGN_P12_BASE64: Buffer.from('not a p12').toString('base64') },
    });
    expect(r.run()).toBe(1);
    expect(r.errors).toEqual([NOT_A_P12]);
    expect(r.logs).toEqual([]);
    expect(r.calls).toEqual([]);
    expect(existsSync(r.paths.dir)).toBe(false);
    expect(readFileSync(r.envFile, 'utf8')).toBe('');

    const failed = runner({ secrets: BOTH, failOn: 'import', stderr: WRONG_PASSWORD });
    expect(failed.run()).toBe(1);
    expect(failed.logs).toEqual([CLASSIC_LINE]);
  });
});

describe('a failed import', () => {
  it('gives one fixed reason from security’s words, never the words', () => {
    for (const [said, pfxShaped, reason] of [
      [WRONG_PASSWORD, true, 'wrong password'],
      [
        'security: SecKeychainItemImport: The user name or passphrase you entered is not correct.',
        true,
        'wrong password',
      ],
      [
        'security: SecKeychainItemImport: MAC verification failed during PKCS12 import',
        false,
        'wrong password',
      ],
      ['security: SecKeychainItemImport: Unknown format in import.', true, FORMAT],
      [
        'security: SecKeychainItemImport: The specified import or export format is not supported.',
        true,
        FORMAT,
      ],
      ['security: SecKeychainItemImport: An unsupported algorithm was encountered.', true, FORMAT],
      ['security: SecKeychainItemImport: Unable to decode the provided data.', true, FORMAT],
      ['security: SecKeychainItemImport: Unable to decode the provided data.', false, NOT_P12],
      ['security: SecKeychainItemImport: Unknown format in import.', false, NOT_P12],
      ['security: SecKeychainItemImport: An invalid record was encountered.', true, NOT_P12],
      [
        'security: SecKeychainItemImport: The specified item already exists in the keychain.',
        true,
        'unknown reason',
      ],
      ['', true, 'unknown reason'],
    ] as const)
      expect(importReason(importFailure(said), pfxShaped), `${said} ${String(pfxShaped)}`).toBe(reason);
  });

  it('names that reason after the subcommand, and prints nothing security said', () => {
    for (const [said, reason] of [
      [WRONG_PASSWORD, 'wrong password'],
      ['security: SecKeychainItemImport: Unknown format in import.', FORMAT],
      ['security: SecKeychainItemImport: An invalid record was encountered.', NOT_P12],
      ['placeholder error', 'unknown reason'],
    ] as const) {
      const r = runner({ secrets: BOTH, failOn: 'import', stderr: said });
      expect(r.run(), said).toBe(1);
      expect(r.errors).toEqual([`Signing keychain command failed: security import: ${reason}`]);
      // No retry: this password has no whitespace at its ends.
      expect(r.calls.filter((c) => c.sub === 'import')).toHaveLength(1);
      expect(r.printed()).not.toContain('SecKeychainItemImport');
      expect(r.printed()).not.toContain('placeholder output');
      expect(r.printed()).not.toContain(PASSWORD);
      expect(existsSync(r.paths.p12)).toBe(false);
      expect(readFileSync(r.envFile, 'utf8')).toBe('');
    }
  });

  it('tries once more without the password’s trailing line break, saying so in one fixed line', () => {
    for (const ending of ['\n', '\r\n']) {
      const r = runner({
        secrets: { ...BOTH, MAC_SIGN_P12_PASSWORD: `${PASSWORD}${ending}` },
        acceptPassword: PASSWORD,
      });
      expect(r.run(), JSON.stringify(ending)).toBe(0);
      const imports = r.calls.filter((c) => c.sub === 'import');
      expect(imports.map((c) => c.args)).toEqual([
        importArgs(r.paths.p12, r.paths.keychain, `${PASSWORD}${ending}`),
        importArgs(r.paths.p12, r.paths.keychain, PASSWORD),
      ]);
      expect(r.calls.map((c) => c.sub)).toEqual([...SEQUENCE.slice(0, 4), ...SEQUENCE.slice(3)]);
      expect(r.logs).toEqual([CLASSIC_LINE, LINE_BREAK, 'Temporary signing identity ready.']);
      expect(r.errors).toEqual([]);
      expect(readFileSync(r.envFile, 'utf8')).toBe(`MAC_SIGN_KEYCHAIN=${r.paths.keychain}\n`);
      expect(existsSync(r.paths.p12)).toBe(false);
    }
  });

  it('spaces at either end are tried without too, with their own fixed line', () => {
    for (const given of [` ${PASSWORD}`, `${PASSWORD} `, `\t${PASSWORD}  `]) {
      const r = runner({ secrets: { ...BOTH, MAC_SIGN_P12_PASSWORD: given }, acceptPassword: PASSWORD });
      expect(r.run(), JSON.stringify(given)).toBe(0);
      expect(r.calls.filter((c) => c.sub === 'import').map((c) => c.args.at(5))).toEqual([given, PASSWORD]);
      expect(r.logs).toEqual([CLASSIC_LINE, SPACES, 'Temporary signing identity ready.']);
    }
  });

  it('a password that works as given is used as given, even with whitespace at its ends', () => {
    const given = `${PASSWORD}\n`;
    const r = runner({ secrets: { ...BOTH, MAC_SIGN_P12_PASSWORD: given }, acceptPassword: given });
    expect(r.run()).toBe(0);
    expect(r.calls.filter((c) => c.sub === 'import').map((c) => c.args.at(5))).toEqual([given]);
    expect(r.logs).toEqual([CLASSIC_LINE, 'Temporary signing identity ready.']);
  });

  it('tries only once more, and then fails with the second try’s reason, saying both were tried', () => {
    const r = runner({
      secrets: { ...BOTH, MAC_SIGN_P12_PASSWORD: `${PASSWORD}\n` },
      acceptPassword: 'some-other-placeholder',
    });
    expect(r.run()).toBe(1);
    expect(r.calls.filter((c) => c.sub === 'import')).toHaveLength(2);
    expect(r.calls.at(-1)?.sub).toBe('import');
    expect(r.errors).toEqual([
      `Signing keychain command failed: security import: wrong password${BOTH_TRIED}`,
    ]);
    expect(r.logs).toEqual([CLASSIC_LINE]);
    expect(existsSync(r.paths.p12)).toBe(false);
    expect(readFileSync(r.envFile, 'utf8')).toBe('');
    expect(r.run('--cleanup')).toBe(0);
    expect(existsSync(r.paths.dir)).toBe(false);
  });

  it('a password that is only whitespace is not tried as an empty one', () => {
    const r = runner({ secrets: { ...BOTH, MAC_SIGN_P12_PASSWORD: '\n' }, acceptPassword: '' });
    expect(r.run()).toBe(1);
    expect(r.calls.filter((c) => c.sub === 'import')).toHaveLength(1);
    expect(r.errors).toEqual(['Signing keychain command failed: security import: wrong password']);
  });
});

// The sentinel password, with and without whitespace, and the .p12's base64: on every path, nothing printed or
// thrown may hold either, nor any part of security's own output (which echoes its arguments here).
describe('no secret leaves the importer', () => {
  it('on every path: success, retry, failed retry, each failed command, a refused secret, one secret', () => {
    const chunks = (ENCODED.match(/.{16}/gu) ?? []).slice(0, 8);
    const cases: Parameters<typeof runner>[0][] = [
      { secrets: BOTH },
      { secrets: { ...BOTH, MAC_SIGN_P12_PASSWORD: `${PASSWORD}\n` }, acceptPassword: PASSWORD },
      { secrets: { ...BOTH, MAC_SIGN_P12_PASSWORD: `${PASSWORD}\r\n` }, acceptPassword: 'other' },
      ...SEQUENCE.map((failOn) => ({
        secrets: { ...BOTH, MAC_SIGN_P12_PASSWORD: ` ${PASSWORD}\n` },
        failOn,
      })),
      { secrets: { ...BOTH, MAC_SIGN_P12_BASE64: `${ENCODED.slice(0, 40)}!` } },
      { secrets: { MAC_SIGN_P12_PASSWORD: PASSWORD } },
      { secrets: { MAC_SIGN_P12_BASE64: ENCODED } },
    ];
    for (const given of cases) {
      const r = runner(given);
      r.run();
      r.run('--delete-key');
      r.run('--cleanup');
      const printed = r.printed();
      expect(printed).not.toContain(PASSWORD);
      expect(printed).not.toContain('SENTINEL');
      expect(printed).not.toContain('placeholder');
      expect(printed).not.toContain('SecKeychainItemImport');
      for (const chunk of chunks) expect(printed).not.toContain(chunk);
      expect(readFileSync(r.envFile, 'utf8')).not.toContain(PASSWORD);
    }
  });

  it('a failing security throws only its subcommand and a reason code: no output kept on the error', () => {
    const spawn = (_command: string, args: string[]): SpawnResult => ({
      status: 1,
      stdout: `stdout ${args.join(' ')}`,
      stderr: `${WRONG_PASSWORD} ${args.join(' ')}`,
    });
    let caught: unknown;
    try {
      securityRunner(spawn)(importArgs('/t/identity.p12', '/t/signing.keychain-db', PASSWORD));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SecurityCommandError);
    const error = caught as SecurityCommandError;
    expect(error.message).toBe('Signing keychain command failed: security import');
    expect(error.subcommand).toBe('import');
    expect(error.failure).toBe('password');
    const everything = JSON.stringify([Object.entries(error), error.message, error.stack]);
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain('MAC verification');
    expect(everything).not.toContain('stdout');
    // And the .p12's description holds names from its own table only: never a byte of the file.
    const line = describeP12(P12).line;
    expect(line).not.toMatch(/[0-9a-f]{8}/iu);
    expect(line).not.toContain(ENCODED.slice(0, 16));
  });
});
