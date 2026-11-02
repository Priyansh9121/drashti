// PDF page controls use the editor's normal content commands and native gestures.
import { Button } from '../ui/Button';
import {
  Download,
  FilePlus,
  Pencil,
  RotateCw,
  Square,
  SquarePen,
  Strikethrough,
  Trash2,
  Underline,
} from '../ui/icons';
import { Cluster, Divider } from './RibbonParts';

export type PdfMarkTool = 'highlight' | 'underline' | 'strike' | 'draw' | 'cover';
export type PdfPendingAction = 'insert-pages' | 'save-copy' | null;

/** These are real capabilities supplied by the parent after native preparation. */
export interface PdfToolAvailability {
  highlight: boolean;
  underline: boolean;
  strike: boolean;
  draw: boolean;
  cover: boolean;
  rotateRight: boolean;
  deletePage: boolean;
  insertPages: boolean;
  saveCopy: boolean;
}

/**
 * Callbacks finish/retain typing and call the central conversion/history gate.
 * Async native dialogs and errors are owned by the parent; no detached promise
 * or dummy IPC is hidden behind one of these controls.
 */
export interface PdfToolCallbacks {
  onHighlight?: () => void;
  onUnderline: () => void;
  onStrikeThrough: () => void;
  onDraw?: () => void;
  onCover?: () => void;
  onRotateRight: () => void;
  onDeletePage: () => void;
  onInsertPages?: () => void;
  onSaveCopy?: () => void;
}

export interface PdfToolsProps extends PdfToolCallbacks {
  available: PdfToolAvailability;
  activeTool: PdfMarkTool | null;
  /** Active run styles may be set even when no page-drawing tool is selected. */
  underlined: boolean;
  struckThrough: boolean;
  pending: PdfPendingAction;
  /** Loading, library save, a source-warning dialog, or an unfinished page job. */
  blocked: boolean;
}

export function PdfTools({
  available,
  activeTool,
  underlined,
  struckThrough,
  pending,
  blocked,
  onHighlight,
  onUnderline,
  onStrikeThrough,
  onDraw,
  onCover,
  onRotateRight,
  onDeletePage,
  onInsertPages,
  onSaveCopy,
}: PdfToolsProps) {
  const busy = blocked || pending !== null;
  return (
    <div className="flex min-w-0 items-start" data-testid="pdf-pages-group" aria-busy={pending !== null}>
      <Cluster name="Mark this page">
        <Button
          size="sm"
          variant={activeTool === 'highlight' ? 'strong' : 'ghost'}
          icon={SquarePen}
          disabled={busy || !available.highlight || !onHighlight}
          aria-pressed={activeTool === 'highlight'}
          data-testid="pdf-highlight"
          onClick={onHighlight}
        >
          Highlight
        </Button>
        <Button
          size="sm"
          variant={underlined || activeTool === 'underline' ? 'strong' : 'ghost'}
          icon={Underline}
          disabled={busy || !available.underline}
          aria-pressed={underlined || activeTool === 'underline'}
          data-testid="pdf-underline"
          onClick={onUnderline}
        >
          Underline
        </Button>
        <Button
          size="sm"
          variant={struckThrough || activeTool === 'strike' ? 'strong' : 'ghost'}
          icon={Strikethrough}
          disabled={busy || !available.strike}
          aria-pressed={struckThrough || activeTool === 'strike'}
          data-testid="pdf-strike"
          onClick={onStrikeThrough}
        >
          Strike through
        </Button>
        <Button
          size="sm"
          variant={activeTool === 'draw' ? 'strong' : 'ghost'}
          icon={Pencil}
          disabled={busy || !available.draw || !onDraw}
          aria-pressed={activeTool === 'draw'}
          data-testid="pdf-draw"
          onClick={onDraw}
        >
          Draw
        </Button>
        <Button
          size="sm"
          variant={activeTool === 'cover' ? 'strong' : 'ghost'}
          icon={Square}
          disabled={busy || !available.cover || !onCover}
          aria-pressed={activeTool === 'cover'}
          data-testid="pdf-cover"
          onClick={onCover}
        >
          Cover
        </Button>
      </Cluster>
      <Divider />
      <Cluster name="Pages">
        <Button
          size="sm"
          variant="ghost"
          icon={RotateCw}
          disabled={busy || !available.rotateRight}
          data-testid="pdf-rotate-right"
          onClick={onRotateRight}
        >
          Turn page right
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={FilePlus}
          disabled={busy || !available.insertPages || !onInsertPages}
          data-testid="pdf-insert-pages"
          onClick={onInsertPages}
        >
          Insert pages…
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          disabled={busy || !available.deletePage}
          data-testid="pdf-delete-page"
          onClick={onDeletePage}
        >
          Delete page
        </Button>
      </Cluster>
      <Divider />
      <Cluster name="Copy">
        <Button
          size="sm"
          variant="ghost"
          icon={Download}
          disabled={busy || !available.saveCopy || !onSaveCopy}
          data-testid="pdf-save-copy"
          onClick={onSaveCopy}
        >
          Save a PDF copy…
        </Button>
      </Cluster>
      {pending !== null && (
        <p className="ml-3 self-center text-xs text-muted" role="status" data-testid="pdf-pages-pending">
          {pending === 'insert-pages' ? 'Preparing the pages…' : 'Writing the PDF copy…'}
        </p>
      )}
      {activeTool !== null && pending === null && (
        <p
          className="ml-3 shrink-0 self-center text-xs whitespace-nowrap text-muted"
          role="status"
          data-testid="pdf-tool-instruction"
        >
          {activeTool === 'draw'
            ? 'Draw on the page. Escape cancels.'
            : activeTool === 'cover'
              ? 'Drag a visual cover on the page. Escape cancels.'
              : 'Drag across the part of the page to mark. Escape cancels.'}
        </p>
      )}
    </div>
  );
}
