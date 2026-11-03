import { useEffect, useRef, useState } from 'react';
import type { EditSlide, PdfPageSource } from '../../../shared/slide-edit';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Notice } from '../ui/Notice';
import { Loading } from '../ui/States';

/** Main owns file selection; both sources become one undoable insertion. */
export function PdfInsertDialog({
  presentationId,
  stamp,
  onInserted,
  onClose,
}: {
  presentationId: string;
  stamp: string;
  onInserted: (pages: EditSlide[], issues: string[]) => void;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<PdfPageSource[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);
  const working = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (working.current)
        void window.drashti.library.cancelPdfInsertion(presentationId, stamp).catch(() => undefined);
    };
  }, [presentationId, stamp]);
  useEffect(() => {
    let live = true;
    void window.drashti.library
      .pdfPageSources()
      .then((items) => {
        if (live) setSources(items.filter((source) => source.id !== presentationId));
      })
      .catch(() => {
        if (live) setProblem('The PDF list could not be read. Close this and try Insert pages again.');
      });
    return () => {
      live = false;
    };
  }, [presentationId]);
  const insert = async (fromFile = false) => {
    if ((!fromFile && !selected) || working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const result = fromFile
        ? await window.drashti.library.insertPdfFile(presentationId, stamp)
        : selected
          ? await window.drashti.library.insertPdfPages(presentationId, stamp, selected)
          : null;
      if (!result) return;
      if (!mounted.current) return;
      if (result.ok) {
        onInserted(result.pages, result.issues);
        onClose();
      } else if (!result.cancelled) setProblem(result.message);
    } catch {
      if (mounted.current)
        setProblem('Those pages could not be inserted. Close this and choose the PDF again.');
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Dialog
      title="Insert PDF pages"
      testId="pdf-insert-dialog"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!selected || busy} onClick={() => void insert()}>
            Insert pages
          </Button>
        </>
      }
    >
      <Button disabled={busy} onClick={() => void insert(true)}>
        Choose a PDF file…
      </Button>
      <p className="my-3 text-sm text-muted">
        Insert all pages of another PDF after this page. The PDF in the library stays as it is; Undo removes
        this insertion.
      </p>
      {sources === null && !problem && <Loading label="Reading PDFs…" />}
      {sources?.length === 0 && (
        <p className="text-sm text-muted">
          No other PDFs are in the library. Choose a PDF file to insert its pages here.
        </p>
      )}
      {!!sources?.length && (
        <fieldset
          disabled={busy}
          className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-line p-2"
          tabIndex={0}
        >
          <legend className="px-1 text-sm">PDF in the library</legend>
          {sources.map((source) => (
            <label
              key={source.id}
              data-testid="pdf-insert-source"
              className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-panel-3"
            >
              <input
                type="radio"
                name="pdf-source"
                value={source.id}
                checked={selected === source.id}
                onChange={() => setSelected(source.id)}
              />
              <span className="min-w-0 flex-1 break-words">{source.name}</span>
              <span className="text-xs text-muted">
                {source.pages} {source.pages === 1 ? 'page' : 'pages'}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {busy && (
        <p role="status" className="mt-3 text-sm text-muted">
          Preparing the pages… Cancel stops this job.
        </p>
      )}
      {problem && (
        <Notice tone="warning" className="mt-3">
          {problem}
        </Notice>
      )}
    </Dialog>
  );
}
