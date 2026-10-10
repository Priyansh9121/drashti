#!/usr/bin/env node
// This version's notes, for the Release workflow: the section of CHANGELOG.md headed "## <version>"
// (a date in brackets may follow), up to the next heading. They go into drashti-update.json, which
// Help > Check for Updates… shows, and are the GitHub release's text. A version with no section, an
// empty one, one longer than Drashti's update check reads, or one that is not the newest version in
// CHANGELOG.md stops the release with a plain message. Changes not released yet wait above it, under
// "## Unreleased".
//
//   node scripts/release-notes.mjs [--out <file>]    the section for package.json's version
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The most notes Drashti's update check reads (src/shared/updates.ts, since 1.0.0-alpha.0). Any more
 * and every Drashti so far refuses the whole update ("its release notes cannot be read").
 */
export const NOTES_MAX = 4000;

const HEADING = /^## +(\S+)(?: +\(.*\))? *$/u;

/** The newest version in `changelog`: its first heading that names one ("## Unreleased" does not). */
export function newestVersion(changelog) {
  for (const line of changelog.split(/\r?\n/u)) {
    const version = HEADING.exec(line)?.[1];
    if (version && /^\d/u.test(version)) return version;
  }
  return null;
}

/** The section of `changelog` for `version`, without its heading. */
export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/u);
  const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === version);
  if (start < 0)
    throw new Error(
      `CHANGELOG.md has no section for ${version}, the version in package.json. Add one headed "## ${version}" that says what changed, then release.`,
    );
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2} /u.test(line));
  const notes = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!notes)
    throw new Error(
      `CHANGELOG.md’s section for ${version} is empty: say what changed under "## ${version}".`,
    );
  if (notes.length > NOTES_MAX)
    throw new Error(
      `CHANGELOG.md’s section for ${version} is ${String(notes.length)} characters long: Drashti’s update check reads at most ${String(NOTES_MAX)}, and refuses the update if there are more. Shorten it.`,
    );
  return notes;
}

// Run, not imported (release-assets.mjs and the unit test import it).
const ranDirectly = () => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (ranDirectly()) {
  const i = process.argv.indexOf('--out');
  const out = i >= 0 ? process.argv[i + 1] : null;
  try {
    if (!existsSync('CHANGELOG.md'))
      throw new Error('There is no CHANGELOG.md here: run this from the app’s folder.');
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    const notes = releaseNotes(changelog, version);
    const newest = newestVersion(changelog);
    if (newest !== version)
      throw new Error(
        `CHANGELOG.md’s newest version is ${String(newest)}, but package.json says ${version}. Release the newest: set package.json’s version to ${String(newest)}, or move ${version}’s section to the top (only "## Unreleased" may sit above it).`,
      );
    if (out) writeFileSync(out, `${notes}\n`);
    console.log(`Drashti ${version}'s notes (${String(notes.length)} characters):\n\n${notes}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // On GitHub the message also shows on the run's page.
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Release notes::${message}`);
    console.error(message);
    process.exitCode = 1;
  }
}
