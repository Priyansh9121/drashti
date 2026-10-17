import { ESLint } from 'eslint';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * End-to-end tests wait for a condition, never for a while (Sessions 31–36, TST-6, TST-7): a raw
 * waitForTimeout or a sleeping setTimeout planted in a spec is refused; the same in tests/e2e/helpers.ts,
 * where the named waits live (letTimePass, holdStill, savedLive, nodeSaved), is not. Linted with the
 * repository's own config, as `pnpm lint` does.
 */

const APP = join(__dirname, '..', '..');

async function refused(file: string, body: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: APP });
  const code = `import type { Page } from '@playwright/test';\nexport async function planted(page: Page): Promise<void> {\n${body}\n}\n`;
  const [result] = await eslint.lintText(code, { filePath: join(APP, file) });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

describe('the waits rule (lint)', () => {
  it('refuses a raw wait or a sleep in a spec, and not in the helpers that name their waits', async () => {
    const spec = 'tests/e2e/operator.spec.ts';
    expect(await refused(spec, '  await page.waitForTimeout(500);')).toHaveLength(1);
    expect(await refused(spec, '  await new Promise((resolve) => setTimeout(resolve, 500));')).toHaveLength(
      1,
    );
    expect(await refused('tests/e2e/helpers.ts', '  await page.waitForTimeout(500);')).toHaveLength(0);
    // A wait for a condition is fine.
    expect(await refused(spec, "  await page.getByTestId('live-text').waitFor();")).toHaveLength(0);
  }, 120_000);
});
