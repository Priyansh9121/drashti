import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { importPaths } from '../library/import-store';
import { closeLibrary, openLibrary, useLibraryTab } from '../library/library-store';
import { Button, IconButton } from '../ui/Button';
import { BookOpen, Upload, X } from '../ui/icons';
import { Notice } from '../ui/Notice';
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
  return open ? <OpenLibrarySheet platform={platform} /> : null;
}

function OpenLibrarySheet({ platform }: { platform: string }) {
  // A row dragged from it: the sheet stands aside until the drag is over, so a playlist in the list (or
  // a folder) under it takes the drop as well as the open playlist (playlists/drag.ts).
  const aside = useDragging((s) => s.aside);
  const ref = useRef<HTMLElement>(null);
  const [dropping, setDropping] = useState(false);
  const [dropProblem, setDropProblem] = useState<string | null>(null);
  const depth = useRef(0);
  // Opening puts the keyboard in the search box (or the first thing that takes it); shutting gives it back
  // to the Library button, if it was in the sheet.
  useEffect(() => {
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
  }, []);

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current++;
    setDropping(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDropping(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    // The window imports files dropped anywhere else (Pro Mode): this sheet has them.
    e.stopPropagation();
    depth.current = 0;
    setDropping(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.drashti.files.pathFor(f))
      .filter((p) => p !== '');
    setDropProblem(paths.length === 0 ? 'Drop files or folders from the desktop or a USB drive.' : null);
    // Into the library only, never the open playlist (Q57-11, the owner): the old program's library folder or many
    // presentations dropped here don't fill it. Dropped anywhere else they go into the open playlist too.
    void importPaths(paths, undefined, null);
  };
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
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
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
      {dropProblem && (
        <Notice tone="warning" compact className="mx-3 mb-2" onDismiss={() => setDropProblem(null)}>
          {dropProblem}
        </Notice>
      )}
      {dropping && (
        <div
          data-testid="drop-overlay"
          className="pointer-events-none absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent bg-ink/90 p-4 text-center text-sm font-medium"
        >
          <Upload size={28} aria-hidden="true" className="text-accent" />
          Drop lyrics, presentations or media to import them
        </div>
      )}
    </section>
  );
}
