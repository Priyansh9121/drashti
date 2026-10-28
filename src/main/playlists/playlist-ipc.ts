import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc';
import type { RenderSlide } from '../../shared/model';
import type { PlaylistResult, SmartPlaylistView } from '../../shared/playlists';
import { repeatSettingsSchema } from '../../shared/repeat';
import {
  idListSchema,
  itemOrderSchema,
  newItemsSchema,
  playlistIdSchema,
  playlistNameSchema,
  positionSchema,
  slotSchema,
  timerCuesSchema,
  templateRequestSchema,
} from '../../shared/playlists';
import type { PlaylistRepo } from '../db/playlists';
import { handle } from '../ipc/handle';
import type { StartupReads } from '../ipc/startup-reads';

/*
 * The playlist requests: anyone of Drashti's pages may read playlists;
 * only the operator window may change them. Every argument is checked here.
 */

export interface PlaylistIpcDeps {
  repo: PlaylistRepo;
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  /** Tell the operator window (and the engine) that playlists changed. */
  changed: () => void;
  /** The operator opened a playlist (Session 14: it counts as this week's for nodes). */
  opened: (playlistId: string) => void;
  /** A presentation's first slide in its order, for a playlist card (Session 26a); null when it has none. */
  firstSlide: (presentationId: string) => RenderSlide | null;
  /** The windows' start-up reads (Session 39): a failure fails the request and is logged once. */
  reads: StartupReads;
  /** Smart playlists (Session 26c, smart-folders.ts). */
  smart?: {
    /** The folder an admin chooses for a new one (a dialog), or null. */
    pickFolder(): Promise<string | null>;
    create(folder: string): Promise<{ ok: true; id: string } | { ok: false; message: string }>;
    views(): SmartPlaylistView[];
    removeMissing(playlistId: string): string[];
    itemsRestored(itemIds: readonly string[]): void;
    /** Playlists were deleted or brought back. */
    refresh(): Promise<void>;
  };
}

const refused: PlaylistResult = { ok: false, message: 'Only the operator window can change playlists.' };
const failed = (message: string): PlaylistResult => ({ ok: false, message });

/**
 * The playlists' changes a phone makes too (Session 54, the phone as a full Drashti: network/desktop-answers.ts),
 * each as the operator window's request makes it, every argument checked alike; the windows told when something
 * changed. Simple Mode's lock and the phone's own checks are the network's.
 */
export interface PlaylistChanges {
  create(name: unknown, parentId: unknown, isFolder: unknown): PlaylistResult;
  rename(playlistId: unknown, name: unknown): PlaylistResult;
  remove(ids: unknown): PlaylistResult;
  restore(ids: unknown): PlaylistResult;
  addItems(playlistId: unknown, at: unknown, items: unknown): PlaylistResult;
  moveItems(playlistId: unknown, ids: unknown, to: unknown): PlaylistResult;
  removeItems(ids: unknown): PlaylistResult;
  restoreItems(ids: unknown): PlaylistResult;
}

export function registerPlaylistIpc({
  repo,
  fromOperator,
  changed,
  opened,
  firstSlide,
  smart,
  reads,
}: PlaylistIpcDeps): PlaylistChanges {
  /** Run a change for the operator window, then tell everyone when something changed. */
  const change = (event: IpcMainInvokeEvent, run: () => PlaylistResult): PlaylistResult => {
    if (!fromOperator(event)) return refused;
    const result = run();
    if (result.ok && result.ids.length > 0) changed();
    return result;
  };

  handle(IPC.playlists.tree, () => reads.read('playlists', () => repo.tree()));
  handle(IPC.playlists.items, (_e, playlistId) => {
    const id = playlistIdSchema.safeParse(playlistId);
    return id.success ? reads.read('playlist-items', () => repo.itemsOf(id.data)) : [];
  });
  handle(IPC.playlists.firstSlides, (_e, presentationIds) => {
    const ids = idListSchema.max(500).safeParse(presentationIds);
    if (!ids.success) return {};
    return Object.fromEntries(ids.data.map((id) => [id, firstSlide(id)]));
  });
  // Opening is not a change to the playlist: Simple Mode's picker counts too.
  handle(IPC.playlists.opened, (e, playlistId) => {
    const id = playlistIdSchema.safeParse(playlistId);
    if (fromOperator(e) && id.success) opened(id.data);
    return null;
  });
  // Shared with phones and tablets, or not (Session 54): a playlist (a folder playlist too), never a folder of
  // playlists or a template. The phones hear of it as of any change to the playlists.
  handle(IPC.playlists.share, (e, playlistId, on) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(playlistId);
      if (!id.success || typeof on !== 'boolean') return failed('Share it, or stop sharing it?');
      return repo.setShared(id.data, on)
        ? { ok: true, ids: [id.data] }
        : failed('Only a playlist can be shared with phones and tablets.');
    }),
  );
  // The changes themselves, the operator window's and a phone's alike (Session 54).
  const changes: PlaylistChanges = {
    create: (name, parentId, isFolder) => {
      const n = playlistNameSchema.safeParse(name);
      const parent = playlistIdSchema.nullable().safeParse(parentId);
      if (!n.success || !parent.success || typeof isFolder !== 'boolean')
        return failed('A name needs 1 to 200 characters.');
      const id = repo.create(n.data, parent.data, isFolder);
      return id ? { ok: true, ids: [id] } : failed('That folder no longer exists.');
    },
    rename: (playlistId, name) => {
      const id = playlistIdSchema.safeParse(playlistId);
      const n = playlistNameSchema.safeParse(name);
      if (!id.success || !n.success) return failed('A name needs 1 to 200 characters.');
      return repo.rename(id.data, n.data)
        ? { ok: true, ids: [id.data] }
        : failed('That playlist no longer exists.');
    },
    // A smart playlist deleted stops following its folder; brought back, it follows it again.
    remove: (ids) => {
      const list = idListSchema.safeParse(ids);
      if (!list.success) return failed('Nothing was removed.');
      const removed = repo.remove(list.data);
      void smart?.refresh();
      return { ok: true, ids: removed };
    },
    restore: (ids) => {
      const list = idListSchema.safeParse(ids);
      if (!list.success) return failed('Nothing was restored.');
      const restored = repo.restore(list.data);
      void smart?.refresh();
      return { ok: true, ids: restored };
    },
    addItems: (playlistId, at, items) => {
      const id = playlistIdSchema.safeParse(playlistId);
      const where = positionSchema.nullable().safeParse(at);
      const list = newItemsSchema.safeParse(items);
      if (!id.success || !where.success || !list.success) return failed('Those items cannot be added.');
      // A Repeat Slides playlist takes no videos or sounds (Session 26d), and says so.
      const refusal = repo.refusal(id.data, list.data);
      if (refusal !== null) return failed(refusal);
      const added = repo.addItems(id.data, where.data, list.data);
      return added.length > 0
        ? { ok: true, ids: added }
        : failed('That playlist, or something added, no longer exists.');
    },
    moveItems: (playlistId, ids, to) => {
      const id = playlistIdSchema.safeParse(playlistId);
      const list = idListSchema.safeParse(ids);
      const where = positionSchema.safeParse(to);
      if (!id.success || !list.success || !where.success) return failed('Those items cannot be moved.');
      return repo.moveItems(id.data, list.data, where.data)
        ? { ok: true, ids: list.data }
        : failed('Those items are not all in that playlist.');
    },
    removeItems: (ids) => {
      const list = idListSchema.safeParse(ids);
      return list.success ? { ok: true, ids: repo.removeItems(list.data) } : failed('Nothing was removed.');
    },
    restoreItems: (ids) => {
      const list = idListSchema.safeParse(ids);
      if (!list.success) return failed('Nothing was restored.');
      const restored = repo.restoreItems(list.data);
      // A smart playlist's missing items taken out and brought back: missing again.
      smart?.itemsRestored(restored);
      return { ok: true, ids: restored };
    },
  };
  handle(IPC.playlists.create, (e, name, parentId, isFolder) =>
    change(e, () => changes.create(name, parentId, isFolder)),
  );
  handle(IPC.playlists.rename, (e, playlistId, name) => change(e, () => changes.rename(playlistId, name)));
  handle(IPC.playlists.remove, (e, ids) => change(e, () => changes.remove(ids)));
  handle(IPC.playlists.restore, (e, ids) => change(e, () => changes.restore(ids)));
  handle(IPC.playlists.addItems, (e, playlistId, at, items) =>
    change(e, () => changes.addItems(playlistId, at, items)),
  );
  handle(IPC.playlists.moveItems, (e, playlistId, ids, to) =>
    change(e, () => changes.moveItems(playlistId, ids, to)),
  );
  handle(IPC.playlists.removeItems, (e, ids) => change(e, () => changes.removeItems(ids)));
  handle(IPC.playlists.restoreItems, (e, ids) => change(e, () => changes.restoreItems(ids)));
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

  handle(IPC.playlists.templates, () => reads.read('playlists', () => repo.tree(true)));
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
  handle(IPC.playlists.editSlot, (e, itemId, slot) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(itemId);
      const s = slotSchema.safeParse(slot);
      if (!id.success || !s.success) return failed('A slot needs a name (1 to 200 characters).');
      return repo.editSlot(id.data, s.data.label, s.data.category)
        ? { ok: true, ids: [id.data] }
        : failed('Only a slot can be renamed this way.');
    }),
  );
  handle(IPC.playlists.setTimers, (e, itemId, cues) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(itemId);
      const c = timerCuesSchema.safeParse(cues);
      if (!id.success || !c.success) return failed('Those timer cues cannot be set.');
      return repo.setTimers(id.data, c.data)
        ? { ok: true, ids: [id.data] }
        : failed('Only a presentation, media or passage item runs timers when it goes up.');
    }),
  );
  // ---- Repeat Slides (Session 26d) --------------------------------------------------------
  handle(IPC.playlists.createRepeat, (e, parentId) =>
    change(e, () => {
      const parent = playlistIdSchema.nullable().safeParse(parentId);
      if (!parent.success) return failed('That folder no longer exists.');
      const id = repo.createRepeat('Repeat Slides', parent.data);
      return id ? { ok: true, ids: [id] } : failed('That folder no longer exists.');
    }),
  );
  handle(IPC.playlists.setRepeat, (e, playlistId, settings) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(playlistId);
      const s = repeatSettingsSchema.safeParse(settings);
      if (!id.success) return failed('That playlist no longer exists.');
      if (!s.success)
        return failed(
          'Each slide is up for 3 to 600 seconds, and a transition takes 0.3 to 3 seconds, never more than half of that.',
        );
      return repo.setRepeatSettings(id.data, s.data)
        ? { ok: true, ids: [id.data] }
        : failed('That Repeat Slides playlist no longer exists.');
    }),
  );
  // ---- smart playlists (Session 26c) -----------------------------------------------------
  handle(IPC.playlists.smartViews, () => smart?.views() ?? []);
  handle(IPC.playlists.createSmart, async (e) => {
    if (!fromOperator(e)) return refused;
    if (!smart) return failed('Smart playlists are not available.');
    const folder = await smart.pickFolder();
    if (folder === null) return { ok: true, ids: [] };
    const made = await smart.create(folder);
    return made.ok ? { ok: true, ids: [made.id] } : failed(made.message);
  });
  handle(IPC.playlists.removeMissing, (e, playlistId) =>
    change(e, () => {
      const id = playlistIdSchema.safeParse(playlistId);
      if (!id.success || !smart) return failed('That playlist no longer exists.');
      return { ok: true, ids: smart.removeMissing(id.data) };
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

  // A phone's (Session 54): the same changes, the windows and the engine told when something changed.
  const told =
    <A extends unknown[]>(run: (...args: A) => PlaylistResult) =>
    (...args: A): PlaylistResult => {
      const result = run(...args);
      if (result.ok && result.ids.length > 0) changed();
      return result;
    };
  return {
    create: told(changes.create),
    rename: told(changes.rename),
    remove: told(changes.remove),
    restore: told(changes.restore),
    addItems: told(changes.addItems),
    moveItems: told(changes.moveItems),
    removeItems: told(changes.removeItems),
    restoreItems: told(changes.restoreItems),
  };
}
