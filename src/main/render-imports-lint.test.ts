import { ESLint } from 'eslint';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The audience screens' drawing never imports the operator window's code (Sessions 31–36, ARCH-6):
 * render/ and output/ import only render/, output/, engine/, ui/, styles/ and src/shared. An import of an
 * operator folder planted in each is refused by ESLint (the repository's own config, as `pnpm lint`
 * does); the same import in the operator window's code is not; and the renderer's own bans (Electron,
 * Node) still hold there, as this rule's block replaces the renderer block's options for its files.
 */

const APP = join(__dirname, '..', '..');

async function refused(file: string, line: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: APP });
  const [result] = await eslint.lintText(`${line}\nexport const planted = 1;\n`, {
    filePath: join(APP, file),
  });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe("the audience screens' imports (lint)", () => {
  it('refuses an operator folder in render/ and output/, and nowhere else', async () => {
    for (const file of ['src/renderer/src/render/Scene.tsx', 'src/renderer/src/output/main.tsx']) {
      for (const folder of ['operator', 'library', 'playlists', 'editor'])
        expect(await refused(file, `import '../${folder}/planted';`), `${folder} in ${file}`).not.toEqual([]);
      // What they may import.
      for (const allowed of [
        '../render/clock',
        '../ui/icons',
        '../engine/engine-store',
        '../../../shared/model',
      ])
        expect(await refused(file, `import '${allowed}';`), `${allowed} in ${file}`).toEqual([]);
      // The renderer's own bans still hold.
      expect(await refused(file, "import 'electron';")).not.toEqual([]);
      expect(await refused(file, "import 'node:fs';")).not.toEqual([]);
    }
    // The operator window's code may import its own folders.
    expect(
      await refused('src/renderer/src/operator/LivePreview.tsx', "import '../library/planted';"),
    ).toEqual([]);
  }, 120_000);
});
