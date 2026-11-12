import type { useImportNotices } from '../library/import-notices';
import { dismissImportNotice, findImportMedia, retryImportNotice } from '../library/import-notices';
import { Button } from '../ui/Button';
import { Info, X } from '../ui/icons';
import { Truncate } from '../ui/Truncate';

type ImportNotice = ReturnType<typeof useImportNotices.getState>['notices'][number];

/**
 * One import notice in the window's bottom-right corner (NoticeArea): one line, cut off where it does not fit and
 * whole in its Dismiss's tooltip. Only its buttons take a click.
 */
export function ImportNoticeLine({ item, canFindMissing }: { item: ImportNotice; canFindMissing: boolean }) {
  return (
    <div
      role="alert"
      data-testid="import-notice"
      className="flex max-w-full items-center gap-1.5 rounded-md border border-line/60 border-l-2 border-l-accent bg-panel-3/75 px-2 py-1 text-xs text-fg"
    >
      <Info size={13} aria-hidden="true" className="shrink-0 text-accent" />
      <Truncate text={item.text} />
      {canFindMissing && item.findMissing && (
        <Button
          size="sm"
          className="pointer-events-auto h-5 shrink-0"
          onClick={() => void findImportMedia(item)}
        >
          Find…
        </Button>
      )}
      {item.retry && (
        <Button
          size="sm"
          className="pointer-events-auto h-5 shrink-0"
          onClick={() => void retryImportNotice(item)}
        >
          Try again
        </Button>
      )}
      <button
        type="button"
        aria-label="Dismiss import notice"
        title={item.text}
        onClick={() => dismissImportNotice(item.id)}
        className="pointer-events-auto -mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-panel-2"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
