import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWorkflow, checkWorkflows } from '../../../scripts/check-workflows.mjs';

/*
 * The workflows' safety rules (Session 30 step 4): actions pinned to a commit SHA with a version comment,
 * checkouts without kept credentials, no expression inside a run: script, no pull_request_target, the
 * release build without caches, and (QA24-SIGN-1) the release environment and the Mac signing secrets in
 * release.yml's build-mac alone, its key deleted straight after the signature check. Fed bad workflows here;
 * this repository's own are checked too.
 */

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const good = `on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: Say
        env:
          WHAT: \${{ inputs.what }}
        run: |
          echo "$WHAT"
`;

describe('the workflows’ rules', () => {
  it('a workflow keeping them passes', () => {
    expect(checkWorkflow(good, 'ci.yml')).toEqual([]);
  });

  it('an action by tag, or pinned with no version comment, fails', () => {
    expect(checkWorkflow(good.replace(`@${SHA} # v7.0.1`, '@v7'), 'ci.yml')).toEqual([
      'ci.yml:7: actions/checkout@v7 is not pinned to a 40-character commit SHA',
    ]);
    expect(checkWorkflow(good.replace(' # v7.0.1', ''), 'ci.yml')).toEqual([
      `ci.yml:7: actions/checkout@${SHA} has no version comment (# vX.Y.Z)`,
    ]);
  });

  it('a checkout that keeps its credentials fails', () => {
    expect(checkWorkflow(good.replace('          persist-credentials: false\n', ''), 'ci.yml')).toEqual([
      'ci.yml:7: a checkout keeps its credentials: add persist-credentials: false',
    ]);
  });

  it('${{ inside run: fails, on its line or in its script', () => {
    expect(checkWorkflow(good.replace('echo "$WHAT"', 'echo "${{ inputs.what }}"'), 'ci.yml')).toEqual([
      'ci.yml:15: ${{ … }} inside run: (pass it through env:)',
    ]);
    expect(checkWorkflow(`${good}      - run: echo \${{ github.head_ref }}\n`, 'ci.yml')).toEqual([
      'ci.yml:16: ${{ … }} inside run: (pass it through env:)',
    ]);
  });

  it('pull_request_target fails', () => {
    expect(checkWorkflow(good.replace('  push:', '  pull_request_target:'), 'ci.yml')).toEqual([
      "ci.yml:2: pull_request_target runs others' pull requests with this repository's secrets",
    ]);
  });

  it('the release build with a cache fails', () => {
    const cached = good.replace(
      '      - name: Say',
      `      - uses: actions/setup-node@${SHA} # v7.1.0\n        with:\n          cache: pnpm\n      - name: Say`,
    );
    expect(checkWorkflow(cached, 'ci.yml')).toEqual([]);
    expect(checkWorkflow(cached, 'release.yml')).toEqual([
      'release.yml:13: the release build uses a cache (cache: pnpm)',
    ]);
  });

  it('the release build restores a cache only after its job has kept what it built (Session 58, X2b)', () => {
    const step = (ref: string, version: string) =>
      `      - uses: ${ref}@${SHA} # ${version}\n        with:\n          path: x\n          key: k\n`;
    const upload = step('actions/upload-artifact', 'v7.0.2');
    const restore = step('actions/cache/restore', 'v6.1.0');
    const save = step('actions/cache/save', 'v6.1.0');
    const assemble = '  assemble:\n    runs-on: ubuntu-latest\n    steps:\n';
    // After the upload the installers are kept: nothing a cache brings can reach them.
    expect(checkWorkflow(`${good}${upload}${restore}${save}`, 'release.yml')).toEqual([]);
    // Before it, or in a later job (each job starts afresh), never; restore, save or both.
    expect(checkWorkflow(`${good}${restore}${upload}`, 'release.yml')).toEqual([
      'release.yml:16: the release build uses a cache before its job has kept what it built (actions/cache/restore)',
    ]);
    expect(checkWorkflow(`${good}${upload}${assemble}${save}`, 'release.yml')).toEqual([
      'release.yml:23: the release build uses a cache before its job has kept what it built (actions/cache/save)',
    ]);
    expect(checkWorkflow(`${good}${step('actions/cache', 'v6.1.0')}`, 'release.yml')).toEqual([
      'release.yml:16: the release build uses a cache before its job has kept what it built (actions/cache)',
    ]);
    expect(checkWorkflow(`${good}${restore}`, 'ci.yml')).toEqual([]);
  });

  const signing = `on:
  workflow_dispatch:
  push:
    branches: [release-dry-run]
jobs:
  build-mac:
    if: (github.event_name == 'workflow_dispatch' || github.event_name == 'push') && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/release-dry-run')
    environment: release
    runs-on: macos-latest
    steps:
      - name: Import signing identity
        env:
          MAC_SIGN_P12_BASE64: \${{ secrets.MAC_SIGN_P12_BASE64 }}
          MAC_SIGN_P12_PASSWORD: \${{ secrets.MAC_SIGN_P12_PASSWORD }}
        run: node scripts/mac-sign-keychain.mjs
      - name: Package
        run: node scripts/package-release.mjs
      - name: Check the signatures (when signed)
        run: node scripts/verify-signing.mjs
      - name: Delete the signing key
        if: always()
        run: node scripts/mac-sign-keychain.mjs --delete-key
      - name: Each packaged app runs its programs
        run: node scripts/check-ffmpeg.mjs --packaged
      - name: Delete signing keychain
        if: always()
        run: node scripts/mac-sign-keychain.mjs --cleanup
  build-windows:
    runs-on: windows-latest
    steps: []
`;

  it('isolates the release environment to the guarded Mac job, with unconditional cleanup', () => {
    expect(checkWorkflow(signing, 'release.yml')).toEqual([]);
    for (const unsafe of [
      signing.replace('  workflow_dispatch:', '  pull_request:'),
      signing.replace('    environment: release', '    environment: other'),
      signing.replace('  build-windows:\n', '  build-windows:\n    environment: release\n'),
      signing.replace("github.ref == 'refs/heads/main'", "github.ref == 'refs/tags/v1'"),
      signing.replace("github.event_name == 'workflow_dispatch'", "github.event_name == 'pull_request'"),
      signing.replace(
        '        if: always()\n        run: node scripts/mac-sign-keychain.mjs --cleanup',
        '        if: success()\n        run: node scripts/mac-sign-keychain.mjs --cleanup',
      ),
      signing.replace('node scripts/mac-sign-keychain.mjs --cleanup', 'echo done'),
      signing.replace(
        '    runs-on: macos-latest',
        '    runs-on: macos-latest\n    steps:\n      - uses: actions/checkout@' +
          SHA +
          ' # v7.0.1\n        with:\n          ref: refs/pull/1/head\n          persist-credentials: false',
      ),
    ])
      expect(checkWorkflow(unsafe, 'release.yml'), unsafe).not.toEqual([]);
  });

  it('deletes the signing key straight after the signature check, before the packaged programs run (signing review SHOULD 1)', () => {
    const early =
      '      - name: Delete the signing key\n        if: always()\n        run: node scripts/mac-sign-keychain.mjs --delete-key\n';
    const check =
      '      - name: Each packaged app runs its programs\n        run: node scripts/check-ffmpeg.mjs --packaged\n';
    expect(signing).toContain(early);
    expect(checkWorkflow(signing.replace(early, ''), 'release.yml')).toEqual([
      'release.yml: release signing: the signing key must be deleted (--delete-key) in the step straight after verify-signing',
    ]);
    // After a step that runs the packaged programs is too late.
    expect(checkWorkflow(signing.replace(early + check, check + early), 'release.yml')).toEqual([
      'release.yml: release signing: the signing key must be deleted (--delete-key) in the step straight after verify-signing',
    ]);
    // On success only is enough there: the last, always-run cleanup is the safety net.
    expect(
      checkWorkflow(signing.replace(early, early.replace('        if: always()\n', '')), 'release.yml'),
    ).toEqual([]);
  });

  it('names an environment, and the Mac signing secrets, nowhere but release.yml’s build-mac (signing review SHOULD 6)', () => {
    const env = "only release.yml's build-mac may name an environment";
    const secrets =
      "the Mac signing secrets (MAC_SIGN_P12_*) belong to release.yml's build-mac import step alone";
    // Any other workflow: an environment, in either form, or the secrets anywhere.
    const named = good.replace(
      '    runs-on: ubuntu-latest',
      '    environment: release\n    runs-on: ubuntu-latest',
    );
    expect(checkWorkflow(named, 'ci.yml')).toEqual([`ci.yml:5: ${env}`]);
    expect(
      checkWorkflow(named.replace('environment: release', 'environment: { name: release }'), 'ci.yml'),
    ).toEqual([`ci.yml:5: ${env}`]);
    expect(checkWorkflow(good.replace('inputs.what', 'secrets.MAC_SIGN_P12_BASE64'), 'ci.yml')).toEqual([
      `ci.yml:13: ${secrets}`,
    ]);
    expect(checkWorkflow(good.replace('inputs.what', 'secrets.MAC_SIGN_P12_PASSWORD'), 'soak.yml')).toEqual([
      `soak.yml:13: ${secrets}`,
    ]);
    // A whole-line comment may name them.
    expect(
      checkWorkflow(good.replace('jobs:', '# environment: release; MAC_SIGN_P12_BASE64\njobs:'), 'ci.yml'),
    ).toEqual([]);
    // In release.yml: the secrets in build-mac's import step alone, never another step, the job's own env or
    // another job.
    const packaged = signing.replace(
      '        run: node scripts/package-release.mjs',
      '        env:\n          MAC_SIGN_P12_PASSWORD: ${{ secrets.MAC_SIGN_P12_PASSWORD }}\n        run: node scripts/package-release.mjs',
    );
    expect(checkWorkflow(packaged, 'release.yml')).toEqual([`release.yml:18: ${secrets}`]);
    const jobEnv = signing.replace(
      '    runs-on: macos-latest',
      '    env:\n      MAC_SIGN_P12_BASE64: ${{ secrets.MAC_SIGN_P12_BASE64 }}\n    runs-on: macos-latest',
    );
    expect(checkWorkflow(jobEnv, 'release.yml')).toEqual([`release.yml:10: ${secrets}`]);
    const windows = signing.replace(
      '    steps: []',
      '    env:\n      MAC_SIGN_P12_BASE64: ${{ secrets.MAC_SIGN_P12_BASE64 }}\n    steps: []',
    );
    expect(checkWorkflow(windows, 'release.yml')).toEqual([`release.yml:31: ${secrets}`]);
    expect(
      checkWorkflow(
        signing.replace('  build-windows:\n', '  build-windows:\n    environment: release\n'),
        'release.yml',
      ),
    ).toEqual([`release.yml:29: ${env}`]);
  });

  it('refuses a quoted environment key, and the whole secrets object outside build-mac’s import step (signing re-review)', () => {
    const env = "only release.yml's build-mac may name an environment";
    const whole =
      "the whole secrets object (toJSON(secrets) or secrets[…]) belongs to release.yml's build-mac import step alone";
    // A quoted key is the same key to YAML.
    for (const key of ['"environment"', "'environment'"])
      expect(
        checkWorkflow(
          good.replace('    runs-on: ubuntu-latest', `    ${key}: release\n    runs-on: ubuntu-latest`),
          'ci.yml',
        ),
        key,
      ).toEqual([`ci.yml:5: ${env}`]);
    // Every secret at once, or one by a name worked out: the environment's too, without naming them.
    for (const expression of [
      'toJSON(secrets)',
      'tojson( secrets )',
      "secrets['ANY_NAME']",
      'secrets [ inputs.what ]',
    ])
      expect(checkWorkflow(good.replace('inputs.what', expression), 'ci.yml'), expression).toEqual([
        `ci.yml:13: ${whole}`,
      ]);
    // In build-mac, in a step other than the import, and in build-windows.
    const packaged = signing.replace(
      '        run: node scripts/package-release.mjs',
      '        env:\n          ALL: ${{ toJSON(secrets) }}\n        run: node scripts/package-release.mjs',
    );
    expect(checkWorkflow(packaged, 'release.yml')).toEqual([`release.yml:18: ${whole}`]);
    const windows = signing.replace(
      '    steps: []',
      "    env:\n      ONE: ${{ secrets['MAC_CERT_P12'] }}\n    steps: []",
    );
    expect(checkWorkflow(windows, 'release.yml')).toEqual([`release.yml:31: ${whole}`]);
    // A job named secrets, and needs: on it, are not the secrets object.
    expect(checkWorkflow(good.replace('  build:', '  secrets:'), 'ci.yml')).toEqual([]);
    expect(
      checkWorkflow(good.replace('    runs-on:', '    needs: [secrets, checks]\n    runs-on:'), 'ci.yml'),
    ).toEqual([]);
  });

  it('this repository’s workflows keep them', () => {
    expect(checkWorkflows(join(__dirname, '..', '..', '..', '.github', 'workflows'))).toEqual([]);
  });
});
