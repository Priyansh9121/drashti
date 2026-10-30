import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { useFocusTrap } from '../../ui/Dialog';
import { cx } from '../../ui/cx';
import { X } from '../../ui/icons';
import { PhonePictureEditor } from './PhonePictureEditor';
import { PhoneQuestion, useBackCloses } from './PhoneSheet';
import {
  closeMenu,
  type MenuEntry,
  type Renaming,
  startPhoneTools,
  usePhoneTools,
} from './phone-tools-store';
import { removeRow } from './row-actions';

/*
 * Over the remote (Session 55, Part 9): a long press's menu (a row's, a wallpaper's, a pin's), from the foot of the
 * screen as a phone's own menus come, its entries a thumb's size; Rename…'s question; Remove's question while the row is
 * on the screens (as the window asks); and the Picture editor. Each keeps the keyboard in it, Esc closes it, and the
 * phone's own Back closes it, as the remote's sheets do. Mounted once, by the remote.
 */

function MenuSheet({ title, entries }: { title: string; entries: MenuEntry[] }) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  useFocusTrap(root, closeMenu, true);
  useBackCloses(closeMenu);
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      {/* A tap beside the menu closes it, as a phone's own menus do. */}
      <button
        type="button"
        aria-label="Close the menu"
        tabIndex={-1}
        className="min-h-0 flex-1 cursor-default"
        onClick={closeMenu}
      />
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="remote-row-menu"
        className="max-h-[80dvh] overflow-y-auto rounded-t-xl border-t border-line-strong bg-panel pt-3 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-overlay focus:outline-none"
      >
        <div className="mx-auto max-w-xl space-y-2">
          <h2 id={titleId} className="truncate px-1 text-base font-bold text-fg" translate="no">
            {title}
          </h2>
          <ul className="space-y-1.5">
            {entries.map((e) => {
              const EntryIcon = e.icon;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    data-testid={`remote-menu-${e.id}`}
                    aria-pressed={e.pressed}
                    onClick={() => {
                      closeMenu();
                      e.run();
                    }}
                    className={cx(
                      'flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-base',
                      e.danger ? 'border-danger text-danger' : 'border-line text-fg',
                      e.pressed ? 'bg-panel-3 font-bold' : 'bg-panel-2',
                    )}
                  >
                    {EntryIcon && <EntryIcon size={18} aria-hidden="true" className="shrink-0" />}
                    <span className="min-w-0 flex-1">{e.label}</span>
                    {e.pressed && <span aria-hidden="true">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            size="lg"
            className="min-h-12 w-full"
            icon={X}
            data-testid="remote-row-menu-close"
            data-autofocus
            onClick={closeMenu}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Rename…: the new name asked, kept in Drashti (it says why not, and the question stays). */
function RenameQuestion() {
  const renaming = usePhoneTools((s) => s.renaming);
  return renaming ? <RenameDialog key={`${renaming.what}:${renaming.name}`} renaming={renaming} /> : null;
}

function RenameDialog({ renaming }: { renaming: Renaming }) {
  const [name, setName] = useState(renaming.name);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = () => {
    usePhoneTools.setState({ renaming: null });
  };
  useFocusTrap(root, close, true);
  useBackCloses(close);
  const trimmed = name.trim();
  const save = async () => {
    if (trimmed === '' || busy) return;
    setBusy(true);
    const why = await renaming.save(trimmed);
    setBusy(false);
    if (why === null) close();
    else setProblem(why);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="remote-rename"
        className="w-[min(28rem,100%)] space-y-4 rounded-xl border border-line-strong bg-panel p-5 text-fg shadow-overlay focus:outline-none"
      >
        <h2 id={titleId} className="text-lg leading-snug font-bold break-words">
          Rename {renaming.what}
        </h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1">
            <span className="block text-base text-muted">Its new name</span>
            <input
              value={name}
              maxLength={200}
              data-autofocus
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="h-12 w-full rounded-lg border border-field bg-panel-3 px-3 text-base text-fg"
            />
          </label>
          {problem && (
            <p role="alert" className="text-base text-warning-fg">
              {problem}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" className="min-h-12" data-testid="remote-rename-cancel" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              variant="primary"
              className="min-h-12"
              disabled={trimmed === '' || busy}
              data-testid="remote-rename-save"
            >
              Rename
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Remove from playlist while the row is on the screens: asked first, as the window asks. */
function RemoveQuestion() {
  const removing = usePhoneTools((s) => s.removing);
  if (!removing) return null;
  const close = () => {
    usePhoneTools.setState({ removing: null });
  };
  return (
    <PhoneQuestion
      title={`Take “${removing.name}” out of the playlist?`}
      safe="Cancel"
      act="Take out"
      testId="remote-remove-ask"
      onSafe={close}
      onAct={() => {
        close();
        void removeRow(removing.playlistId, removing.itemId, removing.name);
      }}
    >
      <p>“{removing.name}” is on the screens now. It stays up until it is changed.</p>
      <p>The library keeps it. Undo brings it back.</p>
    </PhoneQuestion>
  );
}

/** Over the remote: what a long press opened. Mounted once, by the remote. */
export function PhoneToolsLayer() {
  const menu = usePhoneTools((s) => s.menu);
  const editing = usePhoneTools((s) => s.editing);
  useEffect(() => {
    startPhoneTools();
  }, []);
  return (
    <>
      {menu && <MenuSheet key={menu.title} title={menu.title} entries={menu.entries} />}
      <RenameQuestion />
      <RemoveQuestion />
      {editing && <PhonePictureEditor key={editing.mediaId} mediaId={editing.mediaId} name={editing.name} />}
    </>
  );
}
