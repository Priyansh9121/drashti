import { ESLint } from 'eslint';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The engine-time rule, enforced (Session 27; docs/design.md, "Audience screens' motion"): what the
 * audience screens draw is a pure function of the engine's state and the engine's time, the same on
 * every screen, node and the stream. ESLint refuses the computer's own clock, chance and CSS motion
 * in the audience screens' code: a line planted in Scene.tsx fails, the same line in the operator
 * window's code does not. Linted with the repository's own config, as `pnpm lint` does.
 */

const APP = join(__dirname, '..', '..');
const RULES = new Set(['no-restricted-properties', 'no-restricted-syntax']);

async function refused(file: string, body: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: APP });
  const code = `export function planted(): unknown {\n${body}\n}\n`;
  const [result] = await eslint.lintText(code, { filePath: join(APP, file) });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null && RULES.has(m.ruleId))
    .map((m) => m.message);
}

describe('the engine-time rule (lint)', () => {
  it("refuses the computer's clock, chance and CSS motion in the audience screens' code", async () => {
    const scene = 'src/renderer/src/render/Scene.tsx';
    expect(await refused(scene, '  return Date.now();')).toHaveLength(1);
    expect(await refused(scene, '  return performance.now();')).toHaveLength(1);
    expect(await refused(scene, '  return Math.random();')).toHaveLength(1);
    expect(await refused(scene, '  return new Date();')).toHaveLength(1);
    expect(await refused(scene, "  return { opacity: 1, transition: 'opacity 200ms' };")).toHaveLength(1);
    expect(await refused(scene, "  return { animation: 'spin 1s linear infinite' };")).toHaveLength(1);
    // A date from a time it is given is fine, and so is a slide's transition (data, not CSS).
    expect(await refused(scene, '  return new Date(0);')).toHaveLength(0);
    expect(await refused(scene, "  return { transition: { kind: 'cut', durationMs: 0 } };")).toHaveLength(0);
  }, 120_000);

  it("reaches every audience screen's folder and the shared helpers they draw with, not the operator window", async () => {
    for (const file of [
      'src/renderer/src/output/main.tsx',
      'src/renderer/src/program/ProgramView.tsx',
      'src/renderer/src/web/stage/StageDisplay.tsx',
      'src/shared/idle.ts',
      'src/shared/picture-look.ts',
    ])
      expect(await refused(file, '  return Date.now();'), file).toHaveLength(1);
    expect(await refused('src/renderer/src/operator/LivePreview.tsx', '  return Date.now();')).toHaveLength(
      0,
    );
  }, 120_000);
});
