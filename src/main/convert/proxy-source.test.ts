import { expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { VideoEditsRepo } from '../db/video-edits';
it('unwraps a playing proxy before resolving its immutable edit-copy source', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare(
      "INSERT INTO media(id,kind,name,path) VALUES ('source','video','Placeholder source','placeholder.mp4')",
    ).run();
    const repo = new VideoEditsRepo(db, (id) => (id === 'proxy' ? 'source' : id));
    expect(repo.sourceId('proxy')).toBe('source');
    expect(repo.read('proxy')).toMatchObject({ mediaId: 'source', state: 'ready', readyMediaId: 'source' });
  } finally {
    db.close();
  }
});
