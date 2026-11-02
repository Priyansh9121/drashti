import { useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Textarea } from '../ui/Field';
import { Checkbox } from '../ui/Toggle';
import { FileText } from '../ui/icons';
import { commit, useEditor } from './editor-store';
import { changeSlide, findSlide } from './ops';
import { finishTextEditing } from './TextBoxEditor';
import { Cluster, Divider } from './RibbonParts';

export function SlidesTools() {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const strip = useEditor((s) => s.strip);
  const [notes, setNotes] = useState<string | null>(null);
  const slide = doc ? findSlide(doc, notes) : undefined;
  const isMaster = doc?.master?.id === slideId;
  return (
    <>
      <Divider />
      <Cluster name="Strip and notes">
        <div className="flex flex-col gap-1">
          <Checkbox
            label="Slides across"
            data-testid="slides-strip"
            checked={strip}
            onChange={(e) => {
              finishTextEditing();
              useEditor.setState({ strip: e.target.checked });
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={FileText}
            data-testid="slides-notes"
            disabled={!slideId || isMaster}
            onClick={() => {
              finishTextEditing();
              setNotes(useEditor.getState().slideId);
            }}
          >
            Notes…
          </Button>
        </div>
      </Cluster>
      {notes && slide && (
        <Dialog
          title="Notes for this slide"
          testId="slides-notes-dialog"
          onClose={() => setNotes(null)}
          footer={
            <Button variant="primary" onClick={() => setNotes(null)}>
              Keep notes
            </Button>
          }
        >
          <p className="mb-3 text-sm text-muted">
            For the stage screens, never the hall or stream. Changes are kept as you type, with Undo.
          </p>
          <Textarea
            autoFocus
            aria-label="Notes for the stage screens"
            data-testid="slides-notes-text"
            rows={8}
            maxLength={20_000}
            value={slide.notes}
            onChange={(e) => {
              const s = useEditor.getState();
              if (s.doc && findSlide(s.doc, notes))
                commit(changeSlide(s.doc, notes, { notes: e.target.value }), { coalesce: `notes:${notes}` });
            }}
          />
        </Dialog>
      )}
    </>
  );
}
