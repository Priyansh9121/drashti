import { ESLint } from 'eslint';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The text-cut rule, enforced (Sessions 31–36, I18N-5; tools/eslint/text-cut.mjs): words are cut with
 * cutText (src/shared/text.ts), which never splits a letter. A `.slice(0, n)` on a string planted in the
 * app's code is refused, in every process's code; an array's slice is not, nor cutText; an id or a code is
 * allowed by name, only where it is listed. Linted with the repository's own config, as `pnpm lint` does.
 */

const APP = join(__dirname, '..', '..');

async function refused(file: string, body: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: APP });
  const code = `export function planted(words: string, list: string[], colour: string): unknown {\n${body}\n}\n`;
  const [result] = await eslint.lintText(code, { filePath: join(APP, file) });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'drashti/text-cut').map((m) => m.message);
}

describe('the text-cut rule (lint)', () => {
  it('refuses .slice(0, n) on words in every process’s code, and not an array’s', async () => {
    for (const file of [
      'src/renderer/src/operator/MessagesPanel.tsx',
      'src/main/db/props.ts',
      'src/shared/messages.ts',
    ])
      expect(await refused(file, '  return [words.slice(0, 40), list, colour];'), file).toHaveLength(1);
    const panel = 'src/renderer/src/operator/MessagesPanel.tsx';
    expect(await refused(panel, '  return [words.substring(0, 40), list, colour];')).toHaveLength(1);
    expect(await refused(panel, '  return [`${words}!`.slice(0, 40), list, colour];')).toHaveLength(1);
    expect(await refused(panel, '  return [words, list.slice(0, 3), colour];')).toHaveLength(0);
  }, 120_000);

  it('allows an id or a code by name, only where it is listed', async () => {
    const body = '  return [words, list, colour.slice(0, 7)];';
    expect(await refused('src/renderer/src/editor/Inspector.tsx', body)).toHaveLength(0);
    expect(await refused('src/renderer/src/operator/MessagesPanel.tsx', body)).toHaveLength(1);
  }, 120_000);
});
