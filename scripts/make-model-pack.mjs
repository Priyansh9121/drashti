#!/usr/bin/env node
// Make a caption and translation model pack's list (alpha.22, cap-pack): drashti-model-pack.json, which
// Help › Caption and Translation Models… checks every file against before it keeps the pack. Run on the computer
// that puts the pack together, never inside Drashti: it reads a plan and the pack's folder and writes the list with
// each file's bytes and SHA-256, worked out from the files themselves. Nothing is fetched.
//
//   node scripts/make-model-pack.mjs <pack folder> <plan.json>
//
// The plan: { "id", "name", "release",
//   "licences": { "<file in the pack>": "<licence>" },
//   "models": [{ "id", "format", "purpose": ["captions-gu", …], "licence", "licenceFile", "folder", "attribution" }] }
// A model's attribution says who made it and where it is from, as its licence asks to be credited.
// Every file under a model's folder belongs to that model; the licence texts are listed as given. Files the plan
// does not name are left out of the list (and so out of what Drashti keeps).
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACK_MANIFEST = 'drashti-model-pack.json';

/** A file's SHA-256, a megabyte at a time. */
async function sha256Of(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}

/** Every plain file under `folder`, by its name in the pack ("/" between parts), in name order. */
function filesUnder(top, folder) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      const s = lstatSync(path);
      if (s.isSymbolicLink())
        throw new Error(`${relative(top, path)} is a link: put the file itself in the pack.`);
      if (s.isDirectory()) walk(path);
      else if (s.isFile()) out.push(relative(top, path).split(sep).join('/'));
    }
  };
  const root = join(top, ...folder.split('/'));
  if (lstatSync(root).isSymbolicLink())
    throw new Error(`${folder} is a link: put the files themselves in the pack.`);
  walk(root);
  return out;
}

/** The pack's list for the folder `top`, as the plan says, each file's bytes and SHA-256 its own. */
export async function makeManifest(top, plan) {
  const files = [];
  const entry = async (name, more) => {
    const path = join(top, ...name.split('/'));
    const s = lstatSync(path);
    if (!s.isFile()) throw new Error(`${name} is not a file in the pack's folder.`);
    files.push({ name, bytes: s.size, sha256: await sha256Of(path), ...more });
  };
  for (const [name, licence] of Object.entries(plan.licences ?? {}))
    await entry(name, { licence, purpose: ['licence'] });
  for (const m of plan.models ?? []) {
    const names = filesUnder(top, m.folder);
    if (names.length === 0) throw new Error(`The model ${m.id}'s folder ${m.folder} holds no file.`);
    for (const name of names)
      await entry(name, {
        licence: m.licence,
        purpose: m.purpose,
        model: m.id,
        format: m.format,
        licenceFile: m.licenceFile,
        attribution: m.attribution,
      });
  }
  return {
    format: 'drashti-model-pack',
    version: 1,
    id: plan.id,
    name: plan.name,
    release: plan.release,
    files,
  };
}

// Run, not imported (the unit test imports it).
const ranDirectly = () => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (ranDirectly()) {
  const [top, planFile] = process.argv.slice(2);
  try {
    if (!top || !planFile)
      throw new Error('Give the pack folder and the plan: make-model-pack.mjs <folder> <plan.json>');
    const manifest = await makeManifest(top, JSON.parse(readFileSync(planFile, 'utf8')));
    writeFileSync(join(top, PACK_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    const bytes = manifest.files.reduce((sum, f) => sum + f.bytes, 0);
    console.log(`${PACK_MANIFEST}: ${String(manifest.files.length)} files, ${String(bytes)} bytes.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
