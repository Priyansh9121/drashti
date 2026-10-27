import { readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * What a deck's import leaves behind when Drashti stops in the middle of it (Session 54, C review): the copies it
 * opened in PowerPoint's own folder (Office's Drashti/convert-*), and its work folders (drashti-pictures-*, the
 * timed copy, the movie and its cut steps), cleared at Drashti's next start, before any import runs.
 */

/** PowerPoint for Mac's own folder, where Drashti puts the copies it opens there. */
export const OFFICE_DRASHTI = join(homedir(), 'Library', 'Group Containers', 'UBF8T346G9.Office', 'Drashti');

/** Clear them; returns how many folders went. Folders that are not there are no trouble. */
export async function clearDeckLeftovers(where: { office?: string; temp?: string } = {}): Promise<number> {
  let cleared = 0;
  const clear = async (folder: string, prefix: string) => {
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      return;
    }
    for (const name of names.filter((n) => n.startsWith(prefix))) {
      await rm(join(folder, name), { recursive: true, force: true }).catch(() => undefined);
      cleared++;
    }
  };
  await clear(where.office ?? OFFICE_DRASHTI, 'convert-');
  await clear(where.temp ?? tmpdir(), 'drashti-pictures-');
  return cleared;
}
