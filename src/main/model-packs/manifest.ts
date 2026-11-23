import {
  isModelPurpose,
  LICENCE_PURPOSE,
  OPEN_LICENCES,
  PACK_FORMAT,
  PACK_MANIFEST,
  packManifestSchema,
  type ModelPurpose,
  type PackFile,
  type PackManifest,
} from '../../shared/model-packs';
import { parsePlain } from '../../shared/plain-parse';

/*
 * A model pack's list, checked (alpha.22, cap-pack): its form (shared/model-packs.ts), and what the form cannot say:
 * no file named twice (in any case, as Mac and Windows folders see names), free and open licences only, known
 * purposes, each model's files agreeing on its purpose and format and naming a licence text the pack holds, and each
 * model in a folder of its own (that folder is where a caption or translation engine is pointed). Anything wrong
 * refuses the whole pack, saying what to do; nothing has been copied by then.
 */

/** One model of a pack: its files, in the list's order, and the folder in the pack that holds them. */
export interface CheckedModel {
  id: string;
  purposes: ModelPurpose[];
  format: string;
  /** The deepest folder holding all its files, by "/" (never the pack's top). */
  folder: string;
  files: PackFile[];
  licences: string[];
  bytes: number;
}

export interface CheckedPack {
  manifest: PackManifest;
  models: CheckedModel[];
  /** The licences' own texts. */
  licenceTexts: PackFile[];
  /** Every file listed. */
  bytes: number;
}

export type ManifestCheck = { ok: true; pack: CheckedPack } | { ok: false; message: string };

const FRESH = 'Nothing was installed: ask for a fresh copy of the pack.';
const NOT_A_PACK = `This is not a Drashti model pack: its ${PACK_MANIFEST} is not one. Nothing was installed: choose the pack’s own folder or zip.`;
const NEWER =
  'This model pack is for a newer Drashti. Nothing was installed: update Drashti, then import it again.';

const refuse = (message: string): ManifestCheck => ({ ok: false, message });

/** Where in the list a problem is, in words: "files › 2 › sha256" (counted from 1). */
const whereWords = (path: readonly PropertyKey[]) =>
  path.map((p) => (typeof p === 'number' ? String(p + 1) : String(p))).join(' › ');

/** A licence's name, as the list gives it, shown only when it reads as one. */
const licenceName = (licence: string) =>
  /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u.test(licence)
    ? `the licence ${licence}`
    : 'a licence Drashti does not know';

/** The folder a file is in, by "/" ('' at the pack's top). */
const folderOf = (name: string) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');

/** The deepest folder two folders share. */
function sharedFolder(a: string, b: string): string {
  const x = a.split('/');
  const y = b.split('/');
  const shared: string[] = [];
  for (let i = 0; i < Math.min(x.length, y.length) && x[i] === y[i]; i++) shared.push(x[i] ?? '');
  return shared.join('/');
}

/** Whether folder `inner` is `outer` or inside it. */
const within = (inner: string, outer: string) => inner === outer || inner.startsWith(`${outer}/`);

/** The list's JSON as read from the pack. */
export function readManifestText(text: string): ManifestCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse(`The pack’s list (${PACK_MANIFEST}) does not read: the pack is damaged. ${FRESH}`);
  }
  return checkManifest(raw);
}

/** Check a pack's list, as parsed. */
export function checkManifest(raw: unknown): ManifestCheck {
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== PACK_FORMAT)
    return refuse(NOT_A_PACK);
  const version = (raw as { version?: unknown }).version;
  if (typeof version === 'number' && Number.isInteger(version) && version > 1) return refuse(NEWER);
  const parsed = parsePlain(packManifestSchema, raw, 'wrong');
  if (!parsed.success)
    return refuse(
      `The pack’s list is not right (${whereWords(parsed.path) || 'its top'}). Nothing was installed: ask for a fresh copy of the pack.`,
    );
  const manifest = parsed.data;

  const seen = new Set<string>();
  for (const file of manifest.files) {
    const key = file.name.toLowerCase();
    if (key === PACK_MANIFEST.toLowerCase())
      return refuse(`The pack’s list names itself (${PACK_MANIFEST}) as one of its files. ${FRESH}`);
    if (seen.has(key)) return refuse(`The pack’s list names ${file.name} twice. ${FRESH}`);
    seen.add(key);
  }

  const licenceTexts = new Set<string>();
  for (const file of manifest.files) {
    if (!(OPEN_LICENCES as readonly string[]).includes(file.licence))
      return refuse(
        `${file.name} has ${licenceName(file.licence)}, which is not one of the free and open licences Drashti takes (${OPEN_LICENCES.join(', ')}). Nothing was installed: ask for a pack with open licences only.`,
      );
    const unknown = file.purpose.find((p) => p !== LICENCE_PURPOSE && !isModelPurpose(p));
    if (unknown !== undefined)
      return refuse(
        `${file.name} has a purpose Drashti does not know (${/^[a-z0-9-]+$/u.test(unknown) ? unknown : 'not readable'}). Nothing was installed: ask for a pack made for this Drashti.`,
      );
    if (new Set(file.purpose).size !== file.purpose.length)
      return refuse(`The pack’s list names a purpose of ${file.name} twice. ${FRESH}`);
    if (file.purpose.includes(LICENCE_PURPOSE)) {
      if (file.purpose.length > 1)
        return refuse(`${file.name} is given as a licence’s text and as a model at once. ${FRESH}`);
      if (file.model !== undefined || file.format !== undefined || file.licenceFile !== undefined)
        return refuse(
          `${file.name} is a licence’s text, so it belongs to no model and has no format. ${FRESH}`,
        );
      licenceTexts.add(file.name);
    }
  }

  const models = new Map<string, CheckedModel>();
  for (const file of manifest.files) {
    if (file.purpose.includes(LICENCE_PURPOSE)) continue;
    if (file.model === undefined || file.format === undefined || file.licenceFile === undefined)
      return refuse(
        `${file.name} does not say which model it belongs to, its format and its licence’s text. ${FRESH}`,
      );
    if (!licenceTexts.has(file.licenceFile))
      return refuse(
        `${file.name} names ${file.licenceFile} as its licence’s text, which the pack does not hold as one. ${FRESH}`,
      );
    const purposes = file.purpose as ModelPurpose[];
    const model = models.get(file.model);
    if (!model) {
      models.set(file.model, {
        id: file.model,
        purposes: [...purposes],
        format: file.format,
        folder: folderOf(file.name),
        files: [file],
        licences: [file.licence],
        bytes: file.bytes,
      });
      continue;
    }
    if (
      model.format !== file.format ||
      model.purposes.length !== purposes.length ||
      model.purposes.some((p) => !purposes.includes(p))
    )
      return refuse(`The files of the model ${model.id} do not agree on its purpose and format. ${FRESH}`);
    model.folder = sharedFolder(model.folder, folderOf(file.name));
    model.files.push(file);
    if (!model.licences.includes(file.licence)) model.licences.push(file.licence);
    model.bytes += file.bytes;
  }
  if (models.size === 0)
    return refuse(
      'The pack holds no model. Nothing was installed: ask for the pack with the caption or translation models.',
    );

  const checked = [...models.values()];
  for (const [i, model] of checked.entries()) {
    const apart =
      model.folder !== '' &&
      checked.slice(0, i).every((m) => !within(model.folder, m.folder) && !within(m.folder, model.folder));
    if (!apart) return refuse(`The model ${model.id} is not in a folder of its own in the pack. ${FRESH}`);
  }

  return {
    ok: true,
    pack: {
      manifest,
      models: checked,
      licenceTexts: manifest.files.filter((f) => licenceTexts.has(f.name)),
      bytes: manifest.files.reduce((sum, f) => sum + f.bytes, 0),
    },
  };
}
