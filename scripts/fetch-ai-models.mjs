// Pinned, offline helper resources. No package manager, install scripts, GPU downloads or accounts.
// node scripts/fetch-ai-models.mjs --target darwin-arm64
// --out and --cache may name disposable staging folders. Linked vendor folders are never written through.
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  copyFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = '614241f622f53c4eeff9890bdc4f31cfecc418b3';
const models = [
  [
    'onnx/model_qint8_avx512_vnni.onnx',
    'model.onnx',
    118346824,
    'dd476dd0c2514e9b9be83aeb3853fac0763e0bdf4a71645407587d77c48a2d88',
  ],
  [
    'tokenizer.json',
    'tokenizer.json',
    17082730,
    '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
  ],
  ['config.json', 'config.json', 655, '69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959'],
  [
    'tokenizer_config.json',
    'tokenizer_config.json',
    443,
    'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
  ],
];
const packages = {
  native: ['onnxruntime-node', '1.30.0', '6e3390d6b783e7be946fad629292799da28d0b42f84856e50d2c1b0383291e75'],
  common: [
    'onnxruntime-common',
    '1.30.0',
    '7906c439e0d3e0f4048caa23b64cdfadc0f455c377f579ce1ab2a4b778f07d5f',
  ],
  tokenizer: [
    '@huggingface/tokenizers',
    '0.2.0',
    '2800014c83b8186b2e4210c20672f1fb65a12cef85d7e95e0f2003e022611b4a',
  ],
};
function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at < 0) return fallback;
  const value = process.argv[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}
const target = option('--target', `${process.platform}-${process.arch}`);
if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target))
  throw new Error('Choose darwin-arm64, darwin-x64 or win32-x64.');
if (target === 'darwin-x64') {
  packages.native = [
    'onnxruntime-node',
    '1.23.2',
    'fe70e8de46560c57c2dfb7170770da32dbb21684504a5c904346c44a56e154f2',
  ];
  packages.common = [
    'onnxruntime-common',
    '1.23.2',
    '5e8c5c969c1695e33d1810cfa5f593de8343de3eb1b6f561b42dd3dcf048d9be',
  ];
}
const offline = process.argv.includes('--offline');
if (process.argv.includes('--describe')) {
  console.log(
    JSON.stringify({
      id: 'intfloat/multilingual-e5-small',
      revision,
      licence: 'MIT',
      dimensions: 384,
      target,
      files: Object.fromEntries(models.map(([, name, bytes, sha256]) => [name, { bytes, sha256 }])),
      packages,
    }),
  );
  process.exit(0);
}
const output = resolve(option('--out', join(ROOT, 'vendor', 'ai', target)));
const cache = resolve(option('--cache', join(homedir(), '.cache', 'drashti', `ai-${revision}`)));
function noLinks(path) {
  let current = resolve(path);
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('Refusing a linked output or cache. Use an explicit private --out/--cache.');
    const parent = dirname(current);
    if (current === parent) break;
    current = parent;
  }
}
noLinks(output);
noLinks(cache);
mkdirSync(cache, { recursive: true });
mkdirSync(dirname(output), { recursive: true });
async function hash(path) {
  const value = createHash('sha256');
  for await (const block of createReadStream(path)) value.update(block);
  return value.digest('hex');
}
async function download(url, path, pin, bytes) {
  if (
    existsSync(path) &&
    (await hash(path)) === pin &&
    (bytes === undefined || lstatSync(path).size === bytes)
  )
    return path;
  if (offline)
    throw new Error(
      'A pinned asset is missing from the local cache. Prepare assets online before packaging.',
    );
  noLinks(path);
  const ownDownload = mkdtempSync(join(cache, '.download-'));
  const partial = join(ownDownload, 'payload');
  let address = url;
  for (let redirects = 0; redirects <= 8; redirects++) {
    const parsed = new URL(address);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || /github/i.test(parsed.hostname))
      throw new Error('Refusing this asset address.');
    const response = await fetch(address, { redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const to = response.headers.get('location');
      await response.body?.cancel();
      if (!to) throw new Error('Missing asset location.');
      address = new URL(to, address).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Asset download failed (${response.status}).`);
    let received = 0;
    async function* bounded() {
      for await (const block of Readable.fromWeb(response.body)) {
        received += block.length;
        if (received > (bytes ?? 180000000)) throw new Error('Asset download exceeds its bound.');
        yield block;
      }
    }
    try {
      await pipeline(bounded(), createWriteStream(partial, { flags: 'wx' }));
      if ((bytes !== undefined && received !== bytes) || (await hash(partial)) !== pin)
        throw new Error('Asset checksum or size mismatch.');
      renameSync(partial, path);
      rmSync(ownDownload, { recursive: true, force: true });
      return path;
    } catch (error) {
      rmSync(ownDownload, { recursive: true, force: true });
      throw error;
    }
  }
  throw new Error('Too many asset redirects.');
}
const tar =
  process.platform === 'win32'
    ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
function command(args) {
  const result = spawnSync(tar, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Asset archive could not be read.');
  return result.stdout;
}
function extract(archive, into) {
  const names = command(['-tzf', archive]).trim().split(/\r?\n/u);
  if (
    names.some(
      (name) =>
        !name.startsWith('package/') ||
        name.split('/').includes('..') ||
        name.includes('\\') ||
        name.includes(':'),
    )
  )
    throw new Error('Unexpected asset archive path.');
  const modes = command(['-tvzf', archive]).trim().split(/\r?\n/u);
  if (modes.some((line) => !['-', 'd'].includes(line[0])))
    throw new Error('Linked archive members are refused.');
  mkdirSync(into, { recursive: true });
  command(['-xzf', archive, '-C', into]);
  return join(into, 'package');
}
function copyTree(source, into, pick) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Linked runtime files are refused.');
    const from = join(source, entry.name);
    const to = join(into, entry.name);
    if (entry.isDirectory()) copyTree(from, to, pick);
    else if (entry.isFile() && pick(from)) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}
const staging = mkdtempSync(join(dirname(output), '.ai-staging-'));
try {
  for (const [source, name, bytes, pin] of models) {
    const path = await download(
      `https://huggingface.co/intfloat/multilingual-e5-small/resolve/${revision}/${source}`,
      join(cache, `e5-${name}`),
      pin,
      bytes,
    );
    const folder = join(staging, 'models', 'multilingual-e5-small');
    mkdirSync(folder, { recursive: true });
    copyFileSync(path, join(folder, name));
  }
  for (const [kind, [name, version, pin]] of Object.entries(packages)) {
    const short = name.split('/').at(-1);
    const path = await download(
      `https://registry.npmjs.org/${name}/-/${short}-${version}.tgz`,
      join(cache, `${short}-${version}.tgz`),
      pin,
    );
    const folder = extract(path, join(staging, `unpack-${kind}`));
    if (kind === 'tokenizer') {
      mkdirSync(join(staging, 'runtime'), { recursive: true });
      copyFileSync(join(folder, 'dist', 'tokenizers.cjs'), join(staging, 'runtime', 'tokenizers.cjs'));
      copyFileSync(join(folder, 'LICENSE'), join(staging, 'runtime', 'tokenizers-LICENSE'));
    } else {
      const dest = join(staging, 'runtime', 'node_modules', name);
      const platform = target.split('-');
      copyTree(folder, dest, (file) => {
        const part = relative(folder, file).split(sep).join('/');
        return (
          part === 'package.json' ||
          part.startsWith('dist/') ||
          /^(LICENSE|ThirdPartyNotices|README)/iu.test(part) ||
          (kind === 'native' && part.startsWith(`bin/napi-v6/${platform[0]}/${platform[1]}/`))
        );
      });
      const metadata = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'));
      if (metadata.name !== name || metadata.version !== version || metadata.license !== 'MIT')
        throw new Error('Unexpected runtime metadata.');
    }
    rmSync(dirname(folder), { recursive: true });
  }
  const runtime = join(
    staging,
    'runtime',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
    ...target.split('-'),
    'onnxruntime_binding.node',
  );
  if (!existsSync(runtime)) throw new Error('The runtime has no binary for this platform.');
  mkdirSync(join(staging, 'notices'), { recursive: true });
  copyTree(join(ROOT, 'LICENSES', 'ai'), join(staging, 'notices'), () => true);
  const files = {};
  async function manifest(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await manifest(file);
      else
        files[relative(staging, file).split(sep).join('/')] = {
          bytes: lstatSync(file).size,
          sha256: await hash(file),
        };
    }
  }
  await manifest(staging);
  writeFileSync(
    join(staging, 'SOURCE.json'),
    JSON.stringify(
      { model: 'intfloat/multilingual-e5-small', revision, licence: 'MIT', target, packages, files },
      null,
      2,
    ) + '\n',
  );
  // A complete verified staging folder replaces only this target's previous generated payload.
  noLinks(output);
  if (existsSync(output)) {
    const previous = join(output, 'SOURCE.json');
    if (!existsSync(previous))
      throw new Error('Existing output is not a generated AI target. Choose a new --out folder.');
    const source = JSON.parse(readFileSync(previous, 'utf8'));
    if (source.model !== 'intfloat/multilingual-e5-small' || source.target !== target)
      throw new Error('Existing output belongs to another target.');
    const backup = staging + '-previous';
    renameSync(output, backup);
    try {
      renameSync(staging, output);
    } catch (error) {
      renameSync(backup, output);
      throw error;
    }
    rmSync(backup, { recursive: true });
  } else renameSync(staging, output);
  console.log(
    `Offline helper assets prepared for ${target}: ${Object.keys(files).length} files, ${Object.values(files).reduce((sum, file) => sum + file.bytes, 0)} bytes.`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
