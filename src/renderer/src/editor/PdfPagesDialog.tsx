import { useState } from 'react';
import { pdfPageSelection } from '../../../shared/pdf-page-selection';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { Notice } from '../ui/Notice';

export function PdfPagesDialog({
  count,
  page,
  split,
  onConfirm,
  onClose,
}: {
  count: number;
  page: number;
  split: boolean;
  onConfirm: (pages: number[], file: boolean) => Promise<string | null>;
  onClose: () => void;
}) {
  const [text, setText] = useState(String(page + 1));
  const [file, setFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pages = split
    ? Array.from({ length: count - page }, (_, i) => page + i)
    : pdfPageSelection(text, count);
  const confirm = async () => {
    if (!pages || busy || (split && page < 1)) return;
    setBusy(true);
    try {
      const message = await onConfirm(pages, file);
      if (message) setProblem(message);
      else onClose();
    } catch {
      setProblem('The pages could not be prepared. Close this and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={split ? 'Split PDF presentation' : 'Extract PDF pages'}
      testId="pdf-pages-dialog"
      size="md"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !pages || (split && page < 1)}
            onClick={() => void confirm()}
          >
            {split ? 'Split presentation' : 'Extract pages'}
          </Button>
        </>
      }
    >
      {split ? (
        <p className="text-sm">
          Split before page {page + 1}. This presentation keeps the first {page}{' '}
          {page === 1 ? 'page' : 'pages'}; a new presentation holds the rest. Undo joins them again.
        </p>
      ) : (
        <>
          <Field
            label="Pages"
            hint={`Choose page numbers from 1 to ${count}, for example 1, 3-5. Pages keep their reading order.`}
            error={pages ? null : 'Choose valid page numbers.'}
          >
            <TextInput value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
          </Field>
          <fieldset disabled={busy} className="my-3 space-y-2">
            <legend className="text-sm">Put the pages in</legend>
            <label className="flex gap-2 text-sm">
              <input type="radio" checked={!file} onChange={() => setFile(false)} name="pdf-destination" />
              New presentation
            </label>
            <label className="flex gap-2 text-sm">
              <input type="radio" checked={file} onChange={() => setFile(true)} name="pdf-destination" />
              New PDF file
            </label>
          </fieldset>
          <p className="text-sm text-muted">
            The pages stay here too. Undo removes a new presentation from the library. Undo removes a new PDF
            file too; Redo restores it if its name is still free.
          </p>
        </>
      )}
      {busy && (
        <p role="status" className="mt-3 text-sm">
          Preparing the pages…
        </p>
      )}
      {problem && <Notice tone="warning">{problem}</Notice>}
    </Dialog>
  );
}
