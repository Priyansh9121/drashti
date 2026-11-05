import { dirname, join } from 'node:path';
import { diskNote } from '../scripts/disk-note.mjs';
import { makeTempRoot, removeTempRoot, tempEnv } from '../scripts/temp-root.mjs';
import { writePlaceholderOpeningPhoto } from './e2e/opening-photo';

/**
 * One temporary folder for the whole Playwright run: the tests' own temporary
 * folders and the data folders of every app they start go inside it, and it is
 * removed at the end. Workers and the apps they launch inherit the environment.
 */
export default function globalSetup(): () => void {
  const root = makeTempRoot();
  Object.assign(process.env, tempEnv(root));
  // Import from a Link (Session 25b): every app a test starts refuses any download request to
  // anywhere but 127.0.0.1, so no test can reach Dropbox or YouTube (PLAN §6).
  process.env['DRASHTI_TEST_LINK_GUARD'] = '1';
  // The default opening photo (the owner's decision of 5 Nov 2026) is never shown by a test: every app a test starts
  // shows this generated placeholder instead (tests/e2e/opening-photo.ts), unless a test gives a picture of its own.
  process.env['DRASHTI_TEST_OPENING_PHOTO'] = writePlaceholderOpeningPhoto(
    join(root, 'placeholder-opening-photo.png'),
  );
  return () => {
    // How big the run's folder grew, and the disk's free space, said before it goes (Session 54).
    process.stdout.write(`${diskNote('at the end of this run', dirname(root), [root])}\n`);
    removeTempRoot(root);
  };
}
