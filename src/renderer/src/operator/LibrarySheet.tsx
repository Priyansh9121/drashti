import { useEffect, useRef } from 'react';
import { closeLibrary, openLibrary, useLibraryTab } from '../library/library-store';
import { Button, IconButton } from '../ui/Button';
import { BookOpen, X } from '../ui/icons';
import { useDragging } from '../playlists/drag';
import { cx } from '../ui/cx';
import { PresentationList } from './PresentationList';

/*
 * The library as a sheet (Session 44; Priyansh: "playlists become the whole left side", the library from a
 * Library button at the top of the left column). It opens over the playlists, in the left column, never over
 * the open playlist in the middle, so its rows drag into the playlist; Add to playlist works as before. It is not a modal: the
 * show's keys still work, and nothing else in the window is held back. Esc (or Close) shuts it and gives the
 * keyboard back to the Library button.
 */

/** The Library button, at the top of the left column. */
export function LibraryButton() {
  const open = useLibraryTab((s) => s.open);
  return (
    <div className="flex shrink-0 items-center px-3 pt-2.5 pb-1">
      <Button
        size="md"
        variant={open ? 'secondary' : 'ghost'}
        icon={BookOpen}
        data-testid="library-button"
        aria-expanded={open}
        aria-controls="library-sheet"
        title="Every presentation and media file, with search, Import… and New…"
        className="w-full justify-start"
        onClick={open ? closeLibrary : openLibrary}
      >
        Library
      </Button>
    </div>
  );
}

export function LibrarySheet({ platform }: { platform: string }) {
  const open = useLibraryTab((s) => s.open);
  // A row dragged from it: the sheet stands aside until the drag is over, so a playlist in the list (or
  // a folder) under it takes the drop as well as the open playlist (playlists/drag.ts).
  const aside = useDragging((s) => s.aside);
  const ref = useRef<HTMLElement>(null);
  // Opening puts the keyboard in the search box (or the first thing that takes it); shutting gives it back
  // to the Library button, if it was in the sheet.
  useEffect(() => {
    if (!open) return;
    const sheet = ref.current;
    const first =
      sheet?.querySelector<HTMLInputElement>('#library-search') ??
      sheet?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
    return () => {
      // Shut, the sheet's own element that had the keyboard is gone: the window's body has it then.
      const active = document.activeElement;
      if (active === null || active === document.body || sheet?.contains(active) === true)
        document.querySelector<HTMLElement>('[data-testid="library-button"]')?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <section
      ref={ref}
      id="library-sheet"
      aria-labelledby="library-sheet-title"
      data-testid="library-sheet"
      // Over the playlists and folders, in the left column: never over the open playlist in the middle, the
      // Library button above or the notices below.
      data-aside={aside ? 'true' : undefined}
      className={cx(
        'absolute inset-0 z-30 flex min-h-0 flex-col border-y border-line-strong bg-panel',
        aside && 'pointer-events-none invisible',
      )}
      onKeyDown={(e) => {
        // A box or menu that takes Esc itself (the search box with words in it) keeps it.
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        closeLibrary();
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3" data-strip="">
        <BookOpen size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <h2 id="library-sheet-title" className="min-w-0 flex-1 truncate text-sm font-bold text-heading">
          Library
        </h2>
        <IconButton
          icon={X}
          label="Close the library"
          size="sm"
          data-testid="library-close"
          onClick={closeLibrary}
        />
      </div>
      <PresentationList platform={platform} />
    </section>
  );
}
