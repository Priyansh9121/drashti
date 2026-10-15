import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWorkflow, checkWorkflows } from '../../../scripts/check-workflows.mjs';

/*
 * The workflows' safety rules (Session 30 step 4): actions pinned to a commit SHA with a version comment,
 * checkouts without kept credentials, no expression inside a run: script, no pull_request_target, and the
 * release build without caches. Fed bad workflows here; this repository's own are checked too.
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

  it('this repository’s workflows keep them', () => {
    expect(checkWorkflows(join(__dirname, '..', '..', '..', '.github', 'workflows'))).toEqual([]);
  });
});
