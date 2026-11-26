import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SpawnResult } from '../../../scripts/mac-sign-keychain.mjs';
import {
  importArgs,
  runCli,
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
 * The importer's own steps (the signing review, MUST 2 and SHOULDs 1, 2, 4, 5 and 8), on a pretend runner: a
 * temporary folder for RUNNER_TEMP and GITHUB_ENV, and a pretend /usr/bin/security that records what it is asked
 * and never runs. Placeholders only: no real certificate, key, keychain or password.
 */
const P12 = Buffer.from('placeholder p12 bytes, not a certificate');
const ENCODED = P12.toString('base64');
const PASSWORD = 'placeholder-p12-password';
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

function runner(given: { secrets?: Record<string, string>; failOn?: string; identities?: string } = {}) {
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
        stderr: `placeholder error ${args.join(' ')}`,
      };
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
    expect(r.logs).toEqual(['Temporary signing identity ready.']);
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
      expect(r.errors).toEqual([`Signing keychain command failed: security ${failOn}`]);
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
