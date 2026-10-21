#!/usr/bin/env node
// The Release workflow's last step before publishing (Session 14): from the installers the build
// jobs made, write what a release carries besides them:
//
//   drashti-update.json   what Drashti's update check reads: the version, notes, and each platform's
//                         file with its size and SHA-512 (src/shared/updates.ts)
//   SHA256SUMS.txt        every file's SHA-256, for checking a download by hand
//   ffmpeg-9.0.2.tar.xz   FFmpeg's source (GPL: offered with every release; pinned and checked here)
//   yt-dlp-2026.08.19.tar.gz, mutagen-1.48.1.tar.gz
//                         yt-dlp's source and the GPL code its builds bundle (Session 25c), likewise
//   SOURCES.md            where every part's source is, and the written offer for the rest
//
//   node scripts/release-assets.mjs --dir <folder of installers> --repo <owner/name> [--notes <file>]
//
// The Release workflow's notes are this version's section of CHANGELOG.md (scripts/release-notes.mjs).
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { downloadSource } from './download-source.mjs';
import { NOTES_MAX } from './release-notes.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const dir = arg('dir');
const repo = arg('repo', 'Priyansh9121/drashti');
if (!dir) throw new Error('--dir <folder of installers> is needed');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const tag = `v${version}`;
const notesFile = arg('notes');
if (notesFile && !existsSync(notesFile)) throw new Error(`The notes file ${notesFile} is not there`);
const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : '';
// Cut short, they would differ from the release page; longer, every Drashti so far refuses the update.
if (notes.length > NOTES_MAX) throw new Error(`The notes are over ${String(NOTES_MAX)} characters`);
const download = (name) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;

const hash = async (file, algorithm, encoding) => {
  const h = createHash(algorithm);
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest(encoding);
};

// The installers under the names that never change (build/downloads.json; scripts/package-release.mjs
// gives them): the Mac zips for Squirrel.Mac, and the NSIS installer, go in the update; every one of them
// must be there.
const downloads = JSON.parse(readFileSync(join('build', 'downloads.json'), 'utf8')).files;
const KINDS = downloads
  .filter((d) => d.kind === 'zip' || d.kind === 'nsis')
  .map((d) => ({ re: new RegExp(`^${d.name.replace(/\./gu, '\\.')}$`, 'u'), ...d }));
for (const d of downloads)
  if (!existsSync(join(dir, d.name))) throw new Error(`${d.name} (for ${d.for}) is not among the installers`);
const names = readdirSync(dir);
const files = [];
for (const k of KINDS) {
  const name = names.find((n) => k.re.test(n));
  if (!name) {
    console.log(`Missing: the ${k.platform} ${k.arch} ${k.kind} (left out of the update)`);
    continue;
  }
  const file = join(dir, name);
  files.push({
    platform: k.platform,
    arch: k.arch,
    kind: k.kind,
    name,
    url: download(name),
    size: statSync(file).size,
    sha512: await hash(file, 'sha512', 'base64'),
  });
}
const manifest = {
  app: 'drashti',
  version,
  releasedAt: new Date().toISOString(),
  notes,
  source: `https://github.com/${repo}/releases/tag/${tag}`,
  files,
};
writeFileSync(join(dir, 'drashti-update.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// The sources offered with each release, pinned as the builds are and kept in the cache between runs:
// FFmpeg's (scripts/fetch-ffmpeg.mjs), and yt-dlp's with the GPL code its builds bundle (Session 25c,
// scripts/fetch-youtube-tools.mjs; its Mac and Windows builds hold mutagen 1.48.1, GPL version 2 or
// later, as their own -v header lists it). Each download is tried up to three times (Session 47,
// scripts/download-source.mjs).
const FFMPEG_SOURCE = {
  name: 'ffmpeg-9.0.2.tar.xz',
  url: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
  sha256: '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e',
  cache: 'ffmpeg-source',
};
const YT_DLP_SOURCE = {
  name: 'yt-dlp-2026.08.19.tar.gz',
  url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.tar.gz',
  sha256: '072aad4f2a7604e92155f61a275a4752dc64046c8f6d90df3710525d94cd37c1',
  cache: 'yt-dlp-source',
};
const MUTAGEN_SOURCE = {
  name: 'mutagen-1.48.1.tar.gz',
  url: 'https://files.pythonhosted.org/packages/df/70/1675da133ea92227da41bf5b24e1c66be597ff736a1533ade41da986852f/mutagen-1.48.1.tar.gz',
  sha256: '8f95637ab9f6f305cec6bd1294e197debe207998e3e068596563c74f86b0a173',
  cache: 'yt-dlp-source',
};
for (const source of [FFMPEG_SOURCE, YT_DLP_SOURCE, MUTAGEN_SOURCE]) {
  const cache = join(homedir(), '.cache', 'drashti', source.cache);
  await mkdir(cache, { recursive: true });
  const cached = join(cache, source.name);
  if (!existsSync(cached) || (await hash(cached, 'sha256', 'hex')) !== source.sha256)
    await downloadSource(source, cached, fetch, sleep);
  if ((await hash(cached, 'sha256', 'hex')) !== source.sha256)
    throw new Error(`${source.name} did not match its pinned SHA-256`);
  await pipeline(createReadStream(cached), createWriteStream(join(dir, source.name)));
}

writeFileSync(
  join(dir, 'SOURCES.md'),
  `# Sources for Drashti ${version}

- **Drashti** itself: this release's "Source code" archives (GitHub adds them), the repository https://github.com/${repo} at tag \`${tag}\`.
- **FFmpeg 9.0.2**, bundled as a separate program (GPL version 3): \`${FFMPEG_SOURCE.name}\` attached here (SHA-256 \`${FFMPEG_SOURCE.sha256}\`), from ${FFMPEG_SOURCE.url}. The builds Drashti ships, and the libraries in them, come from their builders' published scripts: macOS from https://git.martin-riedl.de/ffmpeg/build-script, Windows from https://www.gyan.dev/ffmpeg/builds/ (the exact downloads are pinned in \`scripts/fetch-ffmpeg.mjs\`). See \`LICENSES/ffmpeg/README.md\` in the app.
- **yt-dlp 2026.08.19**, bundled as a separate program for YouTube in Import from a Link (its own code is under the Unlicense; its standalone builds bundle GPL code, so as built they are GPL version 3 or later): its source, \`${YT_DLP_SOURCE.name}\` attached here (SHA-256 \`${YT_DLP_SOURCE.sha256}\`), from ${YT_DLP_SOURCE.url}, built by the scripts in its repository at tag \`2026.08.19\` (https://github.com/yt-dlp/yt-dlp: \`bundle/pyinstaller.py\`, \`bundle/requirements/\` and \`.github/workflows/build.yml\`); and the source of the GPL code its Mac and Windows builds bundle, mutagen 1.48.1 (GPL version 2 or later): \`${MUTAGEN_SOURCE.name}\` attached here (SHA-256 \`${MUTAGEN_SOURCE.sha256}\`), from ${MUTAGEN_SOURCE.url}. Every other part those builds bundle, and its licence, is listed in \`LICENSES/yt-dlp/THIRD_PARTY_LICENSES.txt\` in the app (the exact downloads are pinned in \`scripts/fetch-youtube-tools.mjs\`). See \`LICENSES/yt-dlp/README.md\`.
- **Deno 2.9.7**, bundled as a separate program that yt-dlp starts (MIT): its source is https://github.com/denoland/deno at tag \`v2.9.7\` (\`deno_src.tar.gz\` on its release page). See \`LICENSES/deno/README.md\` in the app.
- **Written offer:** for at least three years after this release, the maintainers of Drashti will provide anyone who asks with the complete corresponding source of the FFmpeg builds in it (FFmpeg and the libraries those builds contain, among them x264) and of the yt-dlp builds in it (yt-dlp and what those builds bundle), on request through this repository's issues.
`,
);

// Every file's SHA-256, last, so it covers the others.
const sums = [];
for (const name of readdirSync(dir).sort())
  if (name !== 'SHA256SUMS.txt' && statSync(join(dir, name)).isFile())
    sums.push(`${await hash(join(dir, name), 'sha256', 'hex')}  ${name}`);
writeFileSync(join(dir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log(`Drashti ${version}: ${files.length} file(s) in the update, ${sums.length} file(s) in all.`);
