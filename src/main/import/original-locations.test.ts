import { linkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OriginalsStore } from './originals-store';
import { originalWorld } from './testing/original-fixture';

describe('retained originals selected directly from a file', () => {
  it('remembers each external source location independently of a presentation row', async () => {
    const w = originalWorld();
    try {
      const store = new OriginalsStore(w.db, w.mediaDir, { freeBytes: () => 1024 ** 4 });
      const staged = await store.stage(w.source, 'pdf');
      if (!staged.ok) throw new Error(staged.message);
      const alias = join(w.externalDir, 'Placeholder source alias.pdf');
      linkSync(w.source, alias);
      store.register(staged.original, w.source);
      store.register(staged.original, alias);
      const table = w.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'document_original_locations'")
        .get();
      const paths = table
        ? w.db.prepare('SELECT source_path FROM document_original_locations ORDER BY source_path').all()
        : [];
      expect(paths, 'both originals stay protected even though no presentation was imported').toEqual(
        [w.source, alias].sort().map((source_path) => ({ source_path })),
      );
      expect(store.list()).toEqual([staged.original]);
      expect(w.db.prepare('SELECT COUNT(*) FROM presentations').pluck().get()).toBe(0);
      expect(readFileSync(w.source)).toEqual(w.bytes);
      expect(readFileSync(alias)).toEqual(w.bytes);
      expect(readFileSync(staged.file)).toEqual(w.bytes);
    } finally {
      w.clean();
    }
  });
});
