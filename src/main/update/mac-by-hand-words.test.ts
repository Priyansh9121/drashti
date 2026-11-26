import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Why a Mac installs an update by hand, as the Updates dialog and a node's window say it (QA24-SIGN-1, the signing
 * review's SHOULD 10, as installer.ts beside this test says it): true of an ad hoc copy and of one signed with
 * Drashti's own certificate alike. Squirrel.Mac needs an Apple Developer ID, which neither has; the second is
 * signed, so never "not signed". Read from each window's source, its JSX text joined as React joins it (one space
 * where a line breaks).
 */

// Read here, in the main process's tests: a renderer's own tests may not use Node.
const RENDERER = join(__dirname, '..', '..', 'renderer', 'src');
const words = (file: string) => readFileSync(join(RENDERER, file), 'utf8').replace(/\s+/gu, ' ');

describe('a Mac that installs an update by hand is told why, truly', () => {
  it('in the Updates dialog', () => {
    const text = words('updates/UpdatesDialog.tsx');
    expect(text).toContain(
      'This copy of Drashti is not signed with an Apple Developer ID, so the Mac cannot install the update by itself. After the sabha, quit Drashti, open the downloaded file and drag Drashti into Applications.',
    );
    expect(text).not.toContain('not signed,');
  });

  it('in a node’s window', () => {
    const text = words('node/NodeApp.tsx');
    expect(text).toContain(
      'This copy of Drashti is not signed with an Apple Developer ID, so the Mac cannot install it by itself: quit Drashti, open the downloaded file and drag Drashti into Applications.',
    );
    expect(text).not.toContain('not signed,');
  });
});
