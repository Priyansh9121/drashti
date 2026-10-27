import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allChannels } from '../shared/ipc';

/*
 * Roles and PINs are gone (Session 54, E5: "remove admin/operator logic completely"): no channel of theirs, no
 * import of their modules (shared/roles.ts, main/roles/, the window's roles/; role.ts, Main or Node, is not
 * this), in Drashti or its tests, and no screen asks for a PIN or shows who is at the controls.
 */

const APP = join(__dirname, '..', '..');

/** Every TypeScript file under `folder`. */
function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe('roles and PINs, gone from Drashti (Session 54, E5)', () => {
  it('leave no channel, no import of their modules, and no PIN on a screen', () => {
    expect(allChannels().filter((c) => c.startsWith('roles:'))).toEqual([]);
    const here = join(APP, 'src', 'main', 'roles-gone.test.ts');
    const files = [...sources(join(APP, 'src')), ...sources(join(APP, 'tests'))].filter((f) => f !== here);
    const found = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => {
          const where = `${relative(APP, file)}:${String(i + 1)}`;
          // An import of shared/roles.ts, main/roles/ or the window's roles/ (role.ts, Main or Node, is not this).
          if (/from '[^']*\/roles(?:\/[^']*)?'/u.test(line)) return [`${where} imports roles`];
          // The screens' words: a PIN asked for, the Roles and PINs dialog, the header's role button.
          if (file.endsWith('.tsx') && /\b(?:admin|operator) PIN\b|Roles and PINs|role-chip/iu.test(line))
            return [`${where} names a PIN or a role`];
          return [];
        }),
    );
    expect(found).toEqual([]);
  });
});
