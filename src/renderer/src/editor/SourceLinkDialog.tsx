import { useEffect, useRef, useState } from 'react';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { renderEditedSlide } from '../../../shared/slide-design';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Notice } from '../ui/Notice';

/** The operator explicitly pairs a reading-copy page with one saved source picture. */
export function SourceLinkDialog({
  doc,
  slideId,
  stamp,
  onLinked,
  onClose,
}: {
  doc: EditDoc;
  slideId: string;
  stamp: string;
  onLinked(page: EditSlide, issues: string[]): void;
  onClose(): void;
}) {
  const slide = doc.groups.flatMap((group) => group.slides).find((page) => page.id === slideId);
  const pictures = slide?.elements.filter((element) => element.kind === 'image') ?? [];
  const [pictureId, setPictureId] = useState<string | null>(
    pictures.length === 1 ? (pictures[0]?.id ?? null) : null,
  );
  const [pages, setPages] = useState<EditSlide[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
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
        void window.drashti.library.cancelPdfInsertion(doc.presentationId, stamp).catch(() => undefined);
    };
  }, [doc.presentationId, stamp]);
  const choose = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const result = await window.drashti.library.insertPdfFile(doc.presentationId, stamp);
      if (!mounted.current) return;
      if (result.ok) {
        setPages(result.pages);
        setIssues(result.issues);
        setSelected(null);
      } else if (!result.cancelled) setProblem(result.message);
    } catch {
      if (mounted.current)
        setProblem('The reading copy could not be prepared. Choose an unprotected PDF and try again.');
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const link = async () => {
    if (!selected || !pictureId || working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const result = await window.drashti.library.linkPdfPage(
        doc.presentationId,
        doc,
        stamp,
        slideId,
        pictureId,
        selected,
      );
      if (!mounted.current) return;
      if (result.ok) {
        onLinked(result.page, [...new Set([...issues, ...result.issues])]);
        onClose();
      } else setProblem(result.message);
    } catch {
      if (mounted.current)
        setProblem('That page could not be linked. Close this and choose the reading copy again.');
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Dialog
      title="Link a PDF reading copy"
      testId="source-link-dialog"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !selected || !pictureId} onClick={() => void link()}>
            Link selected page
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        For an older import, choose a PDF made by the original presentation program, then match the page
        yourself. Only the selected saved picture is replaced. Operator additions, notes and the canvas size
        stay. Undo puts the picture back.
      </p>
      {slide?.deck && (
        <Notice tone="warning" className="mb-3">
          Linking makes this animated slide Drashti’s own and removes its original click steps. Other slides
          keep their steps.
        </Notice>
      )}
      <Button disabled={busy} onClick={() => void choose()}>
        Choose a PDF reading copy…
      </Button>
      <fieldset disabled={busy} className="my-3">
        <legend className="mb-1 text-sm font-semibold">Saved source picture to replace</legend>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {pictures.map((picture, index) => {
            const rendered = renderEditedSlide(doc, {
              ...slide,
              id: picture.id,
              elements: [picture],
              cues: [],
              label: '',
              notes: '',
              background: null,
              darken: null,
              enabled: true,
              transition: null,
              autoAdvanceMs: null,
              macroId: null,
            });
            return (
              <label key={picture.id} className="w-36 shrink-0 text-sm">
                <input
                  type="radio"
                  name="saved-source-picture"
                  aria-label={`Picture ${index + 1}`}
                  checked={pictureId === picture.id}
                  onChange={() => setPictureId(picture.id)}
                />{' '}
                Picture {index + 1}
                <span className="relative mt-1 block aspect-video overflow-hidden rounded border border-line bg-black">
                  <PlacedInParent content={rendered} mode="fit" className="absolute inset-0">
                    <SlideView slide={rendered} media="still" />
                  </PlacedInParent>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {!!pages.length && (
        <fieldset
          disabled={busy}
          className="max-h-64 overflow-auto rounded border border-line p-2"
          tabIndex={0}
        >
          <legend className="px-1 text-sm font-semibold">Matching page in the PDF reading copy</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {pages.map((page, index) => (
              <label key={page.id} className="min-w-0 text-sm">
                <input
                  type="radio"
                  name="reading-copy-page"
                  aria-label={`Page ${index + 1}`}
                  checked={selected === page.id}
                  onChange={() => setSelected(page.id)}
                />{' '}
                Page {index + 1}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {pages
        .filter((page) => page.id === selected)
        .map((page) => {
          const rendered = renderEditedSlide({ ...doc, master: null }, page);
          return (
            <div
              key={page.id}
              className="relative mt-3 aspect-video max-h-48 overflow-hidden rounded border border-line bg-black"
            >
              <PlacedInParent content={rendered} mode="fit" className="absolute inset-0">
                <SlideView slide={rendered} media="still" />
              </PlacedInParent>
            </div>
          );
        })}
      <p className="mt-3 text-sm text-muted">
        Review the reading copy’s appearance before Save. Fonts and other objects may differ from the original
        program. The original files are kept.
      </p>
      {issues.length > 0 && (
        <Notice tone="warning" title="Reading-copy limits" className="mt-3">
          <ul className="max-h-28 list-disc space-y-1 overflow-auto pl-5">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Notice>
      )}
      {busy && (
        <p role="status" className="mt-3 text-sm">
          Preparing the reading copy… Cancel stops this job.
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
