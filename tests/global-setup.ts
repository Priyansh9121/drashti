import { makeTempRoot, removeTempRoot, tempEnv } from '../scripts/temp-root.mjs';

/**
 * One temporary folder for the whole Playwright run: the tests' own temporary
 * folders and the data folders of every app they start go inside it, and it is
 * removed at the end. Workers and the apps they launch inherit the environment.
 */
export default function globalSetup(): () => void {
  const root = makeTempRoot();
  Object.assign(process.env, tempEnv(root));
  return () => {
    removeTempRoot(root);
  };
}
