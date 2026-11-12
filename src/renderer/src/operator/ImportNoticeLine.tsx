import type { useImportNotices } from '../library/import-notices';
import { dismissImportNotice, findImportMedia, retryImportNotice } from '../library/import-notices';
import { Button } from '../ui/Button';
import { Info, X } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import { cx } from '../ui/cx';

type ImportNotice = ReturnType<typeof useImportNotices.getState>['notices'][number];

/**
 * One import notice in the window's bottom-right corner (NoticeArea): one line, cut off where it does not fit and
 * whole in its Dismiss's tooltip; or, marked `whole` (an import's old fonts, which the admin writes down on setup day),
 * its words wrapping as the operator's own notice's do (NoticeCard), so no font and nothing to do is cut off. It is
 * absolutely placed, so a longer one takes no room. Only its buttons take a click.
 */
export function ImportNoticeLine({ item, canFindMissing }: { item: ImportNotice; canFindMissing: boolean }) {
  return (
    <div
      role="alert"
      data-testid="import-notice"
      className={cx(
        'flex max-w-full gap-1.5 rounded-md border border-line/60 border-l-2 border-l-accent bg-panel-3/75 px-2 py-1 text-xs text-fg',
        item.whole ? 'items-start' : 'items-center',
      )}
    >
      <Info size={13} aria-hidden="true" className={cx('shrink-0 text-accent', item.whole && 'mt-0.5')} />
      {item.whole ? (
        <p className="min-w-0 flex-1 break-words leading-normal">{item.text}</p>
      ) : (
        <Truncate text={item.text} />
      )}
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
