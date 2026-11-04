import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarFile } from '../../shared/calendar';
import { suggestLyrics, applyLyricSuggestions } from '../../shared/ai-lyrics';
import { openDatabase, type Db } from '../db/database';
import { CalendarRepo } from '../db/calendar';
import { PlaylistRepo } from '../db/playlists';
import { SearchIndex } from '../db/search';
import { SettingsRepo } from '../db/settings';
import { AiHelpers } from './coordinator';
import type { AiWorkerRpc } from './rpc';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../docs/examples/placeholder-ai.json'), 'utf8'),
) as { lyrics: { gu: string }; calendar: CalendarFile };
let db: Db;
let playlists: PlaylistRepo;
let calendar: CalendarRepo;
let allowed: boolean;
let helpers: AiHelpers;
let run: ReturnType<typeof vi.fn<AiWorkerRpc['run']>>;
let cancel: ReturnType<typeof vi.fn<() => void>>;
let changed: ReturnType<typeof vi.fn<() => void>>;
const enabled = { search: true, tidy: true, playlist: true };
beforeEach(() => {
  db = openDatabase(':memory:');
  playlists = new PlaylistRepo(db);
  calendar = new CalendarRepo(db);
  allowed = true;
  cancel = vi.fn<() => void>();
  changed = vi.fn<() => void>();
  run = vi.fn<AiWorkerRpc['run']>((job) => {
    if (job.kind === 'lyrics') return Promise.resolve(suggestLyrics(job.request));
    if (job.kind === 'apply-lyrics')
      return Promise.resolve(applyLyricSuggestions(job.text, job.proposal, job.selected));
    if (job.kind === 'rank')
      return Promise.resolve(job.rows.map((row, i) => ({ id: row.id, score: 0.95 - i * 0.1 })));
    return Promise.resolve([]);
  });
  helpers = new AiHelpers({
    db,
    playlists,
    calendar,
    settings: new SettingsRepo(db),
    search: new SearchIndex(db),
    rpc: { run, cancel, busy: vi.fn() },
    authorised: (owner) => allowed && owner === 7,
    changed,
    settingsChanged: vi.fn(),
  });
});
afterEach(() => db.close());
function past(): string {
  const id = playlists.create('Placeholder past sabha', null, false);
  if (!id) throw new Error('Fixture playlist missing');
  const rows = playlists.addItems(id, null, [
    { kind: 'header', label: 'Placeholder blue boat' },
    { kind: 'header', label: 'Placeholder river' },
  ]);
  db.prepare('UPDATE playlist_items SET color=? WHERE id=?').run('#336699', rows[0]);
  return id;
}
const count = () => playlists.list().length;
describe('operator approval boundary', () => {
  it('defaults off and never starts work for disabled helpers, Simple Mode or another sender', async () => {
    expect(helpers.get(7)).toEqual({ ok: true, value: { search: false, tidy: false, playlist: false } });
    expect((await helpers.search(7, { query: 'Placeholder', requestId: 'one' }, vi.fn())).ok).toBe(false);
    expect(
      (await helpers.suggestLyrics(7, { source: 'pasted-lyrics', text: fixture.lyrics.gu, action: 'breaks' }))
        .ok,
    ).toBe(false);
    expect(helpers.set(8, enabled).ok).toBe(false);
    allowed = false;
    expect(helpers.set(7, enabled).ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
  it('rejects Books, translation, invalid calendar dates and invented past sources before a worker call', async () => {
    helpers.set(7, enabled);
    for (const request of [
      { source: 'books', text: fixture.lyrics.gu, action: 'breaks' },
      { source: 'pasted-lyrics', text: fixture.lyrics.gu, action: 'translate' },
    ])
      expect((await helpers.suggestLyrics(7, request)).ok).toBe(false);
    expect(
      (await helpers.suggestPlaylist(7, { date: '2026-02-30', pastIds: ['invented'], requestId: 'one' })).ok,
    ).toBe(false);
    expect(
      (await helpers.suggestPlaylist(7, { date: '2026-12-06', pastIds: ['invented'], requestId: 'one' })).ok,
    ).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('keeps lyric approval tied to its owner and original text, and expires it when switched off', async () => {
    helpers.set(7, enabled);
    const result = await helpers.suggestLyrics(7, {
      source: 'pasted-lyrics',
      text: fixture.lyrics.gu,
      action: 'breaks',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Missing review');
    const request = {
      id: result.value.id,
      text: fixture.lyrics.gu,
      selected: result.value.proposal.changes.map((row) => row.id),
    };
    expect((await helpers.approveLyrics(8, request)).ok).toBe(false);
    expect((await helpers.approveLyrics(7, { ...request, text: request.text + ' ' })).ok).toBe(false);
    expect((await helpers.approveLyrics(7, request)).ok).toBe(true);
    expect((await helpers.approveLyrics(7, request)).ok).toBe(false);
    helpers.set(7, { ...enabled, tidy: false });
    expect((await helpers.approveLyrics(7, request)).ok).toBe(false);
    expect(count()).toBe(0);
    expect(changed).not.toHaveBeenCalled();
  });
  it('discards work that completes after a helper is disabled', async () => {
    helpers.set(7, enabled);
    let finish: ((value: unknown) => void) | undefined;
    run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const progress = vi.fn();
    const waiting = helpers.search(7, { query: 'Placeholder blue boat', requestId: 'one' }, progress);
    helpers.set(7, { ...enabled, search: false });
    finish?.([]);
    expect((await waiting).ok).toBe(false);
    expect(progress).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('writes nothing until approval, then copies only selected rows in the approved order with their metadata', async () => {
    helpers.set(7, enabled);
    const source = past();
    const original = playlists.itemsOf(source);
    const before = count();
    const result = await helpers.suggestPlaylist(7, {
      date: '2026-12-06',
      pastIds: [source],
      requestId: 'one',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Missing playlist review');
    expect(count()).toBe(before);
    expect(playlists.itemsOf(source)).toEqual(original);
    expect(changed).not.toHaveBeenCalled();
    const approved = helpers.approvePlaylist(7, {
      id: result.value.id,
      name: 'Placeholder approved sabha',
      rows: result.value.rows.map((row) => row.id).reverse(),
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error('Approval failed');
    expect(count()).toBe(before + 1);
    expect(playlists.itemsOf(approved.value.id).map(({ id: _id, ...row }) => row)).toEqual(
      original.map(({ id: _id, ...row }) => row).reverse(),
    );
    expect(playlists.itemsOf(source)).toEqual(original);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT for_date FROM ai_sabhas WHERE playlist_id=?').get(approved.value.id)).toEqual({
      for_date: '2026-12-06',
    });
    expect(
      helpers.approvePlaylist(7, {
        id: result.value.id,
        name: 'Again',
        rows: result.value.rows.map((row) => row.id),
      }).ok,
    ).toBe(false);
  });
  it('rejects edited sources and invented row approvals without making a playlist', async () => {
    helpers.set(7, enabled);
    const source = past();
    const before = count();
    const result = await helpers.suggestPlaylist(7, {
      date: '2026-12-06',
      pastIds: [source],
      requestId: 'one',
    });
    if (!result.ok) throw new Error('Missing review');
    expect(
      helpers.approvePlaylist(7, { id: result.value.id, name: 'Placeholder', rows: ['invented'] }).ok,
    ).toBe(false);
    playlists.addItems(source, null, [{ kind: 'header', label: 'Placeholder added later' }]);
    expect(
      helpers.approvePlaylist(7, {
        id: result.value.id,
        name: 'Placeholder',
        rows: result.value.rows.map((row) => row.id),
      }).ok,
    ).toBe(false);
    expect(count()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
  });
});
