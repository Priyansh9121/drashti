import { describe, expect, it } from 'vitest';
import { signingSourceAllowed } from '../../../scripts/mac-sign-keychain.mjs';

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
