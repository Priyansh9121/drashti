import { useState } from 'react';
import type { EditDoc } from '../../../shared/slide-edit';
import { pdfHandout } from '../../../shared/pdf-handout';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';

export function PdfHandoutDialog({
  doc,
  onKeep,
  onClose,
}: {
  doc: EditDoc;
  onKeep: (doc: EditDoc) => Promise<boolean>;
  onClose: () => void;
}) {
  const value = (name: string) => doc.master?.elements.find((e) => e.name === `PDF hand-out ${name}`);
  const words = (name: string) => {
    const element = value(name);
    return element?.kind === 'text' ? element.text : '';
  };
  const [header, setHeader] = useState(words('header'));
  const [footer, setFooter] = useState(words('footer'));
  const [watermark, setWatermark] = useState(words('watermark'));
  const [numbers, setNumbers] = useState(!!value('numbers'));
  return (
    <Dialog
      title="PDF hand-out"
      testId="pdf-handout-dialog"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              void onKeep(pdfHandout(doc, { header, footer, watermark, numbers })).then((kept) => {
                if (kept) onClose();
              });
            }}
          >
            Keep hand-out
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        One master puts these words behind every page. Page numbers follow the page order. Undo restores the
        previous master. Save a PDF copy includes the master.
      </p>
      <div className="space-y-3">
        <Field label="Header">
          <TextInput maxLength={200} value={header} onChange={(e) => setHeader(e.target.value)} />
        </Field>
        <Field label="Footer">
          <TextInput maxLength={200} value={footer} onChange={(e) => setFooter(e.target.value)} />
        </Field>
        <Field label="Watermark">
          <TextInput maxLength={200} value={watermark} onChange={(e) => setWatermark(e.target.value)} />
        </Field>
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} />
          Page numbers
        </label>
      </div>
    </Dialog>
  );
}
