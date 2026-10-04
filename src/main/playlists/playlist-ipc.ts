import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc';
import type { PlaylistResult } from '../../shared/playlists';
import {
  idListSchema,
  itemOrderSchema,
  newItemsSchema,
  playlistIdSchema,
  playlistNameSchema,
  positionSchema,
  slotSchema,
  templateRequestSchema,
} from '../../shared/playlists';
import type { PlaylistRepo } from '../db/playlists';
import { handle } from '../ipc/handle';

/*
 * The playlist requests: anyone of Drashti's pages may read playlists;
 * only the operator window may change them. Every argument is checked here.
 */

export interface PlaylistIpcDeps {
  repo: PlaylistRepo;
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  /** Tell the operator window (and the engine) that playlists changed. */
  changed: () => void;
}

const refused: PlaylistResult = { ok: false, message: 'Only the operator window can change playlists.' };
const failed = (message: string): PlaylistResult => ({ ok: false, message });

export function registerPlaylistIpc({ repo, fromOperator, changed }: PlaylistIpcDeps): void {
  /** Run a change for the operator window, then tell everyone when something changed. */
  const change = (event: IpcMainInvokeEvent, run: () => PlaylistResult): PlaylistResult => {
    if (!fromOperator(event)) return refused;
    const result = run();
    if (result.ok && result.ids.length > 0) changed();
    return result;
  };

  handle(IPC.playlists.tree, () => repo.tree());
  handle(IPC.playlists.items, (_e, playlistId) => {
    const id = playlistIdSchema.safeParse(playlistId);
    return id.success ? repo.itemsOf(id.data) : [];
  });
  handle(IPC.playlists.create, (e, name, parentId, isFolder) =>
    change(e, () => {
      const n = playlistNameSchema.safeParse(name);
      const parent = playlistIdSchema.nullable().safeParse(parentId);
      if (!n.success || !parent.success || typeof isFolder !== 'boolean')
        return failed('A name needs 1 to 200 characters.');
      const id = repo.create(n.data, parent.data, isFolder);
      return id ? { ok: true, ids: [id] } : failed('That folder no longer exists.');
    }),
  );
  handle(IPC.playlists.rename, (e, playlistId, name) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(playlistId);
      const n = playlistNameSchema.safeParse(name);
      if (!id.success || !n.success) return failed('A name needs 1 to 200 characters.');
      return repo.rename(id.data, n.data)
        ? { ok: true, ids: [id.data] }
        : failed('That playlist no longer exists.');
    }),
  );
  handle(IPC.playlists.remove, (e, ids) =>
    change(e, () => {
      const list = idListSchema.safeParse(ids);
      return list.success ? { ok: true, ids: repo.remove(list.data) } : failed('Nothing was removed.');
    }),
  );
  handle(IPC.playlists.restore, (e, ids) =>
    change(e, () => {
      const list = idListSchema.safeParse(ids);
      return list.success ? { ok: true, ids: repo.restore(list.data) } : failed('Nothing was restored.');
    }),
  );
  handle(IPC.playlists.addItems, (e, playlistId, at, items) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(playlistId);
      const where = positionSchema.nullable().safeParse(at);
      const list = newItemsSchema.safeParse(items);
      if (!id.success || !where.success || !list.success) return failed('Those items cannot be added.');
      const added = repo.addItems(id.data, where.data, list.data);
      return added.length > 0
        ? { ok: true, ids: added }
        : failed('That playlist, or something added, no longer exists.');
    }),
  );
  handle(IPC.playlists.moveItems, (e, playlistId, ids, to) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(playlistId);
      const list = idListSchema.safeParse(ids);
      const where = positionSchema.safeParse(to);
      if (!id.success || !list.success || !where.success) return failed('Those items cannot be moved.');
      return repo.moveItems(id.data, list.data, where.data)
        ? { ok: true, ids: list.data }
        : failed('Those items are not all in that playlist.');
    }),
  );
  handle(IPC.playlists.removeItems, (e, ids) =>
    change(e, () => {
      const list = idListSchema.safeParse(ids);
      return list.success ? { ok: true, ids: repo.removeItems(list.data) } : failed('Nothing was removed.');
    }),
  );
  handle(IPC.playlists.restoreItems, (e, ids) =>
    change(e, () => {
      const list = idListSchema.safeParse(ids);
      return list.success ? { ok: true, ids: repo.restoreItems(list.data) } : failed('Nothing was restored.');
    }),
  );
  handle(IPC.playlists.fillPlaceholder, (e, itemId, presentationId) =>
    change(e, () => {
      const item = playlistIdSchema.safeParse(itemId);
      const pid = playlistIdSchema.safeParse(presentationId);
      if (!item.success || !pid.success) return failed('That placeholder cannot be filled.');
      return repo.fillPlaceholder(item.data, pid.data)
        ? { ok: true, ids: [item.data] }
        : failed(
            'Only a placeholder can be filled, with a presentation still in the library or a loaded passage.',
          );
    }),
  );
  handle(IPC.playlists.setItemOrder, (e, itemId, order) =>
    change(e, () => {
      const item = playlistIdSchema.safeParse(itemId);
      const o = itemOrderSchema.safeParse(order);
      if (!item.success || !o.success) return failed('That order is not valid.');
      return repo.setItemOrder(item.data, o.data)
        ? { ok: true, ids: [item.data] }
        : failed('That arrangement is not part of the presentation.');
    }),
  );
  handle(IPC.playlists.renameHeader, (e, itemId, label) =>
    change(e, () => {
      const item = playlistIdSchema.safeParse(itemId);
      const n = playlistNameSchema.safeParse(label);
      if (!item.success || !n.success) return failed('A header needs 1 to 200 characters.');
      return repo.renameHeader(item.data, n.data)
        ? { ok: true, ids: [item.data] }
        : failed('That header no longer exists.');
    }),
  );

  handle(IPC.playlists.templates, () => repo.tree(true));
  handle(IPC.playlists.saveAsTemplate, (e, playlistId, request) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(playlistId);
      const r = templateRequestSchema.safeParse(request);
      if (!id.success || !r.success) return failed('A template needs a name (1 to 200 characters).');
      if (repo.isTemplate(id.data)) return failed('That is a template already.');
      const made = repo.saveAsTemplate(id.data, r.data.name, r.data.slots);
      return made ? { ok: true, ids: [made] } : failed('That playlist no longer exists.');
    }),
  );
  handle(IPC.playlists.newFromTemplate, (e, templateId, name, parentId) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(templateId);
      const n = playlistNameSchema.safeParse(name);
      const parent = playlistIdSchema.nullable().safeParse(parentId);
      if (!id.success || !n.success || !parent.success)
        return failed('A playlist needs a name (1 to 200 characters).');
      const made = repo.newFromTemplate(id.data, n.data, parent.data);
      return made ? { ok: true, ids: [made] } : failed('That template, or the folder, no longer exists.');
    }),
  );
  handle(IPC.playlists.addSlot, (e, playlistId, at, slot) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(playlistId);
      const where = positionSchema.nullable().safeParse(at);
      const s = slotSchema.safeParse(slot);
      if (!id.success || !where.success || !s.success)
        return failed('A slot needs a name (1 to 200 characters).');
      const made = repo.addSlot(id.data, where.data, s.data.label, s.data.category);
      return made ? { ok: true, ids: [made] } : failed('That playlist no longer exists.');
    }),
  );
}
