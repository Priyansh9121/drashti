import { realpath } from 'node:fs/promises';
import { isInside } from '../media/contained';

export const OUTSIDE_IMPORT_FOLDER =
  'This link points outside the chosen folder and was skipped. Choose the file itself to import it.';

export class OutsideImportFolder extends Error {
  constructor() {
    super(OUTSIDE_IMPORT_FOLDER);
  }
}

/**
 * A folder selection carries its canonical root through the scan and every source read/copy. Explicit file
 * selections carry no folder boundary. Return the canonical target so replacing the original link after this
 * check cannot redirect that read. The report continues to name the selected link, never the outside target.
 */
export async function folderReadPath(file: { path: string; folderRoot?: string }): Promise<string> {
  if (file.folderRoot === undefined) return file.path;
  const [root, target] = await Promise.all([realpath(file.folderRoot), realpath(file.path)]);
  if (root !== file.folderRoot || !isInside(root, target)) throw new OutsideImportFolder();
  return target;
}
