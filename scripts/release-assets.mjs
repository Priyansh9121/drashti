#!/usr/bin/env node
// The Release workflow's last step before publishing (Session 14): from the installers the build
// jobs made, write what a release carries besides them:
//
//   drashti-update.json   what Drashti's update check reads: the version, notes, and each platform's
//                         file with its size and SHA-512 (src/shared/updates.ts)
//   SHA256SUMS.txt        every file's SHA-256, for checking a download by hand
//   ffmpeg-9.0.2.tar.xz   FFmpeg's source (GPL: offered with every release; pinned and checked here)
//   SOURCES.md            where every part's source is, and the written offer for the rest
//
//   node scripts/release-assets.mjs --dir <folder of installers> --repo <owner/name> [--notes <file>]
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
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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
const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8').trim().slice(0, 4000) : '';
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

// FFmpeg's source, pinned as the builds are (scripts/fetch-ffmpeg.mjs), kept in the cache between runs.
const FFMPEG_SOURCE = {
  name: 'ffmpeg-9.0.2.tar.xz',
  url: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
  sha256: '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e',
};
const cache = join(homedir(), '.cache', 'drashti', 'ffmpeg-source');
await mkdir(cache, { recursive: true });
const cached = join(cache, FFMPEG_SOURCE.name);
if (!existsSync(cached) || (await hash(cached, 'sha256', 'hex')) !== FFMPEG_SOURCE.sha256) {
  const response = await fetch(FFMPEG_SOURCE.url);
  if (!response.ok || !response.body)
    throw new Error(`FFmpeg's source could not be downloaded (${response.status})`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(cached));
}
if ((await hash(cached, 'sha256', 'hex')) !== FFMPEG_SOURCE.sha256)
  throw new Error('FFmpeg’s source did not match its pinned SHA-256');
await pipeline(createReadStream(cached), createWriteStream(join(dir, FFMPEG_SOURCE.name)));

writeFileSync(
  join(dir, 'SOURCES.md'),
  `# Sources for Drashti ${version}

- **Drashti** itself: this release's "Source code" archives (GitHub adds them), the repository https://github.com/${repo} at tag \`${tag}\`.
- **FFmpeg 9.0.2**, bundled as a separate program (GPL version 3): \`${FFMPEG_SOURCE.name}\` attached here (SHA-256 \`${FFMPEG_SOURCE.sha256}\`), from ${FFMPEG_SOURCE.url}. The builds Drashti ships, and the libraries in them, come from their builders' published scripts: macOS from https://git.martin-riedl.de/ffmpeg/build-script, Windows from https://www.gyan.dev/ffmpeg/builds/ (the exact downloads are pinned in \`scripts/fetch-ffmpeg.mjs\`). See \`LICENSES/ffmpeg/README.md\` in the app.
- **Written offer:** for at least three years after this release, the maintainers of Drashti will provide anyone who asks with the complete corresponding source of the FFmpeg builds in it (FFmpeg and the libraries those builds contain, among them x264), on request through this repository's issues.
`,
);

// Every file's SHA-256, last, so it covers the others.
const sums = [];
for (const name of readdirSync(dir).sort())
  if (name !== 'SHA256SUMS.txt' && statSync(join(dir, name)).isFile())
    sums.push(`${await hash(join(dir, name), 'sha256', 'hex')}  ${name}`);
writeFileSync(join(dir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log(`Drashti ${version}: ${files.length} file(s) in the update, ${sums.length} file(s) in all.`);
