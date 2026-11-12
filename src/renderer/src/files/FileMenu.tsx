import { useEffect, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { create } from 'zustand';
import { NAME_MAX } from '../../../shared/media-removal';
import type { RowTrimView } from '../../../shared/trim';
import { openPlaylistTrim } from '../markers/MarkersDialog';
import { useNotice } from '../operator/actions';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import type { MenuPlace } from '../ui/Menu';
import { isMenuKey, Menu, menuBelow, menuPlace } from '../ui/Menu';
import type { FileTarget } from './file-menu';
import { fileMenuEntries } from './file-menu';

/*
 * The one right-click menu (Session 55, Part 14; its entries: file-menu.ts), mounted once in each mode's window:
 * a row asks for it with fileMenuProps (a right-click, Shift+F10 or the Menu key, or a long press on a touch screen),
 * and the menu says what fits the thing. Rename's question is here too, for every place alike.
 */

const useFileMenu = create<{
  open: { at: MenuPlace; target: FileTarget } | null;
  /** The name being changed: what, and how it is saved. */
  renaming: { what: string; name: string; save: (name: string) => Promise<string | null> } | null;
}>(() => ({ open: null, renaming: null }));

/** Open the menu for a thing, at a point. */
export function openFileMenu(at: MenuPlace, target: FileTarget): void {
  useFileMenu.setState({ open: { at, target } });
}

/**
 * Ask for a new name (Rename…): `save` keeps it and says why not (null when kept). `what` names the thing in the
 * question ("the presentation", "the picture").
 */
export function askRename(what: string, name: string, save: (name: string) => Promise<string | null>): void {
  useFileMenu.setState({ renaming: { what, name, save } });
}

/** How long a finger held on a row opens its menu (a touch screen's long press). */
export const LONG_PRESS_MS = 550;
/** How far a finger may move and still be a long press (px). */
const LONG_PRESS_SLOP = 10;

/** One long press at a time: where it started, its wait, and when it last opened a menu. */
const press = {
  timer: null as ReturnType<typeof setTimeout> | null,
  x: 0,
  y: 0,
  openedAt: 0,
};

function stopPress(): void {
  if (press.timer !== null) clearTimeout(press.timer);
  press.timer = null;
}

/**
 * What a row spreads onto its element to have the menu: right-click, Shift+F10 or the Menu key, and a long press on a
 * touch screen (whose click, as the finger lifts, is not a click on the row). `before` runs first (choosing the row).
 */
export function fileMenuProps(target: () => FileTarget, before?: () => void) {
  const open = (at: MenuPlace) => {
    before?.();
    openFileMenu(at, target());
  };
  return {
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      // The system's own long-press menu, just after ours opened: once is enough.
      if (Date.now() - press.openedAt < 1000) return;
      open(menuPlace(e));
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!isMenuKey(e)) return;
      e.preventDefault();
      open(menuBelow(e.currentTarget));
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      stopPress();
      press.x = e.clientX;
      press.y = e.clientY;
      const at = { x: e.clientX, y: e.clientY };
      press.timer = setTimeout(() => {
        press.timer = null;
        press.openedAt = Date.now();
        open(at);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (press.timer === null) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) stopPress();
    },
    onPointerUp: stopPress,
    onPointerCancel: stopPress,
    onPointerLeave: stopPress,
    // The finger lifting after a long press is no click on the row (it would put the row up).
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (Date.now() - press.openedAt < 800) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
}

/** The new name's question. */
function RenameDialog() {
  const renaming = useFileMenu((s) => s.renaming);
  const [name, setName] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!renaming) return null;
  const value = name ?? renaming.name;
  const close = () => {
    setName(null);
    setProblem(null);
    useFileMenu.setState({ renaming: null });
  };
  const trimmed = value.trim();
  return (
    <Dialog
      title={`Rename ${renaming.what}`}
      size="sm"
      onClose={close}
      testId="rename-dialog"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="rename-form"
            data-testid="rename-save"
            disabled={saving || trimmed === '' || trimmed === renaming.name}
          >
            Rename
          </Button>
        </>
      }
    >
      <form
        id="rename-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed === '' || trimmed === renaming.name) return;
          setSaving(true);
          void renaming
            .save(trimmed)
            .then((why) => {
              if (why === null) close();
              else setProblem(why);
            })
            .finally(() => {
              setSaving(false);
            });
        }}
      >
        <Field label="Name" error={problem}>
          <TextInput
            autoFocus
            value={value}
            maxLength={NAME_MAX}
            spellCheck={false}
            data-testid="rename-field"
            onFocus={(e) => {
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setName(e.target.value);
              setProblem(null);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** The menu (and Rename's question), once for the window. */
export function FileMenu({ platform }: { platform: string }) {
  const open = useFileMenu((s) => s.open);
  // Simple Mode's has Rename and Delete (Session 55, Part 18), and Trim, When it ends and Edit slides… (Session 56).
  const simple = useMode((s) => s.mode === 'simple');
  const target = open?.target;
  const itemId = target?.kind === 'video' ? target.itemId : undefined;
  const [loaded, setLoaded] = useState<{ target: FileTarget; trim: RowTrimView | null } | null>(null);
  useEffect(() => {
    if (!target || !itemId) return;
    let current = true;
    void window.drashti.media.rowTrim(itemId).then((trim) => {
      if (current) setLoaded({ target, trim });
    });
    return () => {
      current = false;
    };
  }, [itemId, target]);

  const trim = loaded?.target === target ? loaded?.trim : null;
  const openTrim =
    itemId && (target?.trim || trim?.canReset) ? () => void openPlaylistTrim(itemId) : undefined;
  const entries = target
    ? fileMenuEntries(openTrim ? { ...target, trim: openTrim } : target, platform, { simple })
    : [];
  if (trim?.canReset && trim.mediaId === target?.mediaId) {
    const afterTrim = entries.findIndex((entry) => entry.onSelect === openTrim) + 1;
    entries.splice(afterTrim, 0, {
      label: 'Reset to original',
      onSelect: () => {
        void window.drashti.media.resetRowTrim(trim.itemId, trim.mediaId).then((result) => {
          if (!result.ok) useNotice.setState({ text: result.message });
        });
      },
    });
  }
  return (
    <>
      {open && entries.length > 0 && (
        <Menu
          at={open.at}
          label={open.target.name}
          entries={entries}
          onClose={() => {
            useFileMenu.setState({ open: null });
          }}
        />
      )}
      <RenameDialog />
    </>
  );
}

/** Show a file in the Finder or Explorer, saying why not when Drashti has none to show. */
export async function revealFile(which: { mediaId: string } | { presentationId: string }): Promise<void> {
  const result =
    'mediaId' in which
      ? await window.drashti.media.reveal(which.mediaId)
      : await window.drashti.library.revealPresentation(which.presentationId);
  if (!result.ok) useNotice.setState({ text: result.message });
}
