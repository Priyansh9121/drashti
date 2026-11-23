import { orderedPdfMarks, PDF_MARK_NAMES } from '../../../shared/pdf-mark-motion';
import type { ShapeElement } from '../../../shared/model';
import { commit, useEditor } from './editor-store';
import { findSlide } from './ops';
import { setPdfMarkClick } from './pdf-mark-order';
import { finishTextEditing } from './TextBoxEditor';
import { Cluster, Divider } from './RibbonParts';

export function PdfMarkMotion() {
  const doc = useEditor((state) => state.doc);
  const slideId = useEditor((state) => state.slideId);
  const ids = useEditor((state) => state.selection);
  const busy = useEditor(
    (state) => state.saving || state.loading || state.pdfDrawing || state.sourceConversion !== null,
  );
  const page = doc ? findSlide(doc, slideId) : undefined;
  const selected =
    page?.elements.filter(
      (element): element is ShapeElement => element.kind === 'shape' && ids.includes(element.id),
    ) ?? [];
  const ordered = orderedPdfMarks(page?.elements ?? []);
  return (
    <>
      <Divider />
      <Cluster name="PDF marks">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            aria-label="Comes in on click"
            disabled={busy || selected.length === 0}
            checked={selected.length > 0 && selected.every((mark) => mark.pdfMark?.clickOrder !== undefined)}
            onChange={(event) => {
              finishTextEditing();
              const state = useEditor.getState();
              if (state.doc && state.slideId)
                commit(setPdfMarkClick(state.doc, state.slideId, state.selection, event.target.checked));
            }}
          />
          Comes in on click
        </label>
        <p className="max-w-52 text-2xs text-muted">
          Next shows one mark at a time; Back hides it. Turn this off for timed motion.
        </p>
      </Cluster>
      <Cluster name="Mark order">
        <ol
          aria-label="PDF mark order"
          className="max-h-20 w-48 overflow-y-auto text-xs text-muted"
          tabIndex={0}
        >
          {ordered.map((mark, index) => (
            <li key={mark.id}>
              Click {index + 1} · {mark.pdfMark.tool ? PDF_MARK_NAMES[mark.pdfMark.tool] : 'Mark'}
            </li>
          ))}
        </ol>
      </Cluster>
    </>
  );
}
