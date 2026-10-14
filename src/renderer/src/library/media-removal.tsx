import { create } from 'zustand';
import type { MediaUsage } from '../../../shared/media-removal';
import { usageLines } from '../../../shared/media-removal';
import { useNotice } from '../operator/actions';
import { loadItems, loadTree } from '../playlists/playlist-store';
import { ConfirmDialog } from '../ui/Dialog';
import { loadMedia, useMedia } from './library-store';
import { describeSome, pushRemoval } from './undo';

/*
 * Deleting media (Session 26a): the media list's Delete key, its rows' trash
 * buttons and their menus all ask here first, saying where the media is used,
 * then delete with Undo (shared/media-removal.ts).
 */

interface Pending {
  ids: string[];
  names: string[];
  usage: MediaUsage;
}

const usePending = create<{ pending: Pending | null }>(() => ({ pending: null }));

/** Ask before deleting the marked media, or `of` (a row's trash or menu: the marked ones when it is one of them). */
export async function requestMediaRemoval(of?: string): Promise<void> {
  const { marked, media } = useMedia.getState();
  const ids = of !== undefined && !marked.includes(of) ? [of] : marked;
  if (ids.length === 0) return;
  const names = ids.map((id) => media.find((m) => m.id === id)?.name ?? '').filter((n) => n !== '');
  const usage = await window.drashti.media.usage(ids);
  usePending.setState({ pending: { ids, names, usage } });
}

/** After a removal or its Undo: the lists that showed it. */
async function reloadAll(): Promise<void> {
  await Promise.all([loadMedia(), loadTree()]);
  await loadItems();
}

async function confirm(pending: Pending): Promise<void> {
  usePending.setState({ pending: null });
  const result = await window.drashti.media.remove(pending.ids);
  if (!result.ok) {
    useNotice.setState({ text: result.message });
    return;
  }
  useMedia.setState((s) => ({ marked: s.marked.filter((id) => !result.ids.includes(id)) }));
  await reloadAll();
  const { ids } = result;
  pushRemoval({
    text: `Deleted ${describeSome(pending.names, ids.length, 'media file')}`,
    restore: async () => {
      const back = await window.drashti.media.restore(ids);
      if (!back.ok) useNotice.setState({ text: back.message });
      await reloadAll();
    },
  });
}

/** "Delete “Darshan.jpg”?", saying where it is used. Cancel has the focus; Undo brings it back. */
export function MediaRemoveConfirm({ undoKey }: { undoKey: string }) {
  const pending = usePending((s) => s.pending);
  if (!pending) return null;
  const count = pending.ids.length;
  const what = count === 1 ? `“${pending.names[0] ?? 'this media file'}”` : `${String(count)} media files`;
  const lines = usageLines(pending.usage, count);
  return (
    <ConfirmDialog
      title={`Delete ${what}?`}
      confirmLabel="Delete"
      onCancel={() => {
        usePending.setState({ pending: null });
      }}
      onConfirm={() => void confirm(pending)}
      testId="media-remove-confirm"
    >
      {lines.length === 0 ? (
        <p data-testid="media-usage">Nothing uses {count === 1 ? 'it' : 'them'}.</p>
      ) : (
        <>
          <p>{count === 1 ? 'It is used in:' : 'They are used in:'}</p>
          <ul className="list-disc space-y-0.5 pl-5" data-testid="media-usage">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {pending.usage.live && (
        <p className="text-warning-fg">
          {count === 1 ? 'It is' : 'One of them is'} on the screens now. It stays up until you change it.
        </p>
      )}
      <p>
        You can bring {count === 1 ? 'it' : 'them'} back with Undo ({undoKey}), with everything it was in.
      </p>
    </ConfirmDialog>
  );
}
