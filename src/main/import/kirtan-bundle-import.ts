import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname } from 'node:path';
import type { ImportIssue, ImportOptions } from '../../shared/import';
import { NO_COUNTS } from '../../shared/import';
import type { Db } from '../db/database';
import { MediaRepo } from '../db/media';
import type { NewImportItem } from '../db/imports';
import { PresentationRepo } from '../db/presentations';
import { diskFreeBytes, type StagedMedia } from './media-store';
import type { MediaStore } from './media-store';
import {
  withKirtanBundle,
  bundleMediaIds,
  type OpenBundleOptions,
  type OpenKirtanBundle,
} from './kirtan-bundle';
import { bundleState, keepBundleState, bundleLocalHash, mapBundleContent } from './kirtan-bundle-state';
import { BUNDLE_LIMITS, type BundleKirtan } from './kirtan-bundle-schema';

interface NativeBundleImport extends OpenBundleOptions {
  db: Db;
  media: MediaStore;
  path: string;
  sourcePath: string;
  isCancelled?: () => boolean;
  options: ImportOptions;
  /** The pipeline writes each item with its report in its ordinary bounded batch/savepoint. */
  write: (apply: () => NewImportItem, sourcePath: string) => Promise<void>;
}

function incomingHash(bundle: OpenKirtanBundle, kirtan: BundleKirtan, hash: string): string {
  const media = new Set(bundleMediaIds(kirtan.content));
  return createHash('sha256')
    .update(JSON.stringify({ hash, media: bundle.manifest.media.filter((m) => media.has(m.id)) }))
    .digest('hex');
}

/** Called only inside the pipeline's savepoint, after every archive entry has been validated and staged. */
function applyKirtan(
  o: NativeBundleImport,
  bundle: OpenKirtanBundle,
  k: BundleKirtan,
  index: number,
  staged: Map<string, StagedMedia>,
): NewImportItem {
  const descriptor = bundle.manifest.kirtans[index];
  if (!descriptor) throw new Error('The bundle has no description for this kirtan.');
  const sourcePath = `${o.sourcePath}!/${descriptor.entry}`;
  const repo = new PresentationRepo(o.db);
  const state = bundleState(o.db, descriptor.id);
  const old = state
    ? (o.db
        .prepare('SELECT id, name, library_id, deleted_at FROM presentations WHERE id = ?')
        .get(state.presentationId) as
        { id: string; name: string; library_id: string; deleted_at: string | null } | undefined)
    : undefined;
  const item: NewImportItem = {
    sourcePath,
    format: 'kirtan-bundle',
    outcome: 'skipped',
    name: old?.name ?? k.name,
    target: old ? { kind: 'presentation', id: old.id } : null,
    counts: { ...NO_COUNTS },
    message: null,
    issues: [],
  };
  if (state && old?.deleted_at !== null) {
    item.message = 'Deleted locally; restore the kirtan in this library before importing it again.';
    item.issues.push({ severity: 'info', code: 'bundle-deleted', message: item.message, fix: null });
    return item;
  }
  if (state && bundleLocalHash(o.db, state.presentationId) !== state.localHash) {
    item.message =
      'Local edits kept. The incoming kirtan did not replace your words, details or arrangements.';
    item.issues.push({ severity: 'warning', code: 'bundle-local-edit', message: item.message, fix: null });
    return item;
  }
  const receivedHash = incomingHash(bundle, k, descriptor.sha256);
  if (state?.incomingHash === receivedHash) {
    item.message = 'Already in the library, unchanged since it was imported.';
    return item;
  }
  const choice =
    o.options.decisions?.[sourcePath] ?? o.options.decisions?.[o.sourcePath] ?? o.options.onConflict;
  if (old && choice === 'skip') {
    item.message = 'Skipped the incoming change as chosen.';
    return item;
  }
  const mediaRepo = new MediaRepo(o.db);
  const mediaMap = new Map<string, string>();
  const issues: ImportIssue[] = [];
  for (const id of bundleMediaIds(k.content)) {
    const file = bundle.media.find((m) => m.id === id);
    if (!file) throw new Error('A media reference has no description.');
    const ready = staged.get(id);
    if (ready) {
      const result = o.media.addStaged(ready, { kind: 'media', path: sourcePath, ref: id });
      if (result.outcome === 'imported') item.counts.media++;
      mediaMap.set(id, result.mediaId);
      // Existing files keep their local points. New files receive the sender's points, never live ones.
      if (result.outcome === 'imported' && file.markers) mediaRepo.setMarkers(result.mediaId, file.markers);
      if (result.outcome === 'imported' && file.look) mediaRepo.setLook(result.mediaId, file.look);
    } else {
      const same = file.sha256
        ? (o.db
            .prepare('SELECT id FROM media WHERE sha256 = ? AND missing = 0 AND deleted_at IS NULL')
            .get(file.sha256) as { id: string } | undefined)
        : undefined;
      if (same) {
        mediaMap.set(id, same.id);
        continue;
      }
      const missing = o.media.addMissing(`kirtan-bundle/${descriptor.id}/${id}/${file.name}`, file.kind, {
        kind: 'drashti',
        path: sourcePath,
        ref: id,
      });
      mediaMap.set(id, missing);
      issues.push({
        severity: 'warning',
        code: 'missing-media',
        message: `${file.name} was not included. Find the file in Media, or import a bundle that includes it.`,
        fix: { kind: 'relink-media', mediaId: missing },
      });
    }
  }
  const libraryId = repo.ensureLibrary('Kirtans');
  const id =
    old?.id ??
    repo.insert({
      libraryId,
      name: repo.uniqueName(libraryId, k.name),
      notes: k.notes,
      groups: [],
      source: { kind: 'drashti', path: o.path, ref: descriptor.id, importedAt: new Date().toISOString() },
    });
  const ids = new Map<string, string>(Object.entries(state?.ids ?? {}));
  const ownRows = old ? repo.content(id) : null;
  const own = new Set(
    ownRows
      ? [
          ...ownRows.groups,
          ...ownRows.slides,
          ...ownRows.elements,
          ...ownRows.cues,
          ...ownRows.arrangements,
        ].map((r) => r.id)
      : [],
  );
  const entity = (source: string) => {
    if (source === descriptor.id) return id;
    const found = ids.get(source);
    if (found) return found;
    const next = own.has(source) ? source : randomUUID();
    ids.set(source, next);
    return next;
  };
  const mapped = mapBundleContent(k.content, entity, (source) => {
    const mappedMedia = mediaMap.get(source);
    if (!mappedMedia) throw new Error('The bundle has an unknown media reference.');
    ids.set(source, mappedMedia);
    return mappedMedia;
  });
  mapped.presentationId = id;
  mapped.themeId = ownRows?.themeId ?? null;
  if (old && old.name !== k.name) {
    const taken = o.db
      .prepare(
        'SELECT 1 FROM presentations WHERE library_id = ? AND name = ? AND id <> ? AND deleted_at IS NULL',
      )
      .get(old.library_id, k.name, id);
    if (!taken) {
      o.db.prepare('UPDATE presentations SET name = ? WHERE id = ?').run(k.name, id);
      item.name = k.name;
    }
  }
  repo.setContent(mapped);
  o.db
    .prepare('UPDATE presentations SET notes = ?, source_hash = ?, source_imported_at = ? WHERE id = ?')
    .run(k.notes, descriptor.sha256, new Date().toISOString(), id);
  const localHash = bundleLocalHash(o.db, id);
  if (!localHash) throw new Error('The imported kirtan could not be read back.');
  keepBundleState(o.db, descriptor.id, {
    presentationId: id,
    incomingHash: receivedHash,
    localHash,
    ids: Object.fromEntries(ids),
  });
  item.outcome = old ? 'replaced' : 'imported';
  item.target = { kind: 'presentation', id };
  item.counts = {
    ...item.counts,
    presentations: 1,
    groups: mapped.groups.length,
    slides: mapped.slides.filter((s) => s.enabled === 1).length,
    arrangements: mapped.arrangements.length,
  };
  item.issues = issues;
  item.message = old ? 'Updated the same kirtan in this library.' : 'Added the kirtan to this library.';
  return item;
}

/** ZIP work and media copies run outside the database's write lock. */
export async function importKirtanBundle(o: NativeBundleImport): Promise<void> {
  await withKirtanBundle(o.path, o, async (bundle) => {
    // Unpacking and the database may live on different volumes. Include row/index/WAL workspace.
    const databaseBytes = bundle.manifest.kirtans.reduce((n, k) => n + k.bytes, 0) * 4 + 1024 ** 2;
    const checkDatabaseSpace = () => {
      if (
        o.db.name !== ':memory:' &&
        (o.freeBytes ?? diskFreeBytes)(dirname(o.db.name)) - databaseBytes < BUNDLE_LIMITS.reserve
      )
        throw new Error(
          'There is not enough free space on the library’s disk for these kirtans while keeping 2 GB free for the show.',
        );
    };
    checkDatabaseSpace();
    const staged = new Map<string, StagedMedia>();
    for (const file of bundle.media) {
      o.signal?.throwIfAborted();
      if (o.isCancelled?.()) return;
      if (!file.path) continue;
      const stage = await o.media.stage(file.path);
      if (!stage.ok) throw new Error(`Could not keep ${file.name}: ${stage.issue.message}`);
      if (stage.staged.sha256 !== file.sha256 || stage.staged.kind !== file.kind)
        throw new Error('The media does not match its bundle description.');
      staged.set(file.id, { ...stage.staged, name: file.name });
    }
    checkDatabaseSpace();
    for (const [index, k] of bundle.kirtans.entries()) {
      o.signal?.throwIfAborted();
      if (o.isCancelled?.()) return;
      const descriptor = bundle.manifest.kirtans[index];
      const source = `${o.sourcePath}!/${descriptor?.entry ?? basename(o.path)}`;
      await o.write(() => applyKirtan(o, bundle, k, index, staged), source);
    }
  });
}
