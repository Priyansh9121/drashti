import { ESLint } from 'eslint';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Strings never run as code or as markup (Sessions 31–36, SEC-14): ESLint refuses eval, a string run as code
 * (setTimeout's or new Function's), and markup made from a string (innerHTML, outerHTML,
 * insertAdjacentHTML, document.write, dangerouslySetInnerHTML), in the operator window's code and in the
 * audience screens' code alike (their own block's rules would otherwise replace the renderer's). A line is
 * planted in each; linted with the repository's own config, as `pnpm lint` does.
 */

const APP = join(__dirname, '..', '..');
const SINK_RULES = new Set([
  'no-eval',
  'no-implied-eval',
  '@typescript-eslint/no-implied-eval',
  'no-new-func',
  'no-restricted-properties',
  'no-restricted-syntax',
]);

async function refused(file: string, body: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: APP });
  const code = `export function planted(el: HTMLElement, s: string): unknown {\n${body}\n}\n`;
  const [result] = await eslint.lintText(code, { filePath: join(APP, file) });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null && SINK_RULES.has(m.ruleId))
    .map((m) => `${m.ruleId ?? ''}: ${m.message}`);
}

const PLANTED = [
  '  return eval(s);',
  '  return setTimeout(s, 0);',
  '  return new Function(s);',
  '  el.innerHTML = s;',
  '  el.outerHTML = s;',
  "  el.insertAdjacentHTML('beforeend', s);",
  '  document.write(s);',
];

describe('strings never run as code or markup (lint)', () => {
  for (const file of ['src/renderer/src/operator/LivePreview.tsx', 'src/renderer/src/render/Scene.tsx'])
    it(`refuses each in ${file}`, async () => {
      // Every planted line refused: the ones that are not, all named in a failure.
      const missed: string[] = [];
      for (const line of PLANTED) if ((await refused(file, line)).length === 0) missed.push(line.trim());
      expect(missed).toEqual([]);
      // Reading markup is no sink.
      expect(await refused(file, '  return el.innerHTML.length;')).toEqual([]);
    }, 120_000);

  it('lets the operator window give a timer a function (the audience screens refuse every timer anyway)', async () => {
    expect(
      await refused('src/renderer/src/operator/LivePreview.tsx', '  return setTimeout(() => s, 0);'),
    ).toEqual([]);
  }, 120_000);

  it('refuses dangerouslySetInnerHTML in both', async () => {
    for (const file of ['src/renderer/src/operator/LivePreview.tsx', 'src/renderer/src/render/Scene.tsx']) {
      const eslint = new ESLint({ cwd: APP });
      const code =
        'export const Planted = (p: { s: string }) => <div dangerouslySetInnerHTML={{ __html: p.s }} />;\n';
      const [result] = await eslint.lintText(code, { filePath: join(APP, file) });
      expect(
        (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax'),
        file,
      ).toHaveLength(1);
    }
  }, 120_000);
});
